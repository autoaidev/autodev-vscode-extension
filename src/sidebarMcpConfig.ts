// ---------------------------------------------------------------------------
// sidebarMcpConfig — MCP servers panel inside the sidebar webview.
//
// This module owns the entire MCP tab: CSS, HTML markup, and the inline JS
// that runs inside the webview. Kept separate from sidebar.ts so the MCP UI
// (built-in toggles, accordion cards for Jira / Email / Custom) can be edited
// without touching the rest of the sidebar.
//
// The webview script has access to globals defined by sidebar.ts:
//   - `vscode`  — webview API (postMessage)
//   - `state`   — most recent push from the extension
//   - `esc(s)`  — HTML escaper
// And it sends back these messages, all handled in sidebar.ts:
//   - saveMcpBulk       { entries: { name: {command, args, env, enabled} } }
//   - removeMcpEntry    { name }
//   - toggleBuiltinMcp  { name, enabled }
//
// Sidebar.ts must call `populateMcp(state.settings, state.mcpDefaults)` when
// the MCP tab becomes visible.
// ---------------------------------------------------------------------------

export const mcpConfigCss = `
.mcp-acc{border:1px solid var(--vscode-panel-border);border-radius:4px;margin-bottom:8px;background:var(--vscode-editor-background);overflow:hidden}
.mcp-acc-head{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;user-select:none;background:var(--vscode-sideBarSectionHeader-background,transparent)}
.mcp-acc-head:hover{background:var(--vscode-list-hoverBackground)}
.mcp-acc-head input[type=checkbox]{flex-shrink:0;cursor:pointer;margin:0}
.mcp-acc-title{flex:1;font-size:12px;font-weight:600;color:var(--vscode-foreground);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mcp-acc-sub{font-size:10px;color:var(--vscode-descriptionForeground);font-weight:400;margin-left:6px}
.mcp-acc-chev{flex-shrink:0;font-size:10px;color:var(--vscode-descriptionForeground);transition:transform .15s;transform:rotate(0deg);display:inline-block;width:10px;text-align:center}
.mcp-acc.open .mcp-acc-chev{transform:rotate(90deg)}
.mcp-acc-body{padding:10px;border-top:1px solid var(--vscode-panel-border);display:none}
.mcp-acc.open .mcp-acc-body{display:block}
.mcp-acc.disabled .mcp-acc-title{opacity:.55}
.mcp-builtin{display:flex;align-items:center;gap:8px;padding:5px 8px;border:1px solid var(--vscode-panel-border);border-radius:3px;margin-bottom:4px;background:var(--vscode-editor-background)}
.mcp-builtin input[type=checkbox]{flex-shrink:0;cursor:pointer;margin:0}
.mcp-builtin-name{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;color:var(--vscode-foreground);flex-shrink:0}
.mcp-builtin.disabled .mcp-builtin-name{opacity:.45;text-decoration:line-through}
.mcp-builtin-cmd{font-family:var(--vscode-editor-font-family,monospace);font-size:10px;opacity:.55;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;text-align:right}
.mcp-badge{flex-shrink:0;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;letter-spacing:.2px;line-height:14px;display:inline-flex;align-items:center;gap:3px}
.mcp-badge.ok{background:rgba(56,138,52,.18);color:var(--vscode-testing-iconPassed,#388a34)}
.mcp-badge.miss{background:rgba(199,46,46,.18);color:var(--vscode-testing-iconFailed,#c72e2e)}
.mcp-badge.unk{background:rgba(128,128,128,.2);color:var(--vscode-descriptionForeground)}
.mcp-install-btn{flex-shrink:0;background:var(--vscode-button-secondaryBackground,transparent);color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));border:1px solid var(--vscode-button-border,var(--vscode-panel-border));padding:2px 8px;border-radius:3px;font-size:10px;cursor:pointer;line-height:14px}
.mcp-install-btn:hover{background:var(--vscode-button-secondaryHoverBackground,var(--vscode-list-hoverBackground))}
.mcp-test-result{margin-top:8px;padding:8px 10px;border-radius:3px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;font-family:var(--vscode-editor-font-family,monospace);background:var(--vscode-textBlockQuote-background,rgba(127,127,127,.08));border-left:3px solid var(--vscode-descriptionForeground)}
.mcp-test-result.ok{border-left-color:var(--vscode-testing-iconPassed,#388a34)}
.mcp-test-result.fail{border-left-color:var(--vscode-testing-iconFailed,#c72e2e)}
.mcp-test-result .row{display:flex;gap:6px;align-items:flex-start}
.mcp-test-result .row+.row{margin-top:4px}
.mcp-test-result .ico{flex-shrink:0;font-weight:700}
.mcp-test-result .ico.ok{color:var(--vscode-testing-iconPassed,#388a34)}
.mcp-test-result .ico.fail{color:var(--vscode-testing-iconFailed,#c72e2e)}
.mcp-help{font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:8px;line-height:1.5}
.mcp-status{font-size:11px;margin:6px 0;min-height:14px}
.mcp-textarea{display:block;width:100%;min-height:280px;padding:8px 10px;font-family:var(--vscode-editor-font-family,monospace);font-size:12px;line-height:1.4;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:3px;resize:vertical;outline:none;box-sizing:border-box;white-space:pre}
.mcp-card-actions{display:flex;justify-content:flex-end;margin-top:8px}
.mcp-remove-btn{background:transparent;color:var(--vscode-testing-iconFailed,#c72e2e);border:1px solid var(--vscode-testing-iconFailed,#c72e2e);padding:4px 10px;border-radius:3px;font-size:11px;cursor:pointer}
.mcp-remove-btn:hover{background:var(--vscode-testing-iconFailed,#c72e2e);color:#fff}
.mcp-add-btn{display:block;width:100%;margin-top:6px;padding:7px;font-size:12px;background:transparent;color:var(--vscode-foreground);border:1px dashed var(--vscode-panel-border);border-radius:3px;cursor:pointer;text-align:center}.mcp-add-btn:hover{background:var(--vscode-list-hoverBackground)}
.mcp-save-all{position:sticky;bottom:0;display:block;width:100%;margin-top:14px;padding:9px 12px;font-size:13px;font-weight:600;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;box-shadow:0 -4px 8px -4px rgba(0,0,0,.25)}
.mcp-save-all:hover{background:var(--vscode-button-hoverBackground)}
.mcp-exp-tag{color:var(--vscode-editorWarning-foreground,#e8ae00)!important;text-transform:uppercase;letter-spacing:.4px;font-size:9px}
.mcp-prereq-warn{font-size:11px;color:var(--vscode-editorWarning-foreground,#e8ae00);background:rgba(232,174,0,.1);border-radius:3px;padding:6px 8px;margin:6px 0;line-height:1.5}
.mcp-steps{font-size:11px;color:var(--vscode-descriptionForeground);line-height:1.6;margin-top:8px;border-left:3px solid var(--vscode-testing-iconPassed,#388a34);padding:6px 10px;background:var(--vscode-textBlockQuote-background,rgba(127,127,127,.08))}
.mcp-steps ol{margin:4px 0 0;padding-left:18px}
.mcp-steps li{margin-bottom:3px}
.mcp-steps .mcp-steps-title{font-weight:600;color:var(--vscode-foreground)}
`;

