import * as vscode from 'vscode';
import * as path from 'path';
import { ProviderId, ProviderConfig, PROVIDERS } from './providers';
import { LoopState } from './taskLoop';
import { loadSettings, saveSettings, AutodevSettings } from './settings';
import { Task, parseTodo, appendTask } from './todo';

// ---------------------------------------------------------------------------
// TodoViewProvider — sidebar webview that shows TODO.md tasks + loop controls
// ---------------------------------------------------------------------------

const PROVIDER_KEY = 'autodev.selectedProvider';

export class TodoViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'autodev.chatStatus';

  private _view?: vscode.WebviewView;
  private _tasks: Task[] = [];
  private _loopState: LoopState = 'idle';
  private _loopTask?: string;
  private _selectedProvider: ProviderId;
  private _watcher?: vscode.FileSystemWatcher;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    this._selectedProvider =
      this._context.globalState.get<ProviderId>(PROVIDER_KEY) ?? 'copilot';
  }

  get selectedProvider(): ProviderId { return this._selectedProvider; }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
    webviewView.webview.html = buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => {
      switch (msg.command) {
        case 'setProvider': this.setProvider(msg.provider as ProviderId); break;
        case 'addTask':     this._addTask(msg.text as string); break;
        case 'startLoop':   void vscode.commands.executeCommand('autodev.startTaskLoop'); break;
        case 'stopLoop':    void vscode.commands.executeCommand('autodev.stopTaskLoop'); break;
        case 'saveSettings':
          saveSettings(msg.settings as AutodevSettings);
          this._startWatcher();
          vscode.window.showInformationMessage('AutoDev: Settings saved.');
          break;
        case 'openSettings': void vscode.commands.executeCommand('autodev.openSettings'); break;
      }
    });

    webviewView.onDidDispose(() => { this._watcher?.dispose(); this._watcher = undefined; });
    webviewView.onDidChangeVisibility(() => { if (webviewView.visible) { this._refreshTasks(); } });

    this._startWatcher();
    this._refreshTasks();
  }

  setLoopState(state: LoopState, task?: string): void {
    this._loopState = state;
    this._loopTask = task;
    this._push();
  }

  setProvider(id: ProviderId): void {
    this._selectedProvider = id;
    this._context.globalState.update(PROVIDER_KEY, id);
    this._push();
  }

  refresh(): void { this._refreshTasks(); }

  private _addTask(text: string): void {
    if (!text.trim()) { return; }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { vscode.window.showWarningMessage('AutoDev: No workspace folder open.'); return; }
    const settings = loadSettings();
    const todoPath = settings.todoPath || path.join(root, 'TODO.md');
    appendTask(todoPath, text.trim());
    this._refreshTasks();
  }

  private _startWatcher(): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { return; }
    const settings = loadSettings();
    const todoPath = settings.todoPath || path.join(root, 'TODO.md');
    this._watcher?.dispose();
    this._watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.dirname(todoPath), path.basename(todoPath))
    );
    this._watcher.onDidChange(() => this._refreshTasks());
    this._watcher.onDidCreate(() => this._refreshTasks());
    this._watcher.onDidDelete(() => { this._tasks = []; this._push(); });
  }

  private _refreshTasks(): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { this._tasks = []; this._push(); return; }
    const settings = loadSettings();
    const todoPath = settings.todoPath || path.join(root, 'TODO.md');
    this._tasks = parseTodo(todoPath);
    this._push();
  }

  private _push(): void {
    this._view?.webview.postMessage({
      command: 'update',
      selectedProvider: this._selectedProvider,
      providers: (Object.entries(PROVIDERS) as [ProviderId, ProviderConfig][]).map(([id, cfg]) => ({
        id,
        label: cfg.label,
        installed: !!vscode.extensions.getExtension(cfg.extensionId),
      })),
      tasks: this._tasks.map(t => ({ text: t.text, status: t.status, completedDate: t.completedDate })),
      loopState: this._loopState,
      loopTask: this._loopTask,
      settings: loadSettings(),
    });
  }
}

