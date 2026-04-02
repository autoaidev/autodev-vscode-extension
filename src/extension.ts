import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';

let _out: vscode.OutputChannel;
function log(msg: string): void { _out?.appendLine(`[AutoDev] ${msg}`); }

// ---------------------------------------------------------------------------
// Claude session helpers
// ---------------------------------------------------------------------------

/** Encode a workspace path the same way Claude does for its project folder name. */
function claudeProjectFolder(workspacePath: string): string {
  // Claude replaces path separators with '-' and colons with '-'
  return workspacePath.replace(/[:\\/]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** Find the most recently modified Claude session UUID for the current workspace. */
function findLatestClaudeSession(workspacePath: string): string | undefined {
  try {
    const claudeDir = process.env['CLAUDE_CONFIG_DIR'] ?? path.join(os.homedir(), '.claude');
    const projectsDir = path.join(claudeDir, 'projects');
    const folders = fs.readdirSync(projectsDir);
    const encoded = claudeProjectFolder(workspacePath);
    // Find a folder matching this workspace (may be partial match)
    const match = folders.find(f => f === encoded || encoded.startsWith(f) || f.startsWith(encoded.slice(0, 8)));
    if (!match) { return undefined; }
    const sessionsDir = path.join(projectsDir, match);
    const files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(sessionsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length === 0) { return undefined; }
    return files[0].name.replace('.jsonl', '');
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Prompt definitions
// ---------------------------------------------------------------------------

interface PromptTemplate {
  readonly label: string;
  readonly description: string;
  readonly build: (context: string, filename: string) => string;
}

const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    label: '$(comment-discussion) Explain',
    description: 'Explain what this code does',
    build: (ctx, file) =>
      `Explain the following code from \`${file}\` in plain English:\n\n\`\`\`\n${ctx}\n\`\`\``,
  },
  {
    label: '$(bug) Find Bugs',
    description: 'Identify bugs and potential issues',
    build: (ctx, file) =>
      `Review the following code from \`${file}\` for bugs, logic errors, and potential runtime issues. List each problem with a brief explanation and a suggested fix:\n\n\`\`\`\n${ctx}\n\`\`\``,
  },
  {
    label: '$(beaker) Write Tests',
    description: 'Generate unit tests',
    build: (ctx, file) =>
      `Write comprehensive unit tests for the following code from \`${file}\`. Use the same language and any testing framework that fits the project:\n\n\`\`\`\n${ctx}\n\`\`\``,
  },
  {
    label: '$(wrench) Refactor',
    description: 'Suggest refactoring improvements',
    build: (ctx, file) =>
      `Suggest refactoring improvements for the following code from \`${file}\`. Focus on readability, maintainability, and adherence to best practices:\n\n\`\`\`\n${ctx}\n\`\`\``,
  },
  {
    label: '$(book) Generate Docs',
    description: 'Generate JSDoc / docstring comments',
    build: (ctx, file) =>
      `Add complete JSDoc (or appropriate docstring) comments to the following code from \`${file}\`. Do not change the logic, only add documentation:\n\n\`\`\`\n${ctx}\n\`\`\``,
  },
  {
    label: '$(shield) Security Review',
    description: 'Check for security vulnerabilities',
    build: (ctx, file) =>
      `Perform a security review of the following code from \`${file}\`. Identify any vulnerabilities (e.g., injection, insecure data handling, improper auth) and suggest mitigations:\n\n\`\`\`\n${ctx}\n\`\`\``,
  },
  {
    label: '$(zap) Optimize Performance',
    description: 'Suggest performance optimizations',
    build: (ctx, file) =>
      `Analyze the following code from \`${file}\` for performance issues. Suggest concrete optimizations with explanations of the expected improvement:\n\n\`\`\`\n${ctx}\n\`\`\``,
  },
];

// ---------------------------------------------------------------------------
// Chat providers
// ---------------------------------------------------------------------------

type ProviderId = 'copilot' | 'claude';
type EntryStatus = 'streaming' | 'complete' | 'error' | 'sent';

interface ProviderConfig {
  label: string;
  extensionId: string;
  lmVendor: string;
}

const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  copilot: {
    label: 'Copilot',
    extensionId: 'GitHub.copilot-chat',
    lmVendor: 'copilot',
  },
  claude: {
    label: 'Claude',
    extensionId: 'anthropic.claude-code',
    lmVendor: 'anthropic',
  },
};

// ---------------------------------------------------------------------------
// Chat history types
// ---------------------------------------------------------------------------

interface ChatEntry {
  id: string;
  templateLabel: string;
  filename: string;
  provider: ProviderId;
  timestamp: Date;
  status: EntryStatus;
  response: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Sidebar WebviewView provider
// ---------------------------------------------------------------------------

const PROVIDER_KEY = 'autodev.selectedProvider';

class ChatStatusViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'autodev.chatStatus';

  private _view?: vscode.WebviewView;
  private _history: ChatEntry[] = [];
  private _selectedProvider: ProviderId;
  private readonly _cancelTokens = new Map<string, vscode.CancellationTokenSource>();
  private readonly _externalCompletes = new Map<string, () => void>();

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    this._selectedProvider =
      this._context.globalState.get<ProviderId>(PROVIDER_KEY) ?? 'copilot';
  }

  get selectedProvider(): ProviderId {
    return this._selectedProvider;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => {
      switch (msg.command) {
        case 'setProvider':
          this._setProvider(msg.provider as ProviderId);
          break;
        case 'markComplete':
          this.markComplete(msg.id);
          break;
        case 'cancelStream':
          this._cancelStream(msg.id);
          break;
        case 'copyResponse': {
          const entry = this._history.find((e) => e.id === msg.id);
          if (entry?.response) {
            vscode.env.clipboard.writeText(entry.response).then(() =>
              vscode.window.showInformationMessage('AutoDev: Response copied to clipboard.')
            );
          }
          break;
        }
      }
    });

    this._push();
  }

  addEntry(
    templateLabel: string,
    filename: string,
    provider: ProviderId,
    initialStatus: EntryStatus = 'streaming'
  ): string {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const cleanLabel = templateLabel.replace(/\$\([^)]+\)\s*/g, '');
    this._history.unshift({
      id,
      templateLabel: cleanLabel,
      filename,
      provider,
      timestamp: new Date(),
      status: initialStatus,
      response: '',
    });
    if (this._history.length > 30) {
      this._history.length = 30;
    }
    this._push();
    return id;
  }

  appendChunk(id: string, chunk: string): void {
    const entry = this._history.find((e) => e.id === id);
    if (!entry) { return; }
    entry.response += chunk;
    this._view?.webview.postMessage({ command: 'chunk', id, text: chunk });
  }

  markComplete(id: string): void {
    this._setStatus(id, 'complete');
    this._cancelTokens.get(id)?.dispose();
    this._cancelTokens.delete(id);
    const fn = this._externalCompletes.get(id);
    if (fn) { fn(); this._externalCompletes.delete(id); }
  }

  markError(id: string, message: string): void {
    const entry = this._history.find((e) => e.id === id);
    if (entry) { entry.error = message; }
    this._setStatus(id, 'error');
    this._cancelTokens.get(id)?.dispose();
    this._cancelTokens.delete(id);
  }

  registerCancel(id: string, cts: vscode.CancellationTokenSource): void {
    this._cancelTokens.set(id, cts);
  }

  registerExternalComplete(id: string, fn: () => void): void {
    this._externalCompletes.set(id, fn);
  }

  clearHistory(): void {
    this._cancelTokens.forEach((cts) => cts.cancel());
    this._cancelTokens.clear();
    this._history = [];
    this._push();
  }

  _setProvider(id: ProviderId): void {
    this._selectedProvider = id;
    this._context.globalState.update(PROVIDER_KEY, id);
    this._push();
  }

  private _cancelStream(id: string): void {
    const cts = this._cancelTokens.get(id);
    if (cts) { cts.cancel(); this._cancelTokens.delete(id); }
    this._setStatus(id, 'complete');
  }

  private _setStatus(id: string, status: EntryStatus): void {
    const entry = this._history.find((e) => e.id === id);
    if (entry && entry.status !== status) {
      entry.status = status;
      this._push();
    }
  }

  private _push(): void {
    this._view?.webview.postMessage({
      command: 'update',
      selectedProvider: this._selectedProvider,
      providers: (Object.entries(PROVIDERS) as [ProviderId, ProviderConfig][]).map(
        ([id, cfg]) => ({
          id,
          label: cfg.label,
          installed: !!vscode.extensions.getExtension(cfg.extensionId),
        })
      ),
      history: this._history.map((e) => ({ ...e, timestamp: e.timestamp.toISOString() })),
    });
  }

  private _buildHtml(webview: vscode.Webview): string {
    const nonce =
      Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

    // NOTE: Template literals inside the returned string use \` escaping.
    // JS template literals inside the webview script are escaped as \${...}
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AutoDev</title>
<style nonce="${nonce}">
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:transparent;padding:0 8px 12px;overflow-x:hidden}
  .provider-row{display:flex;gap:6px;margin:10px 0 14px}
  .provider-btn{flex:1;padding:6px 0;border-radius:4px;border:1px solid var(--vscode-button-background);background:transparent;color:var(--vscode-button-background);cursor:pointer;font-family:var(--vscode-font-family);font-size:12px;font-weight:500}
  .provider-btn:hover:not(:disabled){background:color-mix(in srgb,var(--vscode-button-background) 15%,transparent)}
  .provider-btn.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
  .provider-btn:disabled{opacity:.35;cursor:not-allowed;border-color:var(--vscode-disabledForeground);color:var(--vscode-disabledForeground)}
  .section-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--vscode-sideBarSectionHeader-foreground,var(--vscode-descriptionForeground));margin-bottom:8px}
  .empty{text-align:center;color:var(--vscode-descriptionForeground);font-size:12px;padding:28px 0 8px;line-height:2}
  .empty-icon{font-size:28px;display:block;margin-bottom:4px}
  .entry{background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:5px;margin-bottom:7px;overflow:hidden}
  .entry.streaming{border-color:var(--vscode-progressBar-background,#0e70c0)}
  .entry-header{padding:8px 10px 6px;cursor:pointer;user-select:none}
  .entry-header:hover{background:var(--vscode-list-hoverBackground)}
  .entry-top{display:flex;align-items:center;gap:6px;margin-bottom:4px}
  .entry-chevron{font-size:10px;color:var(--vscode-descriptionForeground);flex-shrink:0;transition:transform .15s;display:inline-block}
  .entry.expanded .entry-chevron{transform:rotate(90deg)}
  .entry-name{font-weight:600;font-size:12px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .badge{flex-shrink:0;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px}
  .badge-streaming{background:var(--vscode-progressBar-background,#0e70c0);color:#fff;animation:pulse 1.4s ease-in-out infinite}
  .badge-complete{background:var(--vscode-testing-iconPassed,#388a34);color:#fff}
  .badge-error{background:var(--vscode-testing-iconFailed,#c72e2e);color:#fff}
  .badge-sent{background:var(--vscode-statusBarItem-warningBackground,#b5630d);color:#fff;animation:pulse 2s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}
  .entry-meta{display:flex;align-items:center;gap:5px}
  .entry-file{flex:1;font-size:11px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .entry-provider{flex-shrink:0;font-size:10px;padding:1px 5px;border-radius:8px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
  .entry-time{flex-shrink:0;font-size:10px;color:var(--vscode-descriptionForeground)}
  .thinking-bar{height:2px;background:var(--vscode-editorWidget-border,#454545);overflow:hidden;position:relative}
  .thinking-bar::after{content:'';position:absolute;top:0;left:-60%;width:60%;height:100%;background:var(--vscode-progressBar-background,#0e70c0);animation:scan 1.4s ease-in-out infinite;border-radius:1px}
  @keyframes scan{0%{left:-60%}100%{left:100%}}
  .entry-body{display:none;padding:0 10px 8px}
  .entry.expanded .entry-body{display:block}
  .response-text{white-space:pre-wrap;font-family:var(--vscode-editor-font-family,monospace);font-size:11px;line-height:1.55;color:var(--vscode-editor-foreground);max-height:260px;overflow-y:auto;padding:8px;background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.12));border-radius:4px;margin-bottom:7px;word-break:break-word}
  .cursor{display:inline-block;width:2px;height:12px;background:var(--vscode-foreground);vertical-align:text-bottom;animation:blink .85s step-end infinite;margin-left:1px}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
  .error-msg{font-size:11px;color:var(--vscode-testing-iconFailed,#e05454);padding:6px 0 4px}
  .entry-actions{display:flex;gap:6px;flex-wrap:wrap}
  .act-btn{font-size:11px;padding:3px 9px;border-radius:3px;cursor:pointer;border:1px solid var(--vscode-button-background);background:transparent;color:var(--vscode-button-background);font-family:var(--vscode-font-family)}
  .act-btn:hover{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
  .act-btn.danger{border-color:var(--vscode-testing-iconFailed,#e05454);color:var(--vscode-testing-iconFailed,#e05454)}
  .act-btn.danger:hover{background:var(--vscode-testing-iconFailed,#e05454);color:#fff}
</style>
</head>
<body>
<div class="provider-row" id="providerRow"></div>
<div class="section-label">Recent Prompts</div>
<div id="list">
  <div class="empty"><span class="empty-icon">&#129302;</span>No prompts sent yet.<br>Select code &amp; press <strong>Ctrl+Alt+C</strong></div>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  let state = { selectedProvider: 'copilot', providers: [], history: [] };
  const userExpanded = new Set();
  const userCollapsed = new Set();

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmt(iso) { return new Date(iso).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
  function providerLabel(id) { const p=state.providers.find(x=>x.id===id); return p?p.label:id; }

  function isExpanded(e) {
    if (userCollapsed.has(e.id)) return false;
    if (userExpanded.has(e.id)) return true;
    // Auto-expand streaming entries and newly-sent entries (so the Mark Done button is visible)
    return e.status === 'streaming' || e.status === 'sent' || e.response.length > 0;
  }

  function badgeHtml(status) {
    const L = {streaming:'&#9889; Thinking',complete:'&#10003; Done',error:'&#9888; Error',sent:'&#8987; Sent'};
    return '<span class="badge badge-'+status+'">'+(L[status]||status)+'</span>';
  }

  function renderEntry(e) {
    const expanded = isExpanded(e);
    const hasResp = e.response && e.response.length > 0;
    let bodyHtml = '';
    if (e.status === 'streaming') {
      const preHtml = hasResp ? '<pre class="response-text" id="resp-'+e.id+'">'+escHtml(e.response)+'<span class="cursor"></span></pre>' : '';
      bodyHtml = '<div class="entry-body">'+preHtml+'<div class="entry-actions"><button class="act-btn danger" data-cancel="'+e.id+'">&#9632; Stop</button></div></div>';
    } else if (e.status === 'sent') {
      bodyHtml = '<div class="entry-body"><div class="entry-actions"><button class="act-btn" data-done="'+e.id+'">&#10003; Mark Done (stop button gone?)</button></div></div>';
    } else if (e.status === 'error') {
      bodyHtml = '<div class="entry-body"><div class="error-msg">&#9888; '+escHtml(e.error||'Unknown error')+'</div>'+(hasResp?'<pre class="response-text" id="resp-'+e.id+'">'+escHtml(e.response)+'</pre>':'')+'</div>';
    } else if (hasResp) {
      bodyHtml = '<div class="entry-body"><pre class="response-text" id="resp-'+e.id+'">'+escHtml(e.response)+'</pre><div class="entry-actions"><button class="act-btn" data-copy="'+e.id+'">&#128203; Copy</button></div></div>';
    }
    return '<div class="entry'+(expanded?' expanded':'')+(e.status==='streaming'?' streaming':'')+'" data-id="'+e.id+'">'
      +(e.status==='streaming'?'<div class="thinking-bar"></div>':'')
      +'<div class="entry-header" data-toggle="'+e.id+'">'
      +'<div class="entry-top"><span class="entry-chevron">&#9654;</span><span class="entry-name">'+escHtml(e.templateLabel)+'</span>'+badgeHtml(e.status)+'</div>'
      +'<div class="entry-meta"><span class="entry-file" title="'+escHtml(e.filename)+'">'+escHtml(e.filename)+'</span>'
      +'<span class="entry-provider">'+escHtml(providerLabel(e.provider))+'</span>'
      +'<span class="entry-time">'+fmt(e.timestamp)+'</span></div></div>'
      +bodyHtml+'</div>';
  }

  function wireList(list) {
    list.querySelectorAll('[data-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.toggle;
        const card = list.querySelector('[data-id="'+id+'"]');
        const exp = card && card.classList.contains('expanded');
        if (exp) { userCollapsed.add(id); userExpanded.delete(id); }
        else      { userExpanded.add(id);  userCollapsed.delete(id); }
        if (card) card.classList.toggle('expanded', !exp);
      });
    });
    list.querySelectorAll('[data-cancel]').forEach(btn => {
      btn.addEventListener('click', () => vscode.postMessage({command:'cancelStream',id:btn.dataset.cancel}));
    });
    list.querySelectorAll('[data-done]').forEach(btn => {
      btn.addEventListener('click', () => vscode.postMessage({command:'markComplete',id:btn.dataset.done}));
    });
    list.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', () => vscode.postMessage({command:'copyResponse',id:btn.dataset.copy}));
    });
  }

  function renderProviders() {
    const row = document.getElementById('providerRow');
    row.innerHTML = state.providers.map(p => {
      const active = p.id===state.selectedProvider?' active':'';
      const dis = !p.installed?' disabled title="Extension not installed"':'';
      return '<button class="provider-btn'+active+'" data-id="'+p.id+'"'+dis+'>'+p.label+(!p.installed?' \u2717':'')+'</button>';
    }).join('');
    row.querySelectorAll('.provider-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => vscode.postMessage({command:'setProvider',provider:btn.dataset.id}));
    });
  }

  function renderHistory() {
    const list = document.getElementById('list');
    if (!state.history.length) {
      list.innerHTML = '<div class="empty"><span class="empty-icon">&#129302;</span>No prompts sent yet.<br>Select code &amp; press <strong>Ctrl+Alt+C</strong></div>';
      return;
    }
    list.innerHTML = state.history.map(renderEntry).join('');
    wireList(list);
  }

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.command === 'update') {
      state = msg;
      renderProviders();
      renderHistory();
    } else if (msg.command === 'chunk') {
      const respEl = document.getElementById('resp-'+msg.id);
      if (respEl) {
        const cur = respEl.querySelector('.cursor');
        if (cur) cur.remove();
        respEl.appendChild(document.createTextNode(msg.text));
        const curSpan = document.createElement('span');
        curSpan.className = 'cursor';
        respEl.appendChild(curSpan);
        respEl.scrollTop = respEl.scrollHeight;
        // keep local state in sync
        const entry = state.history.find(h => h.id === msg.id);
        if (entry) entry.response += msg.text;
      } else {
        // entry body not rendered (collapsed)  update state and maybe expand
        const entry = state.history.find(h => h.id === msg.id);
        if (entry) {
          entry.response += msg.text;
          if (!userCollapsed.has(msg.id)) {
            userExpanded.add(msg.id);
            renderHistory();
          }
        }
      }
    }
  });
</script>
</body>
</html>`;
  }
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

function getEditorContext(editor: vscode.TextEditor): {
  content: string;
  filename: string;
  isSelection: boolean;
} {
  const selection = editor.selection;
  const isSelection = !selection.isEmpty;
  const content = isSelection
    ? editor.document.getText(selection)
    : editor.document.getText();

  const filename = editor.document.fileName
    ? vscode.workspace.asRelativePath(editor.document.fileName)
    : editor.document.languageId || 'untitled';

  return { content, filename, isSelection };
}

// ---------------------------------------------------------------------------
// Quick-pick helper
// ---------------------------------------------------------------------------

async function pickPromptTemplate(): Promise<PromptTemplate | undefined> {
  const items: (vscode.QuickPickItem & { template: PromptTemplate })[] =
    PROMPT_TEMPLATES.map((t) => ({
      label: t.label,
      description: t.description,
      template: t,
    }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'AutoDev: Choose a Prompt',
    placeHolder: 'Select how to process the code across',
    matchOnDescription: true,
  });

  return picked?.template;
}



// ---------------------------------------------------------------------------
// Main command handler
// ---------------------------------------------------------------------------

/** Fire Ctrl+V then Enter into the currently focused window via OS-level key send. */
function sendPasteAndEnter(): void {
  const platform = process.platform;
  let cmd: string;
  if (platform === 'win32') {
    cmd = String.raw`powershell -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v{ENTER}')"`;
  } else if (platform === 'darwin') {
    cmd = `osascript -e 'tell application "System Events" to keystroke "v" using command down' -e 'tell application "System Events" to key code 36'`;
  } else {
    cmd = 'xdotool key ctrl+v Return';
  }
  exec(cmd, (err) => { if (err) { log(`sendPasteAndEnter error: ${err.message}`); } });
  log(`Paste+Enter sent (${platform})`);
}

async function handleSendToChat(sidebarProvider: ChatStatusViewProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('AutoDev: No active editor found.');
    return;
  }

  const { content, filename, isSelection } = getEditorContext(editor);
  if (!content.trim()) {
    vscode.window.showWarningMessage(`AutoDev: The ${isSelection ? 'selection' : 'file'} is empty.`);
    return;
  }

  const MAX_CHARS = 80_000;
  const safeContent = content.length > MAX_CHARS ? content.slice(0, MAX_CHARS) : content;

  const template = await pickPromptTemplate();
  if (!template) { return; }

  const prompt = template.build(safeContent, filename);
  const providerId = sidebarProvider.selectedProvider;
  const providerCfg = PROVIDERS[providerId];

  if (!vscode.extensions.getExtension(providerCfg.extensionId)) {
    vscode.window.showErrorMessage(`AutoDev: "${providerCfg.label}" extension is not installed.`);
    return;
  }

  const id = sidebarProvider.addEntry(template.label, filename, providerId, 'sent');
  log(`Task started → ${id} (${providerCfg.label})`);

  let done = false;
  const complete = () => {
    if (done) { return; }
    done = true;
    saveSub.dispose();
    selSub.dispose();
    clearInterval(acceptInterval);
    clearInterval(quietInterval);
    clearTimeout(safetyTimer);
    log(`✅ Task ${id} → COMPLETE`);
    sidebarProvider.markComplete(id);
  };

  sidebarProvider.registerExternalComplete(id, complete);

  // ===================== OPEN CHAT =====================
  try {
    if (providerId === 'claude') {
      // claude-vscode.editor.open(sessionId, initialPrompt) opens a panel and
      // Check if a Claude panel is already open
      const claudeTab = vscode.window.tabGroups.all
        .flatMap(g => g.tabs)
        .find(t => t.input instanceof vscode.TabInputWebview &&
          t.input.viewType.includes('claudeVSCodePanel'));

      const panelAlreadyOpen = !!claudeTab;
      log(`Claude panel already open: ${panelAlreadyOpen}`);

      if (panelAlreadyOpen) {
        // Panel exists — reveal it, paste prompt via clipboard, then Enter
        await vscode.env.clipboard.writeText(prompt);
        await Promise.resolve(vscode.commands.executeCommand('claude-vscode.focus'));
        setTimeout(() => {
          sendPasteAndEnter();
        }, 600);
        log('Reusing existing Claude panel (paste + enter)');
      } else {
        // No panel — open with sessionId so it resumes the last session
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const sessionId = workspaceRoot ? findLatestClaudeSession(workspaceRoot) : undefined;
        log(`Opening Claude panel, sessionId=${sessionId ?? 'new'}`);

        await Promise.resolve(vscode.commands.executeCommand(
          'claude-vscode.editor.open',
          sessionId,  // resume existing session (or undefined = new)
          prompt,     // prefills the input box
        ));

        // Wait for panel + input to be ready, then auto-submit
        setTimeout(async () => {
          await Promise.resolve(vscode.commands.executeCommand('claude-vscode.focus'));
          setTimeout(sendPasteAndEnter, 400);
        }, 1800);
        log('New Claude panel opened with prefilled prompt');
      }
    } else {
      await Promise.resolve(vscode.commands.executeCommand('workbench.action.chat.open', {
        query: prompt,
        isPartialQuery: false,
      }));
      log('Opened Copilot chat');
    }
  } catch {
    vscode.window.showErrorMessage(`AutoDev: Could not open ${providerCfg.label} chat.`);
    sidebarProvider.markComplete(id);
    return;
  }

  // ===================== AUTO-ACCEPT =====================
  const ACCEPT_CMDS = [
    'chatEditor.action.acceptAllHunks',
    'chatEditor.action.acceptAllFiles',
    'workbench.action.chat.editing.acceptAllFiles',
    'workbench.action.chat.editing.acceptAll',
    'github.copilot.chat.acceptAllEdits',
    'chat.acceptAllEdits',
  ];

  const acceptInterval = setInterval(() => {
    ACCEPT_CMDS.forEach(cmd => vscode.commands.executeCommand(cmd).then(() => {}, () => {}));
  }, 800);

  // ===================== DETECTION =====================
  let activityDetected = false;

  const saveSub = vscode.workspace.onDidSaveTextDocument(() => {
    activityDetected = true;
    log('→ Agent saved file');
  });

  const selSub = vscode.window.onDidChangeTextEditorSelection(() => {
    if (activityDetected) {
      log('→ User returned to editor → marking complete');
      complete();
    }
  });

  const quietInterval = setInterval(() => {
    if (activityDetected) {
      log('Quiet period (20s) → marking complete');
      complete();
    }
  }, 20000);

  const safetyTimer = setTimeout(() => {
    log('Safety timeout (10 min)');
    complete();
  }, 10 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

async function applyAutoAcceptSettings(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();

  await cfg.update('chat.editing.autoAcceptDelay', 800, vscode.ConfigurationTarget.Global);
  await cfg.update('github.copilot.chat.agent.runTasks', true, vscode.ConfigurationTarget.Global);
  await cfg.update('chat.editing.autoAccept', true, vscode.ConfigurationTarget.Global);

  log('Auto-accept settings applied');
}

export function activate(context: vscode.ExtensionContext): void {
  _out = vscode.window.createOutputChannel('AutoDev');

  const sidebarProvider = new ChatStatusViewProvider(context.extensionUri, context);

  // Apply Copilot auto-accept settings silently on startup
  applyAutoAcceptSettings();
  log('Extension activated');

  context.subscriptions.push(
    _out,
    vscode.window.registerWebviewViewProvider(
      ChatStatusViewProvider.viewType,
      sidebarProvider
    ),

    vscode.commands.registerCommand('autodev.sendToChat', () =>
      handleSendToChat(sidebarProvider)
    ),

    vscode.commands.registerCommand('autodev.clearHistory', () =>
      sidebarProvider.clearHistory()
    ),

    vscode.commands.registerCommand('autodev.setProvider', (id: ProviderId) => {
      sidebarProvider._setProvider(id);
    })
  );
}

export function deactivate(): void {}