export const mcpConfigHtml = `
<div id="panelMcp" style="display:none">
  <div style="font-size:11px;color:var(--vscode-descriptionForeground);line-height:1.5;margin:0 0 10px">Connect Jira, email, and other services your agent can use (MCP servers).</div>
  <div class="cfg-section" style="margin-top:0;padding-top:0;border-top:none">Built-in MCP servers</div>
  <div id="mcpDefaultsList" style="margin-bottom:12px"></div>

  <div class="cfg-section">User MCP servers</div>
  <div id="mcpStatus" class="mcp-status"></div>

  <!-- ── Jira / Confluence (mcp-atlassian) ───────────────────────────────── -->
  <div id="mcpAcc_jira" class="mcp-acc">
    <div class="mcp-acc-head" data-acc="jira">
      <input type="checkbox" id="mcpJira_enabled" title="Include in synced provider configs">
      <span class="mcp-acc-title">Jira / Confluence <span class="mcp-acc-sub">mcp-atlassian</span></span>
      <span class="mcp-badge unk" id="mcpJira_badge" style="display:none"></span>
      <button class="mcp-install-btn" id="mcpJira_install" style="display:none">Install</button>
      <span class="mcp-acc-chev">&#9656;</span>
    </div>
    <div class="mcp-acc-body">
      <div class="mcp-help">Run via <code style="font-size:11px">uvx mcp-atlassian</code>. Confluence fields are optional.</div>
      <div class="cfg-field"><label class="cfg-label">Jira URL</label><input class="cfg-input" id="mcpJira_url" placeholder="https://your-company.atlassian.net"></div>
      <div class="cfg-field"><label class="cfg-label">Jira Username (email)</label><input class="cfg-input" id="mcpJira_user" placeholder="you@company.com"></div>
      <div class="cfg-field"><label class="cfg-label">Jira API Token</label><input class="cfg-input" id="mcpJira_token" type="password" placeholder=""></div>
      <div class="cfg-field"><label class="cfg-label">Confluence URL <small style="opacity:.6">(optional)</small></label><input class="cfg-input" id="mcpJira_confUrl" placeholder="https://your-company.atlassian.net/wiki"></div>
      <div class="cfg-field"><label class="cfg-label">Confluence Username <small style="opacity:.6">(optional)</small></label><input class="cfg-input" id="mcpJira_confUser" placeholder="you@company.com"></div>
      <div class="cfg-field"><label class="cfg-label">Confluence API Token <small style="opacity:.6">(optional)</small></label><input class="cfg-input" id="mcpJira_confToken" type="password" placeholder=""></div>
      <div class="mcp-card-actions"><button class="mcp-remove-btn" id="removeMcpJiraBtn">Remove</button></div>
    </div>
  </div>

  <!-- ── Email (mcp-email-server) ────────────────────────────────────────── -->
  <div id="mcpAcc_email" class="mcp-acc">
    <div class="mcp-acc-head" data-acc="email">
      <input type="checkbox" id="mcpEmail_enabled" title="Include in synced provider configs">
      <span class="mcp-acc-title">Email <span class="mcp-acc-sub">zerolib-email · IMAP + SMTP</span></span>
      <span class="mcp-badge unk" id="mcpEmail_badge" style="display:none"></span>
      <button class="mcp-install-btn" id="mcpEmail_install" style="display:none">Install</button>
      <span class="mcp-acc-chev">&#9656;</span>
    </div>
    <div class="mcp-acc-body">
      <div class="mcp-help">From <a href="https://github.com/ai-zerolab/mcp-email-server" target="_blank" style="color:var(--vscode-textLink-foreground)">ai-zerolab/mcp-email-server</a>, run via <code style="font-size:11px">uvx</code>.</div>
      <div class="cfg-field"><label class="cfg-label">Account name</label><input class="cfg-input" id="mcpEmail_account" placeholder="work" value="default"></div>
      <div class="cfg-field"><label class="cfg-label">Display name <small style="opacity:.6">(optional)</small></label><input class="cfg-input" id="mcpEmail_fullName" placeholder="John Doe"></div>
      <div class="cfg-field"><label class="cfg-label">Email address</label><input class="cfg-input" id="mcpEmail_address" placeholder="you@example.com"></div>
      <div class="cfg-field"><label class="cfg-label">Login username <small style="opacity:.6">(defaults to email)</small></label><input class="cfg-input" id="mcpEmail_userName" placeholder=""></div>
      <div class="cfg-field"><label class="cfg-label">Password / App password</label><input class="cfg-input" id="mcpEmail_password" type="password"></div>
      <div class="cfg-section" style="margin:10px 0 4px;padding-top:6px">IMAP</div>
      <div class="cfg-row">
        <div class="cfg-field"><label class="cfg-label">IMAP host</label><input class="cfg-input" id="mcpEmail_imapHost" placeholder="imap.gmail.com"></div>
        <div class="cfg-field"><label class="cfg-label">IMAP port</label><input class="cfg-input" id="mcpEmail_imapPort" type="number" min="1" max="65535" value="993"></div>
      </div>
      <div class="cfg-row">
        <div class="cfg-field cfg-check"><label><input type="checkbox" id="mcpEmail_imapSsl" checked> SSL</label></div>
        <div class="cfg-field cfg-check"><label><input type="checkbox" id="mcpEmail_imapVerifySsl" checked> Verify SSL</label></div>
      </div>
      <div class="cfg-section" style="margin:10px 0 4px;padding-top:6px">SMTP</div>
      <div class="cfg-row">
        <div class="cfg-field"><label class="cfg-label">SMTP host</label><input class="cfg-input" id="mcpEmail_smtpHost" placeholder="smtp.gmail.com"></div>
        <div class="cfg-field"><label class="cfg-label">SMTP port</label><input class="cfg-input" id="mcpEmail_smtpPort" type="number" min="1" max="65535" value="465"></div>
      </div>
      <div class="cfg-row">
        <div class="cfg-field cfg-check"><label><input type="checkbox" id="mcpEmail_smtpSsl" checked> SSL</label></div>
        <div class="cfg-field cfg-check"><label><input type="checkbox" id="mcpEmail_smtpStartTls"> STARTTLS</label></div>
        <div class="cfg-field cfg-check"><label><input type="checkbox" id="mcpEmail_smtpVerifySsl" checked> Verify SSL</label></div>
      </div>
      <div class="cfg-section" style="margin:10px 0 4px;padding-top:6px">Options</div>
      <div class="cfg-field cfg-check"><label><input type="checkbox" id="mcpEmail_attachments"> Enable attachment download</label></div>
      <div class="cfg-field cfg-check"><label><input type="checkbox" id="mcpEmail_saveSent" checked> Save sent emails to IMAP Sent folder</label></div>
      <div class="cfg-field"><label class="cfg-label">Sent folder name <small style="opacity:.6">(optional — auto-detected)</small></label><input class="cfg-input" id="mcpEmail_sentFolder" placeholder="INBOX.Sent"></div>
      <div class="cfg-section" style="margin:10px 0 4px;padding-top:6px">Receive tasks from email</div>
      <div class="cfg-field cfg-check"><label><input type="checkbox" id="mcpEmail_receiveTasks"> Enable receiving tasks from email</label></div>
      <div class="cfg-field"><label class="cfg-label">Allowed sender emails <small style="opacity:.6">(CSV, wildcards OK — leave empty to allow all)</small></label><input class="cfg-input" id="mcpEmail_allowedSenders" placeholder="alice@example.com, agent-*@company.com"></div>
      <div class="mcp-card-actions" style="justify-content:space-between;gap:6px">
        <button class="mcp-install-btn" id="mcpEmail_testBtn" style="padding:4px 10px;font-size:11px">Test connection</button>
        <button class="mcp-remove-btn" id="removeMcpEmailBtn">Remove</button>
      </div>
      <div id="mcpEmail_testResult" class="mcp-test-result" style="display:none"></div>
    </div>
  </div>

  <!-- ── Creative apps (Blender / GIMP) ──────────────────────────────────── -->
  <div class="cfg-section">Creative apps</div>
  <div style="font-size:11px;color:var(--vscode-descriptionForeground);line-height:1.5;margin:0 0 8px">Detected creative apps your agent can drive over MCP. Enabling writes the server to <code style="font-size:11px">.mcp.json</code> and syncs it to every provider — you still finish a couple of in-app steps.</div>

  <!-- Blender -->
  <div id="mcpAcc_blender" class="mcp-acc">
    <div class="mcp-acc-head" data-acc="blender">
      <input type="checkbox" id="mcpBlender_enabled" title="Enable the Blender MCP server" disabled>
      <span class="mcp-acc-title">Blender <span class="mcp-acc-sub">blender-mcp · uvx</span></span>
      <span class="mcp-badge unk" id="mcpBlender_detect" style="display:none"></span>
      <button class="mcp-install-btn" id="mcpBlender_prereqBtn" style="display:none">Install uvx</button>
      <span class="mcp-acc-chev">&#9656;</span>
    </div>
    <div class="mcp-acc-body">
      <div class="mcp-help" id="mcpBlender_detectLine">Checking for Blender…</div>
      <div class="mcp-prereq-warn" id="mcpBlender_prereqWarn" style="display:none"></div>
      <div class="mcp-steps" id="mcpBlender_steps" style="display:none"></div>
    </div>
  </div>

  <!-- GIMP (experimental) -->
  <div id="mcpAcc_gimp" class="mcp-acc">
    <div class="mcp-acc-head" data-acc="gimp">
      <input type="checkbox" id="mcpGimp_enabled" title="Enable the GIMP MCP server" disabled>
      <span class="mcp-acc-title">GIMP <span class="mcp-acc-sub mcp-exp-tag">experimental</span></span>
      <span class="mcp-badge unk" id="mcpGimp_detect" style="display:none"></span>
      <button class="mcp-install-btn" id="mcpGimp_prereqBtn" style="display:none">Install python</button>
      <span class="mcp-acc-chev">&#9656;</span>
    </div>
    <div class="mcp-acc-body">
      <div class="mcp-help" id="mcpGimp_detectLine">Checking for GIMP…</div>
      <div class="mcp-prereq-warn" id="mcpGimp_notes" style="display:none"></div>
      <div class="mcp-prereq-warn" id="mcpGimp_prereqWarn" style="display:none"></div>
      <div class="mcp-steps" id="mcpGimp_steps" style="display:none"></div>
      <details style="margin-top:6px">
        <summary style="font-size:11px;opacity:.7;cursor:pointer">Advanced: use a custom gimp_mcp_client.py</summary>
        <div class="cfg-field"><label class="cfg-label">gimp_mcp_client.py path <small style="opacity:.6">(optional — overrides the auto-installed client)</small></label><input class="cfg-input" id="mcpGimp_client" placeholder="/path/to/gimp-mcp/gimp_mcp_client.py"></div>
        <div class="mcp-card-actions" style="justify-content:flex-end;gap:6px">
          <button class="mcp-install-btn" id="mcpGimp_enableBtn" style="padding:4px 10px;font-size:11px">Enable with this client</button>
        </div>
      </details>
    </div>
  </div>

  <!-- ── Custom MCP servers ───────────────────────────────────────────────── -->
  <div id="mcpAcc_custom" class="mcp-acc">
    <div class="mcp-acc-head" data-acc="custom">
      <span style="width:16px;flex-shrink:0"></span>
      <span class="mcp-acc-title">Custom MCP servers <span class="mcp-acc-sub" id="mcpCustomCount"></span></span>
      <span class="mcp-acc-chev">&#9656;</span>
    </div>
    <div class="mcp-acc-body">
      <div id="mcpCustomCards"></div>
      <button class="mcp-add-btn" id="addCustomMcpBtn">+ Add Server</button>
    </div>
  </div>

  <button class="mcp-save-all" id="saveMcpAllBtn">Save All &amp; Sync</button>
</div>
`;