// ---------------------------------------------------------------------------
// HTML for the sidebar webview (pure function — easy to edit independently)
// ---------------------------------------------------------------------------

function buildHtml(webview: vscode.Webview): string {
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
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
.provider-row{display:flex;gap:6px;margin:10px 0 10px}
.provider-btn{flex:1;padding:5px 0;border-radius:4px;border:1px solid var(--vscode-button-background);background:transparent;color:var(--vscode-button-background);cursor:pointer;font-family:var(--vscode-font-family);font-size:12px;font-weight:500}
.provider-btn.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.provider-btn:disabled{opacity:.35;cursor:not-allowed;border-color:var(--vscode-disabledForeground);color:var(--vscode-disabledForeground)}
.loop-bar{display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:4px;margin-bottom:10px;font-size:12px}
.loop-status{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--vscode-descriptionForeground)}
.loop-status.running{color:var(--vscode-testing-iconPassed,#388a34);font-weight:600}
.loop-btn{padding:3px 8px;border-radius:3px;cursor:pointer;border:1px solid var(--vscode-button-background);background:transparent;color:var(--vscode-button-background);font-family:var(--vscode-font-family);font-size:11px;white-space:nowrap}
.loop-btn:hover:not(:disabled){background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.loop-btn:disabled{opacity:.4;cursor:not-allowed}
.loop-btn.stop{border-color:var(--vscode-testing-iconFailed,#c72e2e);color:var(--vscode-testing-iconFailed,#c72e2e)}
.loop-btn.stop:hover{background:var(--vscode-testing-iconFailed,#c72e2e);color:#fff}
.settings-btn{padding:3px 6px;border-radius:3px;cursor:pointer;border:1px solid var(--vscode-panel-border);background:transparent;color:var(--vscode-descriptionForeground);font-size:13px;line-height:1}
.settings-btn:hover{background:var(--vscode-list-hoverBackground)}
.add-form{display:flex;gap:5px;margin-bottom:12px}
.add-input{flex:1;padding:5px 7px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:3px;outline:none;min-width:0}
.add-input:focus{border-color:var(--vscode-focusBorder)}
.add-btn{padding:5px 10px;border-radius:3px;cursor:pointer;border:none;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font-family:var(--vscode-font-family);font-size:12px;flex-shrink:0}
.add-btn:hover{opacity:.88}
.section-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--vscode-sideBarSectionHeader-foreground,var(--vscode-descriptionForeground));margin-bottom:6px}
.empty{text-align:center;color:var(--vscode-descriptionForeground);font-size:12px;padding:24px 0 8px;line-height:2}
.task{display:flex;align-items:flex-start;gap:7px;padding:5px 6px;border-radius:4px;margin-bottom:2px}
.task:hover{background:var(--vscode-list-hoverBackground)}
.task-icon{flex-shrink:0;font-size:14px;line-height:1.3;width:16px;text-align:center}
.task-body{flex:1;min-width:0}
.task-text{font-size:12px;line-height:1.45;word-break:break-word}
.task.done .task-text{opacity:.45;text-decoration:line-through}
.task.in-progress{background:color-mix(in srgb,var(--vscode-statusBarItem-warningBackground,#b5630d) 14%,transparent)}
.task-date{font-size:10px;color:var(--vscode-descriptionForeground);margin-top:1px}
.pulse{animation:pulse 1.4s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.tab-bar{display:flex;border-bottom:1px solid var(--vscode-panel-border);margin-bottom:8px}
.tab-btn{flex:1;padding:5px 0;font-size:12px;cursor:pointer;border:none;background:transparent;color:var(--vscode-descriptionForeground);border-bottom:2px solid transparent;margin-bottom:-1px;font-family:var(--vscode-font-family)}
.tab-btn.active{color:var(--vscode-foreground);border-bottom-color:var(--vscode-button-background);font-weight:600}
.cfg-section{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--vscode-sideBarSectionHeader-foreground,var(--vscode-descriptionForeground));margin:10px 0 5px;padding-top:8px;border-top:1px solid var(--vscode-panel-border)}
.cfg-section:first-child{border-top:none;margin-top:0;padding-top:0}
.cfg-field{margin-bottom:7px}
.cfg-label{display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:2px}
.cfg-input{width:100%;padding:4px 6px;font-family:var(--vscode-font-family);font-size:12px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:3px;outline:none}
.cfg-input:focus{border-color:var(--vscode-focusBorder)}
.cfg-row{display:flex;gap:5px}
.cfg-row .cfg-field{flex:1;min-width:0}
.cfg-save{width:100%;padding:5px;border-radius:3px;cursor:pointer;border:none;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font-family:var(--vscode-font-family);font-size:12px;margin-top:8px}
.cfg-save:hover{opacity:.88}
.cfg-json{display:block;width:100%;padding:4px;border-radius:3px;cursor:pointer;border:1px solid var(--vscode-panel-border);background:transparent;color:var(--vscode-textLink-foreground);font-size:11px;font-family:var(--vscode-font-family);margin-top:5px;text-align:center}
.cfg-json:hover{background:var(--vscode-list-hoverBackground)}
</style>
</head>
<body>
<div class="provider-row" id="providerRow"></div>
<div class="loop-bar">
  <span class="loop-status" id="loopStatus">&#9711; Idle</span>
  <button class="loop-btn" id="loopBtn">&#9654; Start</button>
</div>
<div class="tab-bar">
  <button class="tab-btn active" id="tabTasks">Tasks</button>
  <button class="tab-btn" id="tabSettings">&#9881; Settings</button>
</div>
<div id="panelTasks">
<form class="add-form" id="addForm">
  <input class="add-input" id="taskInput" placeholder="New task&#x2026;" autocomplete="off">
  <button class="add-btn" type="submit">Add</button>
</form>
<div class="section-label">Tasks</div>
<div id="taskList"></div>
</div>
<div id="panelSettings" style="display:none">
  <div class="cfg-section">Server</div>
  <div class="cfg-field"><label class="cfg-label">Server Base URL</label><input class="cfg-input" id="cfg_serverBaseUrl" placeholder="https://myserver.com"></div>
  <div class="cfg-field"><label class="cfg-label">Server API Key</label><input class="cfg-input" id="cfg_serverApiKey" type="password" placeholder="api-key"></div>
  <div class="cfg-field"><label class="cfg-label">Webhook Slug</label><input class="cfg-input" id="cfg_webhookSlug" placeholder="my-slug"></div>
  <div class="cfg-section">Discord</div>
  <div class="cfg-field"><label class="cfg-label">Bot Token</label><input class="cfg-input" id="cfg_discordToken" type="password" placeholder="Bot token"></div>
  <div class="cfg-field"><label class="cfg-label">Channel ID</label><input class="cfg-input" id="cfg_discordChannelId" placeholder="123456789"></div>
  <div class="cfg-field"><label class="cfg-label">Webhook URL</label><input class="cfg-input" id="cfg_discordWebhookUrl" placeholder="https://discord.com/api/webhooks/..."></div>
  <div class="cfg-field"><label class="cfg-label">Allowed Owners</label><input class="cfg-input" id="cfg_discordOwners" placeholder="user1,user2"></div>
  <div class="cfg-section">Loop</div>
  <div class="cfg-row">
    <div class="cfg-field"><label class="cfg-label">Idle Interval (s)</label><input class="cfg-input" id="cfg_loopInterval" type="number" min="1" max="3600"></div>
    <div class="cfg-field"><label class="cfg-label">Task Timeout (min)</label><input class="cfg-input" id="cfg_taskTimeoutMinutes" type="number" min="1" max="1440"></div>
    <div class="cfg-field"><label class="cfg-label">Check-in Interval (min)</label><input class="cfg-input" id="cfg_taskCheckInMinutes" type="number" min="1" max="1440"></div>
  </div>
  <div class="cfg-row">
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_retryOnTimeout"> Retry on timeout</label></div>
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_autoResetPendingTasks"> Auto-reset pending tasks on start</label></div>
  </div>
  <div class="cfg-section">Paths</div>
  <div class="cfg-field"><label class="cfg-label">TODO.md Path</label><input class="cfg-input" id="cfg_todoPath" placeholder="(workspace root)"></div>
  <div class="cfg-field"><label class="cfg-label">Profile (AUTODEV.md)</label><input class="cfg-input" id="cfg_profilePath" placeholder="(workspace root)"></div>
  <button class="cfg-save" id="saveSettingsBtn">Save Settings</button>
  <button class="cfg-json" id="editJsonBtn">Edit raw JSON</button>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let state = {selectedProvider:'copilot',providers:[],tasks:[],loopState:'idle',loopTask:null,settings:{}};

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function statusIcon(s){
  if(s==='done') return '<span style="color:var(--vscode-testing-iconPassed,#388a34)">&#10003;</span>';
  if(s==='in-progress') return '<span class="pulse" style="color:var(--vscode-statusBarItem-warningBackground,#e8ae00)">&#9681;</span>';
  return '<span style="opacity:.4">&#9675;</span>';
}

function renderProviders(){
  const row=document.getElementById('providerRow');
  row.innerHTML=state.providers.map(function(p){
    const active=p.id===state.selectedProvider?' active':'';
    const dis=!p.installed?' disabled title="Not installed"':'';
    return '<button class="provider-btn'+active+'" data-id="'+p.id+'"'+dis+'>'+esc(p.label)+(p.installed?'':' \u2717')+'</button>';
  }).join('');
  row.querySelectorAll('.provider-btn:not([disabled])').forEach(function(btn){
    btn.addEventListener('click',function(){vscode.postMessage({command:'setProvider',provider:btn.dataset.id});});
  });
}

function renderLoop(){
  const statusEl=document.getElementById('loopStatus');
  const btnEl=document.getElementById('loopBtn');
  if(state.loopState==='running'){
    statusEl.className='loop-status running';
    statusEl.innerHTML=state.loopTask?'&#9654; '+esc(state.loopTask):'&#9654; Running\u2026';
    btnEl.className='loop-btn stop';
    btnEl.innerHTML='&#9632; Stop';
    btnEl.disabled=false;
    btnEl.onclick=function(){vscode.postMessage({command:'stopLoop'});};
  }else if(state.loopState==='stopping'){
    statusEl.className='loop-status';
    statusEl.textContent='Stopping\u2026';
    btnEl.className='loop-btn';
    btnEl.innerHTML='&#9632; Stop';
    btnEl.disabled=true;
  }else{
    statusEl.className='loop-status';
    statusEl.innerHTML='&#9711; Idle';
    btnEl.className='loop-btn';
    btnEl.innerHTML='&#9654; Start';
    btnEl.disabled=false;
    btnEl.onclick=function(){vscode.postMessage({command:'startLoop'});};
  }
}

function renderTasks(){
  const list=document.getElementById('taskList');
  if(!state.tasks.length){
    list.innerHTML='<div class="empty">No tasks in TODO.md yet.<br>Add one above or edit <strong>TODO.md</strong> directly.</div>';
    return;
  }
  const pending=state.tasks.filter(function(t){return t.status!=='done';});
  const done=state.tasks.filter(function(t){return t.status==='done';});
  list.innerHTML=pending.concat(done).map(function(t){
    return '<div class="task '+t.status+'">'
      +'<span class="task-icon">'+statusIcon(t.status)+'</span>'
      +'<div class="task-body"><div class="task-text">'+esc(t.text)+'</div>'
      +(t.completedDate?'<div class="task-date">'+esc(t.completedDate)+'</div>':'')
      +'</div></div>';
  }).join('');
}

function populateSettings(s){
  ['serverBaseUrl','serverApiKey','webhookSlug','discordToken','discordChannelId',
   'discordWebhookUrl','discordOwners','profilePath','todoPath'].forEach(function(k){
    const el=document.getElementById('cfg_'+k);
    if(el) el.value=s[k]||'';
  });
  const li=document.getElementById('cfg_loopInterval');
  if(li) li.value=s.loopInterval!==undefined?s.loopInterval:30;
  const tt=document.getElementById('cfg_taskTimeoutMinutes');
  if(tt) tt.value=s.taskTimeoutMinutes!==undefined?s.taskTimeoutMinutes:30;
  const ci=document.getElementById('cfg_taskCheckInMinutes');
  if(ci) ci.value=s.taskCheckInMinutes!==undefined?s.taskCheckInMinutes:20;
  const rot=document.getElementById('cfg_retryOnTimeout');
  if(rot) rot.checked=!!s.retryOnTimeout;
  const arp=document.getElementById('cfg_autoResetPendingTasks');
  if(arp) arp.checked=s.autoResetPendingTasks!==false;
}

document.getElementById('tabTasks').addEventListener('click',function(){
  this.className='tab-btn active';
  document.getElementById('tabSettings').className='tab-btn';
  document.getElementById('panelTasks').style.display='';
  document.getElementById('panelSettings').style.display='none';
});
document.getElementById('tabSettings').addEventListener('click',function(){
  this.className='tab-btn active';
  document.getElementById('tabTasks').className='tab-btn';
  document.getElementById('panelTasks').style.display='none';
  document.getElementById('panelSettings').style.display='';
  populateSettings(state.settings||{});
});

document.getElementById('addForm').addEventListener('submit',function(e){
  e.preventDefault();
  const input=document.getElementById('taskInput');
  const text=input.value.trim();
  if(!text){return;}
  vscode.postMessage({command:'addTask',text:text});
  input.value='';
  input.focus();
});

document.getElementById('saveSettingsBtn').addEventListener('click',function(){
  const s={
    provider:state.selectedProvider,
    serverBaseUrl:document.getElementById('cfg_serverBaseUrl').value,
    serverApiKey:document.getElementById('cfg_serverApiKey').value,
    webhookSlug:document.getElementById('cfg_webhookSlug').value,
    discordToken:document.getElementById('cfg_discordToken').value,
    discordChannelId:document.getElementById('cfg_discordChannelId').value,
    discordWebhookUrl:document.getElementById('cfg_discordWebhookUrl').value,
    discordOwners:document.getElementById('cfg_discordOwners').value,
    loopInterval:parseInt(document.getElementById('cfg_loopInterval').value)||30,
    taskTimeoutMinutes:parseInt(document.getElementById('cfg_taskTimeoutMinutes').value)||30,
    taskCheckInMinutes:parseInt(document.getElementById('cfg_taskCheckInMinutes').value)||20,
    retryOnTimeout:document.getElementById('cfg_retryOnTimeout').checked,
    autoResetPendingTasks:document.getElementById('cfg_autoResetPendingTasks').checked,
    profilePath:document.getElementById('cfg_profilePath').value,
    todoPath:document.getElementById('cfg_todoPath').value,
  };
  vscode.postMessage({command:'saveSettings',settings:s});
  document.getElementById('tabTasks').click();
});

document.getElementById('editJsonBtn').addEventListener('click',function(){
  vscode.postMessage({command:'openSettings'});
});

window.addEventListener('message',function(e){
  const msg=e.data;
  if(msg.command==='update'){state=msg;renderProviders();renderLoop();renderTasks();}
});
</script>
</body>
</html>`;
}