export const mcpConfigScript = `
// Names of MCP servers managed by their own preset accordions — these are
// hidden from the Custom JSON tab so the user has exactly one place to edit each.
const RESERVED_MCP = { jira: 'mcp-atlassian', email: 'zerolib-email', blender: 'blender', gimp: 'gimp' };
function _isReservedMcp(name){
  return name === RESERVED_MCP.jira || name === RESERVED_MCP.email
    || name === RESERVED_MCP.blender || name === RESERVED_MCP.gimp;
}

function _setVal(id, v){ const el = document.getElementById(id); if(el) el.value = v; }
function _setCheck(id, v){ const el = document.getElementById(id); if(el) el.checked = !!v; }
function _getVal(id){ const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
function _getCheck(id){ const el = document.getElementById(id); return !!(el && el.checked); }
function _parseBool(s, dflt){
  if(s === undefined || s === null || s === '') return dflt;
  if(typeof s === 'boolean') return s;
  const t = String(s).toLowerCase();
  if(t === 'true' || t === '1' || t === 'yes') return true;
  if(t === 'false' || t === '0' || t === 'no') return false;
  return dflt;
}

function setMcpStatus(kind, msg){
  const el = document.getElementById('mcpStatus');
  if(!el) return;
  el.textContent = msg || '';
  el.style.color = kind==='error'
    ? 'var(--vscode-testing-iconFailed,#c72e2e)'
    : kind==='ok'
      ? 'var(--vscode-testing-iconPassed,#388a34)'
      : 'var(--vscode-descriptionForeground)';
}

function _setAccDisabled(id, disabled){
  const acc = document.getElementById(id);
  if(!acc) return;
  if(disabled) acc.classList.add('disabled');
  else acc.classList.remove('disabled');
}

function _toggleAcc(name){
  const acc = document.getElementById('mcpAcc_'+name);
  if(!acc) return;
  acc.classList.toggle('open');
}

function populateMcp(s, defaults){
  const disabled = (state.disabledBuiltinMcp || []);
  const installState = (state.mcpInstall || {});

  // Built-in MCP server list with per-server checkboxes + install badge.
  const dl = document.getElementById('mcpDefaultsList');
  if(dl){
    if(!defaults || !defaults.length){
      dl.innerHTML = '<em style="opacity:.7">none</em>';
    } else {
      dl.innerHTML = defaults.map(function(d){
        const argsStr = (d.args||[]).join(' ');
        const isOn = disabled.indexOf(d.name) === -1;
        const inst = installState[d.name] || { status: 'unknown', canInstall: false };
        const badgeCls = inst.status === 'installed' ? 'ok' : (inst.status === 'unknown' ? 'unk' : 'miss');
        const badgeTxt = inst.status === 'installed' ? '✓'
          : inst.status === 'missing-runner' ? 'no '+esc(inst.runner||'?')
          : inst.status === 'missing-package' ? 'not installed'
          : '?';
        const installBtn = (inst.status !== 'installed' && inst.canInstall)
          ? '<button class="mcp-install-btn" data-install="'+esc(d.name)+'">Install</button>' : '';
        return '<div class="mcp-builtin'+(isOn?'':' disabled')+'">'
          + '<input type="checkbox" class="mcp-builtin-toggle" data-name="'+esc(d.name)+'"'+(isOn?' checked':'')+'>'
          + '<span class="mcp-builtin-name">'+esc(d.name)+'</span>'
          + '<span class="mcp-builtin-cmd">'+esc(d.command + (argsStr?' '+argsStr:''))+'</span>'
          + '<span class="mcp-badge '+badgeCls+'" title="'+esc(inst.status)+(inst.pkg?' · '+esc(inst.pkg):'')+'">'+badgeTxt+'</span>'
          + installBtn
          + '</div>';
      }).join('');
      dl.querySelectorAll('.mcp-builtin-toggle').forEach(function(cb){
        cb.addEventListener('change', function(){
          vscode.postMessage({command:'toggleBuiltinMcp', name: cb.getAttribute('data-name'), enabled: cb.checked});
        });
      });
      dl.querySelectorAll('[data-install]').forEach(function(b){
        b.addEventListener('click', function(e){
          e.stopPropagation();
          vscode.postMessage({command:'installMcpServer', name: b.getAttribute('data-install')});
        });
      });
    }
  }

  // Render install badge + button on a preset accordion header.
  function _renderHeaderInstall(badgeId, btnId, mcpName){
    const badge = document.getElementById(badgeId);
    const btn   = document.getElementById(btnId);
    const inst  = installState[mcpName];
    if(!inst || inst.status === 'unknown'){
      if(badge) badge.style.display = 'none';
      if(btn)   btn.style.display   = 'none';
      return;
    }
    if(badge){
      badge.style.display = 'inline-flex';
      badge.className = 'mcp-badge ' + (inst.status === 'installed' ? 'ok' : 'miss');
      badge.textContent = inst.status === 'installed' ? '✓ installed'
        : inst.status === 'missing-runner' ? 'no ' + (inst.runner || '?')
        : 'not installed';
      badge.title = inst.status + (inst.pkg ? ' · ' + inst.pkg : '');
    }
    if(btn){
      btn.style.display = (inst.status !== 'installed' && inst.canInstall) ? 'inline-block' : 'none';
      btn.onclick = function(e){
        e.stopPropagation();
        vscode.postMessage({command:'installMcpServer', name: mcpName});
      };
    }
  }
  _renderHeaderInstall('mcpJira_badge',  'mcpJira_install',  RESERVED_MCP.jira);
  _renderHeaderInstall('mcpEmail_badge', 'mcpEmail_install', RESERVED_MCP.email);

  const userMcp = (s && s.mcpServers) || {};

  // Jira form — pull env from mcp-atlassian if present.
  const jira = userMcp[RESERVED_MCP.jira];
  const jenv = (jira && jira.env) || {};
  // Entry present + not explicitly disabled = enabled. Credentials are preserved
  // in .mcp.json even when disabled (enabled:false), so the form stays populated.
  const jiraOn = !!jira && jira.enabled !== false;
  _setCheck('mcpJira_enabled', jiraOn);
  _setAccDisabled('mcpAcc_jira', !jiraOn);
  _setVal('mcpJira_url',       jenv.JIRA_URL || '');
  _setVal('mcpJira_user',      jenv.JIRA_USERNAME || '');
  _setVal('mcpJira_token',     jenv.JIRA_API_TOKEN || '');
  _setVal('mcpJira_confUrl',   jenv.CONFLUENCE_URL || '');
  _setVal('mcpJira_confUser',  jenv.CONFLUENCE_USERNAME || '');
  _setVal('mcpJira_confToken', jenv.CONFLUENCE_API_TOKEN || '');

  // Email form — pull env from zerolib-email if present.
  const mail = userMcp[RESERVED_MCP.email];
  const menv = (mail && mail.env) || {};
  // Entry present + not explicitly disabled = enabled. Credentials preserved even when disabled.
  const mailOn = !!mail && mail.enabled !== false;
  _setCheck('mcpEmail_enabled', mailOn);
  _setAccDisabled('mcpAcc_email', !mailOn);
  _setVal('mcpEmail_account',     menv.MCP_EMAIL_SERVER_ACCOUNT_NAME || (mail ? '' : 'default'));
  _setVal('mcpEmail_fullName',    menv.MCP_EMAIL_SERVER_FULL_NAME || '');
  _setVal('mcpEmail_address',     menv.MCP_EMAIL_SERVER_EMAIL_ADDRESS || '');
  _setVal('mcpEmail_userName',    menv.MCP_EMAIL_SERVER_USER_NAME || '');
  _setVal('mcpEmail_password',    menv.MCP_EMAIL_SERVER_PASSWORD || '');
  _setVal('mcpEmail_imapHost',    menv.MCP_EMAIL_SERVER_IMAP_HOST || '');
  _setVal('mcpEmail_imapPort',    menv.MCP_EMAIL_SERVER_IMAP_PORT || '993');
  _setCheck('mcpEmail_imapSsl',       _parseBool(menv.MCP_EMAIL_SERVER_IMAP_SSL, true));
  _setCheck('mcpEmail_imapVerifySsl', _parseBool(menv.MCP_EMAIL_SERVER_IMAP_VERIFY_SSL, true));
  _setVal('mcpEmail_smtpHost',    menv.MCP_EMAIL_SERVER_SMTP_HOST || '');
  _setVal('mcpEmail_smtpPort',    menv.MCP_EMAIL_SERVER_SMTP_PORT || '465');
  _setCheck('mcpEmail_smtpSsl',       _parseBool(menv.MCP_EMAIL_SERVER_SMTP_SSL, true));
  _setCheck('mcpEmail_smtpStartTls',  _parseBool(menv.MCP_EMAIL_SERVER_SMTP_START_SSL, false));
  _setCheck('mcpEmail_smtpVerifySsl', _parseBool(menv.MCP_EMAIL_SERVER_SMTP_VERIFY_SSL, true));
  _setCheck('mcpEmail_attachments',   _parseBool(menv.MCP_EMAIL_SERVER_ENABLE_ATTACHMENT_DOWNLOAD, false));
  _setCheck('mcpEmail_saveSent',      _parseBool(menv.MCP_EMAIL_SERVER_SAVE_TO_SENT, true));
  _setVal('mcpEmail_sentFolder',  menv.MCP_EMAIL_SERVER_SENT_FOLDER_NAME || '');
  _setCheck('mcpEmail_receiveTasks', _parseBool(menv.AUTODEV_EMAIL_RECEIVE_TASKS, false));
  _setVal('mcpEmail_allowedSenders', menv.AUTODEV_EMAIL_ALLOWED_SENDERS || '');

  // Custom cards — show only entries NOT managed by preset accordions.
  const filtered = {};
  for(const name of Object.keys(userMcp)){
    if(_isReservedMcp(name)) continue;
    filtered[name] = userMcp[name];
  }
  _renderCustomCards(filtered);

  setMcpStatus('', '');
  window.__mcpFormReady = true;

  // Detected creative apps → enable MCP. Ask the extension to run the CLI's
  // buildDetect and post back a { apps:[...] } payload we render into the two
  // creative-app accordions above (see renderCreativeApps).
  vscode.postMessage({command:'detectCreativeApps'});
}

function _parseMcpInput(raw){
  const txt = (raw||'').trim();
  if(!txt) return {};
  let parsed;
  try { parsed = JSON.parse(txt); }
  catch(e){ throw new Error('Invalid JSON in custom block: ' + (e && e.message ? e.message : e)); }
  const obj = (parsed && typeof parsed === 'object' && parsed.mcpServers && typeof parsed.mcpServers === 'object')
    ? parsed.mcpServers
    : parsed;
  if(!obj || typeof obj !== 'object' || Array.isArray(obj)){
    throw new Error('Custom JSON: expected an object of { name: { command, args?, env? } } entries.');
  }
  const out = {};
  for(const name of Object.keys(obj)){
    const v = obj[name];
    if(!v || typeof v !== 'object'){ throw new Error('Server "'+name+'": entry must be an object.'); }
    if(typeof v.command !== 'string' || !v.command){ throw new Error('Server "'+name+'": missing string "command".'); }
    if(v.args !== undefined && !Array.isArray(v.args)){ throw new Error('Server "'+name+'": "args" must be an array.'); }
    if(v.env !== undefined && (typeof v.env !== 'object' || Array.isArray(v.env))){ throw new Error('Server "'+name+'": "env" must be an object.'); }
    out[name] = { command: v.command, args: Array.isArray(v.args) ? v.args.map(String) : [] };
    if(v.env){ out[name].env = v.env; }
    if(v.enabled === false){ out[name].enabled = false; }
  }
  return out;
}

// Build the Jira entry from form fields. Returns null only when the card is
// empty AND enabled — nothing to save. When the card is empty but the user
// unchecked the enable box, we persist a stub { enabled:false } so the
// unchecked state survives across reloads (configManager skips enabled:false
// entries when syncing, so no harm done).
function _gatherJira(){
  const enabled = _getCheck('mcpJira_enabled');
  const savedEntry = (state && state.settings && state.settings.mcpServers && state.settings.mcpServers[RESERVED_MCP.jira]) || null;
  const savedEnv = (savedEntry && savedEntry.env) || {};
  const url     = _getVal('mcpJira_url')   || savedEnv.JIRA_URL || '';
  const user    = _getVal('mcpJira_user')  || savedEnv.JIRA_USERNAME || '';
  const token   = _getVal('mcpJira_token') || savedEnv.JIRA_API_TOKEN || '';
  if(!url && !user && !token){
    if(!enabled) return { command: 'uvx', args: ['mcp-atlassian'], env: {}, enabled: false };
    throw new Error('Jira: enabled but no fields filled in — fill URL, username and API token, or uncheck Enable.');
  }
  if(!url || !user || !token){
    throw new Error('Jira: URL, username and API token are all required (or clear all three to remove).');
  }
  const env = { JIRA_URL: url, JIRA_USERNAME: user, JIRA_API_TOKEN: token };
  const cu = _getVal('mcpJira_confUrl')   || savedEnv.CONFLUENCE_URL || '';        if(cu) env.CONFLUENCE_URL = cu;
  const cn = _getVal('mcpJira_confUser')  || savedEnv.CONFLUENCE_USERNAME || '';   if(cn) env.CONFLUENCE_USERNAME = cn;
  const ct = _getVal('mcpJira_confToken') || savedEnv.CONFLUENCE_API_TOKEN || ''; if(ct) env.CONFLUENCE_API_TOKEN = ct;
  const out = { command: 'uvx', args: ['mcp-atlassian'], env: env };
  if(!enabled) out.enabled = false;
  return out;
}

// Build the Email entry from form fields. Same semantics as _gatherJira:
// empty + unchecked → stub with enabled:false so the unchecked state persists.
//
// Defensive: if the form's required fields are empty but we already have a
// saved env in state.settings, reuse it. This stops an early auto-save from
// wiping IMAP creds when the form hasn't been populated yet (e.g. user toggled
// the checkbox on a freshly-opened tab before populateMcp ran).
function _gatherEmail(){
  const enabled  = _getCheck('mcpEmail_enabled');
  const savedEntry = (state && state.settings && state.settings.mcpServers && state.settings.mcpServers[RESERVED_MCP.email]) || null;
  const savedEnv = (savedEntry && savedEntry.env) || {};
  const email    = _getVal('mcpEmail_address')  || savedEnv.MCP_EMAIL_SERVER_EMAIL_ADDRESS || '';
  const password = _getVal('mcpEmail_password') || savedEnv.MCP_EMAIL_SERVER_PASSWORD || '';
  const imapHost = _getVal('mcpEmail_imapHost') || savedEnv.MCP_EMAIL_SERVER_IMAP_HOST || '';
  const smtpHost = _getVal('mcpEmail_smtpHost') || savedEnv.MCP_EMAIL_SERVER_SMTP_HOST || '';
  if(!email && !password && !imapHost && !smtpHost){
    if(!enabled) return { command: 'uvx', args: ['mcp-email-server@latest', 'stdio'], env: {}, enabled: false };
    throw new Error('Email: enabled but no fields filled in — fill address, password, IMAP host and SMTP host, or uncheck Enable.');
  }
  if(!email || !password || !imapHost || !smtpHost){
    throw new Error('Email: address, password, IMAP host and SMTP host are required (or clear all to remove).');
  }
  const account = _getVal('mcpEmail_account') || savedEnv.MCP_EMAIL_SERVER_ACCOUNT_NAME || 'default';
  const env = {
    MCP_EMAIL_SERVER_ACCOUNT_NAME: account,
    MCP_EMAIL_SERVER_EMAIL_ADDRESS: email,
    MCP_EMAIL_SERVER_PASSWORD: password,
    MCP_EMAIL_SERVER_IMAP_HOST: imapHost,
    MCP_EMAIL_SERVER_IMAP_PORT: _getVal('mcpEmail_imapPort') || savedEnv.MCP_EMAIL_SERVER_IMAP_PORT || '993',
    MCP_EMAIL_SERVER_IMAP_SSL: String(_getCheck('mcpEmail_imapSsl')),
    MCP_EMAIL_SERVER_IMAP_VERIFY_SSL: String(_getCheck('mcpEmail_imapVerifySsl')),
    MCP_EMAIL_SERVER_SMTP_HOST: smtpHost,
    MCP_EMAIL_SERVER_SMTP_PORT: _getVal('mcpEmail_smtpPort') || savedEnv.MCP_EMAIL_SERVER_SMTP_PORT || '465',
    MCP_EMAIL_SERVER_SMTP_SSL: String(_getCheck('mcpEmail_smtpSsl')),
    MCP_EMAIL_SERVER_SMTP_START_SSL: String(_getCheck('mcpEmail_smtpStartTls')),
    MCP_EMAIL_SERVER_SMTP_VERIFY_SSL: String(_getCheck('mcpEmail_smtpVerifySsl')),
    MCP_EMAIL_SERVER_ENABLE_ATTACHMENT_DOWNLOAD: String(_getCheck('mcpEmail_attachments')),
    MCP_EMAIL_SERVER_SAVE_TO_SENT: String(_getCheck('mcpEmail_saveSent')),
  };
  const fullName   = _getVal('mcpEmail_fullName')   || savedEnv.MCP_EMAIL_SERVER_FULL_NAME   || ''; if(fullName)   env.MCP_EMAIL_SERVER_FULL_NAME = fullName;
  const userName   = _getVal('mcpEmail_userName')   || savedEnv.MCP_EMAIL_SERVER_USER_NAME   || ''; if(userName)   env.MCP_EMAIL_SERVER_USER_NAME = userName;
  const sentFolder = _getVal('mcpEmail_sentFolder') || savedEnv.MCP_EMAIL_SERVER_SENT_FOLDER_NAME || ''; if(sentFolder) env.MCP_EMAIL_SERVER_SENT_FOLDER_NAME = sentFolder;
  env.AUTODEV_EMAIL_RECEIVE_TASKS = String(_getCheck('mcpEmail_receiveTasks'));
  const allowedSenders = _getVal('mcpEmail_allowedSenders') || savedEnv.AUTODEV_EMAIL_ALLOWED_SENDERS || '';
  if(allowedSenders) env.AUTODEV_EMAIL_ALLOWED_SENDERS = allowedSenders;
  const out = { command: 'uvx', args: ['mcp-email-server@latest', 'stdio'], env: env };
  if(!enabled) out.enabled = false;
  return out;
}

function _updateCustomCount(){
  var cards = document.querySelectorAll('#mcpCustomCards .mcp-custom-card');
  var cnt = cards.length;
  var el = document.getElementById('mcpCustomCount');
  if(el) el.textContent = cnt ? '· '+cnt+' entr'+(cnt===1?'y':'ies') : '';
}

function _renderOneCustomCard(name, entry){
  var enabled = entry.enabled !== false;
  var args = (entry.args || []).join('\\n');
  var envLines = Object.keys(entry.env || {}).map(function(k){ return k+'='+(entry.env[k]||''); }).join('\\n');
  var card = document.createElement('div');
  card.className = 'mcp-acc mcp-custom-card' + (enabled ? '' : ' disabled');
  card.innerHTML =
    '<div class="mcp-acc-head" data-acc-custom="1">'
    + '<input type="checkbox"'+(enabled?' checked':'')+'>'
    + '<span class="mcp-acc-title mcp-custom-label">'+esc(name)+'</span>'
    + '<span class="mcp-acc-chev">&#9656;</span>'
    + '</div>'
    + '<div class="mcp-acc-body">'
    + '<div class="cfg-field"><label class="cfg-label">Name</label>'
    + '<input class="cfg-input mcp-custom-name-inp" value="'+esc(name)+'"></div>'
    + '<div class="cfg-field"><label class="cfg-label">Command</label>'
    + '<input class="cfg-input mcp-custom-cmd-inp" value="'+esc(entry.command||'uvx')+'"></div>'
    + '<div class="cfg-field"><label class="cfg-label">Args <small style="opacity:.6">(one per line)</small></label>'
    + '<textarea class="mcp-textarea mcp-custom-args-inp" rows="3" style="min-height:60px">'+esc(args)+'</textarea></div>'
    + '<div class="cfg-field"><label class="cfg-label">Env <small style="opacity:.6">(KEY=VALUE, one per line)</small></label>'
    + '<textarea class="mcp-textarea mcp-custom-env-inp" rows="3" style="min-height:60px">'+esc(envLines)+'</textarea></div>'
    + '<div class="mcp-card-actions"><button class="mcp-remove-btn mcp-custom-remove-btn">Remove</button></div>'
    + '</div>';
  card.querySelector('.mcp-acc-head').addEventListener('click', function(e){
    if(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL')) return;
    card.classList.toggle('open');
  });
  card.querySelector('input[type=checkbox]').addEventListener('change', function(e){
    if(e.target.checked) card.classList.remove('disabled'); else card.classList.add('disabled');
  });
  card.querySelector('.mcp-custom-name-inp').addEventListener('input', function(e){
    card.querySelector('.mcp-custom-label').textContent = e.target.value || '(unnamed)';
  });
  card.querySelector('.mcp-custom-remove-btn').addEventListener('click', function(){
    card.remove();
    _updateCustomCount();
  });
  return card;
}

function _renderCustomCards(entries){
  var container = document.getElementById('mcpCustomCards');
  if(!container) return;
  container.innerHTML = '';
  Object.keys(entries).forEach(function(name){
    container.appendChild(_renderOneCustomCard(name, entries[name]));
  });
  _updateCustomCount();
}

function _gatherCustomCards(){
  var out = {};
  document.querySelectorAll('#mcpCustomCards .mcp-custom-card').forEach(function(card){
    var nameInp   = card.querySelector('.mcp-custom-name-inp');
    var cmdInp    = card.querySelector('.mcp-custom-cmd-inp');
    var argsInp   = card.querySelector('.mcp-custom-args-inp');
    var envInp    = card.querySelector('.mcp-custom-env-inp');
    var enabledCb = card.querySelector('input[type=checkbox]');
    var name = nameInp ? String(nameInp.value||'').trim() : '';
    var cmd  = cmdInp  ? String(cmdInp.value||'').trim()  : '';
    if(!name || !cmd) return;
    var args = argsInp
      ? argsInp.value.split('\\n').map(function(s){ return s.trim(); }).filter(function(s){ return !!s; })
      : [];
    var env = {};
    if(envInp && envInp.value.trim()){
      envInp.value.split('\\n').forEach(function(line){
        line = line.trim(); if(!line) return;
        var eq = line.indexOf('=');
        if(eq > 0){ env[line.slice(0,eq).trim()] = line.slice(eq+1); }
      });
    }
    var entry = { command: cmd, args: args };
    if(Object.keys(env).length) entry.env = env;
    if(enabledCb && !enabledCb.checked) entry.enabled = false;
    out[name] = entry;
  });
  return out;
}

// Collect every user MCP entry (Jira + Email + Custom cards) into one object.
// Throws on validation errors so the caller can surface a single status line.
function _gatherMcpEntries(){
  const out = {};
  const j = _gatherJira();   if(j) out[RESERVED_MCP.jira]  = j;
  const e = _gatherEmail();  if(e) out[RESERVED_MCP.email] = e;
  const custom = _gatherCustomCards();
  for(const name of Object.keys(custom)){
    if(_isReservedMcp(name)) continue;
    out[name] = custom[name];
  }
  // Preserve creative-app servers (Blender / GIMP) — they're managed by the
  // Creative apps section, not the custom cards, so they aren't in _gatherCustomCards.
  // saveProjectUserMcp is a full replace, so without this a "Save All & Sync"
  // would silently drop an enabled Blender/GIMP server.
  const savedMcp = (state && state.settings && state.settings.mcpServers) || {};
  [RESERVED_MCP.blender, RESERVED_MCP.gimp].forEach(function(nm){
    if(savedMcp[nm] && !out[nm]) out[nm] = savedMcp[nm];
  });
  return out;
}

// Render the result of a "Test connection" run. Payload shape:
//   { ok: bool, message: string, steps: [{name, ok, detail?}] }
// Pending = true while we're still waiting for the extension to finish.
function _showEmailTestResult(payload, pending){
  const box = document.getElementById('mcpEmail_testResult');
  if(!box) return;
  const ok    = !!(payload && payload.ok);
  const msg   = (payload && payload.message) || '';
  const steps = (payload && Array.isArray(payload.steps)) ? payload.steps : [];
  box.style.display = 'block';
  box.className = 'mcp-test-result ' + (pending ? '' : (ok ? 'ok' : 'fail'));
  let html = '<div class="row"><span class="ico '+(ok?'ok':(pending?'':'fail'))+'">'+(ok?'✓':(pending?'…':'✗'))+'</span><span><b>'+esc(msg||'')+'</b></span></div>';
  for(const st of steps){
    const sIco = st.ok ? '✓' : (pending ? '…' : '✗');
    const sCls = st.ok ? 'ok' : (pending ? '' : 'fail');
    html += '<div class="row"><span class="ico '+sCls+'">'+sIco+'</span><span>'+esc(st.name||'')+(st.detail?(' — '+esc(st.detail)):'')+'</span></div>';
  }
  box.innerHTML = html;
  if(!pending){
    const tb = document.getElementById('mcpEmail_testBtn');
    if(tb){ tb.disabled = false; tb.textContent = 'Test connection'; }
  }
}
// Expose to the top-level message dispatcher in sidebar.ts.
window.renderMcpEmailTestResult = function(msg){
  // Accept either {result:{...}} (new) or the old {imap,smtp} shape (back-compat).
  if(msg && msg.result){ _showEmailTestResult(msg.result, false); return; }
  if(msg && (msg.imap || msg.smtp)){
    const steps = [];
    if(msg.imap) steps.push({name:'IMAP', ok:!!msg.imap.ok, detail:msg.imap.message});
    if(msg.smtp) steps.push({name:'SMTP', ok:!!msg.smtp.ok, detail:msg.smtp.message});
    _showEmailTestResult({ok: steps.every(function(s){return s.ok;}), message:'Connectivity test', steps:steps}, false);
    return;
  }
  _showEmailTestResult({ok:false, message:'(empty result)', steps:[]}, false);
};

// ── Creative apps (Blender / GIMP) ───────────────────────────────────────────
// Detection results arrive from the extension (buildDetect via the CLI) as a
// { apps:[{id,name,installed,path,source,experimental,prerequisites,postSetup,
// notes,alreadyEnabled,...}] } payload. We render them into the two accordions.
var _creativeApps = [];

function _installPrereq(prereqId){
  vscode.postMessage({command:'installCreativePrereq', prereq: prereqId});
}

function _stepsHtml(title, steps){
  var items = (steps||[]).map(function(s){ return '<li>'+esc(s)+'</li>'; }).join('');
  return '<div class="mcp-steps-title">'+esc(title)+'</div><ol>'+items+'</ol>';
}

function _detectBadge(el, a){
  if(!el) return;
  el.style.display = 'inline-flex';
  if(a.installed){
    el.className = 'mcp-badge ok';
    el.textContent = 'detected';
    el.title = a.path || '';
  } else {
    el.className = 'mcp-badge miss';
    el.textContent = 'not installed';
    el.title = '';
  }
}

function _detectLineHtml(a, notInstalledMsg){
  if(a.installed){
    return 'Detected at <code>'+esc(a.path||'')+'</code>'+(a.source?' <span style="opacity:.6">('+esc(a.source)+')</span>':'');
  }
  return notInstalledMsg;
}

function _renderPrereq(a, prereqId, warnId, btnId, label){
  var pr = (a.prerequisites||[]).find(function(p){ return p.id===prereqId; });
  var warn = document.getElementById(warnId);
  var btn  = document.getElementById(btnId);
  if(pr && !pr.installed){
    if(warn){ warn.style.display='block'; warn.textContent='⚠ '+label+' not found on PATH. '+ (pr.installHint||''); }
    if(btn){ btn.style.display='inline-block'; btn.onclick=function(e){ e.stopPropagation(); _installPrereq(prereqId); }; }
  } else {
    if(warn) warn.style.display='none';
    if(btn) btn.style.display='none';
  }
}

function _renderBlender(a){
  _detectBadge(document.getElementById('mcpBlender_detect'), a);
  var line = document.getElementById('mcpBlender_detectLine');
  if(line){ line.innerHTML = _detectLineHtml(a, 'Not installed — install Blender to enable this server.'); }
  _setAccDisabled('mcpAcc_blender', !a.installed);

  var cb = document.getElementById('mcpBlender_enabled');
  if(cb){
    cb.disabled = !a.installed;
    cb.checked  = !!a.alreadyEnabled;
    cb.title = a.installed ? 'Enable the Blender MCP server' : 'Install Blender to enable';
    cb.onchange = function(){
      if(cb.checked) vscode.postMessage({command:'enableCreativeApp', app:'blender'});
      else vscode.postMessage({command:'disableCreativeApp', app:'blender'});
    };
  }
  _renderPrereq(a, 'uvx', 'mcpBlender_prereqWarn', 'mcpBlender_prereqBtn', 'uvx');

  var steps = document.getElementById('mcpBlender_steps');
  if(steps){
    if(a.alreadyEnabled){ steps.style.display='block'; steps.innerHTML=_stepsHtml('Blender is enabled. Finish these steps:', a.postSetup); }
    else { steps.style.display='none'; }
  }
}

function _renderGimp(a){
  _detectBadge(document.getElementById('mcpGimp_detect'), a);
  var line = document.getElementById('mcpGimp_detectLine');
  if(line){ line.innerHTML = _detectLineHtml(a, 'GIMP not detected — install GIMP 3.x to enable this server.'); }
  _setAccDisabled('mcpAcc_gimp', !a.installed);

  var notes = document.getElementById('mcpGimp_notes');
  if(notes){
    if(a.notes && a.notes.length){ notes.style.display='block'; notes.innerHTML = a.notes.map(function(n){ return esc(n); }).join('<br>'); }
    else { notes.style.display='none'; }
  }
  _renderPrereq(a, 'python', 'mcpGimp_prereqWarn', 'mcpGimp_prereqBtn', 'python');

  // Enable checkbox — identical behaviour to Blender's. Enabling writes the gimp
  // server via enableCreativeApp; the CLI's syncProjectMcpServers hook installs
  // the plugin + client and re-points the config at the local client.
  var cb = document.getElementById('mcpGimp_enabled');
  if(cb){
    cb.disabled = !a.installed;
    cb.checked  = !!a.alreadyEnabled;
    cb.title = a.installed ? 'Enable the GIMP MCP server' : 'Install GIMP to enable';
    cb.onchange = function(){
      if(cb.checked) vscode.postMessage({command:'enableCreativeApp', app:'gimp'});
      else vscode.postMessage({command:'disableCreativeApp', app:'gimp'});
    };
  }

  // Advanced (optional): override the auto-installed client with a custom path.
  var enBtn = document.getElementById('mcpGimp_enableBtn');
  var clientInp = document.getElementById('mcpGimp_client');
  if(enBtn){
    enBtn.onclick = function(){
      var cp = clientInp ? clientInp.value.trim() : '';
      vscode.postMessage({command:'enableCreativeApp', app:'gimp', gimpClient: cp || undefined});
    };
  }

  var steps = document.getElementById('mcpGimp_steps');
  if(steps){
    if(a.alreadyEnabled){ steps.style.display='block'; steps.innerHTML=_stepsHtml('GIMP is enabled. Finish these steps:', a.postSetup); }
    else { steps.style.display='none'; }
  }
}

window.renderCreativeApps = function(apps){
  _creativeApps = apps || [];
  _creativeApps.forEach(function(a){
    if(a.id === 'blender') _renderBlender(a);
    else if(a.id === 'gimp') _renderGimp(a);
  });
};

// After an enable, show the setup steps immediately (before the re-detect push
// lands) and expand the accordion so the user sees what to do next.
window.renderCreativeAppEnableResult = function(msg){
  if(!msg || !msg.app) return;
  if(!msg.ok){ setMcpStatus('error', 'Enable '+esc(msg.app)+' failed: '+esc(msg.error||'unknown error')); return; }
  var stepsId = msg.app==='blender' ? 'mcpBlender_steps' : 'mcpGimp_steps';
  var steps = document.getElementById(stepsId);
  if(steps){
    steps.style.display='block';
    var title = msg.app==='blender' ? 'Blender enabled. Finish these steps:' : 'GIMP enabled. Finish these steps:';
    steps.innerHTML = _stepsHtml(title, msg.postSetup||[]);
  }
  var acc = document.getElementById('mcpAcc_'+msg.app);
  if(acc) acc.classList.add('open');
};

function _bindMcpEvents(){
  // Accordion headers — toggle open/closed. Clicking the checkbox itself
  // shouldn't toggle the accordion, only the header chrome around it.
  document.querySelectorAll('.mcp-acc-head').forEach(function(h){
    h.addEventListener('click', function(e){
      if(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL')) return;
      const name = h.getAttribute('data-acc');
      if(name) _toggleAcc(name);
    });
  });

  // Per-card enable/disable checkboxes — clicking the checkbox auto-saves
  // with the current form values, so the saved entry never lags behind the
  // form (and toggling Off doesn't drop your filled-in IMAP/Jira creds).
  function _saveAllNow(){
    if(!window.__mcpFormReady){ setMcpStatus('error', 'Form not ready yet — open the MCP tab first.'); return; }
    let entries;
    try { entries = _gatherMcpEntries(); }
    catch(err){ setMcpStatus('error', String(err && err.message ? err.message : err)); return; }
    setMcpStatus('', 'Saving…');
    vscode.postMessage({command:'saveMcpBulk', entries: entries});
  }

  const jEn = document.getElementById('mcpJira_enabled');
  if(jEn){
    jEn.addEventListener('change', function(){
      _setAccDisabled('mcpAcc_jira', !jEn.checked);
      _saveAllNow();
    });
  }
  const eEn = document.getElementById('mcpEmail_enabled');
  if(eEn){
    eEn.addEventListener('change', function(){
      _setAccDisabled('mcpAcc_email', !eEn.checked);
      _saveAllNow();
    });
  }

  // Per-card Remove buttons (immediate — they delete from settings).
  const rj = document.getElementById('removeMcpJiraBtn');
  if(rj){ rj.addEventListener('click',function(){
    setMcpStatus('', 'Removing…');
    vscode.postMessage({command:'removeMcpEntry', name: RESERVED_MCP.jira});
  });}
  const re = document.getElementById('removeMcpEmailBtn');
  if(re){ re.addEventListener('click',function(){
    setMcpStatus('', 'Removing…');
    vscode.postMessage({command:'removeMcpEntry', name: RESERVED_MCP.email});
  });}

  // Email — Test connection (spawns mcp-email-server and runs MCP handshake).
  const tb = document.getElementById('mcpEmail_testBtn');
  if(tb){ tb.addEventListener('click',function(){
    let entry;
    try { entry = _gatherEmail(); }
    catch(err){
      _showEmailTestResult({ok:false, message:String(err && err.message ? err.message : err), steps:[]});
      return;
    }
    if(!entry){
      _showEmailTestResult({ok:false, message:'Fill email, password, IMAP host and SMTP host first.', steps:[]});
      return;
    }
    tb.disabled = true;
    const orig = tb.textContent;
    tb.textContent = 'Testing…';
    _showEmailTestResult({ok:false, message:'Spawning mcp-email-server (uvx may download the package on first run)…', steps:[{name:'starting', ok:true}]}, true);
    vscode.postMessage({command:'testMcpEmail', env: entry.env || {}});
    // Re-enable after 70s as a safety net (server total timeout is 60s).
    setTimeout(function(){ tb.disabled = false; tb.textContent = orig; }, 70000);
  });}

  // Global Save All & Sync — gathers Jira + Email + Custom cards in one shot.
  const sa = document.getElementById('saveMcpAllBtn');
  if(sa){ sa.addEventListener('click',function(){ _saveAllNow(); });}

  // Add custom server card.
  const ac = document.getElementById('addCustomMcpBtn');
  if(ac){ ac.addEventListener('click',function(){
    const container = document.getElementById('mcpCustomCards');
    if(!container) return;
    const card = _renderOneCustomCard('new-mcp-server', {command:'uvx', args:[], env:{}});
    card.classList.add('open');
    container.appendChild(card);
    _updateCustomCount();
    const ni = card.querySelector('.mcp-custom-name-inp');
    if(ni){ ni.focus(); ni.select(); }
  });}
}

// Wire up DOM event listeners once the DOM is ready.
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', _bindMcpEvents);
} else {
  _bindMcpEvents();
}
`;
