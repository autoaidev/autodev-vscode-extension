// ---------------------------------------------------------------------------
// Settings panel — HTML + JS for the Settings tab
// Fixes: removed \"hooksScopeRow\" reference (element doesn't exist in DOM)
//        removed backslash-escaped quotes around openProfileBtn id/attrs
// ---------------------------------------------------------------------------

export const settingsPanelHtml = `
<div id="panelSettings" style="display:none">
<div id="cozempicBanner" style="display:none;padding:8px 10px;margin-bottom:10px;border-radius:4px;background:color-mix(in srgb,var(--vscode-statusBarItem-warningBackground,#b5630d) 15%,transparent);border:1px solid var(--vscode-statusBarItem-warningBackground,#b5630d);font-size:12px;line-height:1.6">
  <strong>Cozempic not detected</strong> &mdash; prunes bloated Claude Code sessions.<br>
  Install: <code style="font-size:11px">pip install cozempic</code> then run <code style="font-size:11px">cozempic init</code>
</div>
  <div class="cfg-section">Server</div>
  <div class="cfg-field"><label class="cfg-label">WebSocket URL</label><input class="cfg-input" id="cfg_wsUrl" placeholder="wss://host/ws?token=agt_xxx&amp;endpoint=my-slug"></div>
  <div class="cfg-section">Discord</div>
  <div class="cfg-field"><label class="cfg-label">Bot Token</label><input class="cfg-input" id="cfg_discordToken" type="password" placeholder="Bot token"></div>
  <div class="cfg-field"><label class="cfg-label">Channel ID</label><input class="cfg-input" id="cfg_discordChannelId" placeholder="123456789"></div>
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
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_autoStartLoop"> Auto-start task loop on VS Code launch</label></div>
  </div>
  <div class="cfg-row">
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_autoCompact"> Auto-compact context every</label></div>
    <div class="cfg-field"><input class="cfg-input" id="cfg_autoCompactInterval" type="number" min="1" max="100" style="width:60px"> <span style="font-size:11px;opacity:.7">tasks</span></div>
  </div>
  <div class="cfg-section">VNC</div>
  <div class="cfg-row">
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_vncEnabled"> Enable VNC</label></div>
  </div>
  <div class="cfg-row" id="vncFields">
    <div class="cfg-field"><label class="cfg-label">VNC Host</label><input class="cfg-input" id="cfg_vncHost" placeholder="(auto-detect from IP)"></div>
    <div class="cfg-field"><label class="cfg-label">VNC Port</label><input class="cfg-input" id="cfg_vncPort" type="number" min="1" max="65535"></div>
    <div class="cfg-field"><label class="cfg-label">VNC Password</label><input class="cfg-input" id="cfg_vncPassword" type="password" placeholder="(leave empty for no-auth)"></div>
  </div>
  <div class="cfg-section">RDP</div>
  <div class="cfg-row">
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_rdpEnabled"> Enable RDP</label></div>
  </div>
  <div class="cfg-row" id="rdpFields">
    <div class="cfg-field"><label class="cfg-label">RDP Host</label><input class="cfg-input" id="cfg_rdpHost" placeholder="hostname or IP"></div>
    <div class="cfg-field"><label class="cfg-label">RDP Port</label><input class="cfg-input" id="cfg_rdpPort" type="number" min="1" max="65535"></div>
    <div class="cfg-field"><label class="cfg-label">Username</label><input class="cfg-input" id="cfg_rdpUsername" placeholder=""></div>
    <div class="cfg-field"><label class="cfg-label">Password</label><input class="cfg-input" id="cfg_rdpPassword" type="password"></div>
    <div class="cfg-field"><label class="cfg-label">Domain</label><input class="cfg-input" id="cfg_rdpDomain" placeholder="(optional)"></div>
    <div class="cfg-field"><label class="cfg-label">Guac WS URL</label><input class="cfg-input" id="cfg_rdpGuacWsUrl" placeholder="wss://myhost.com/guac-ws (for HTTPS frontends)"></div>
  </div>
  <div class="cfg-row">
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_enableFileBrowser"> Enable File Browser (proxy access to project folder)</label></div>
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_gitEnabled"> Enable Git Panel (exposes repo to browser UI)</label></div>
  </div>
  <div class="cfg-section">Hook Events</div>
  <div class="cfg-row">
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_hooksEnabled"> Stream hook events to Pixel Office in real time <small style="opacity:.6">(.claude/settings.json in workspace)</small></label></div>
  </div>
  <div id="hooksStatusBadge" style="display:none;font-size:11px;margin-bottom:4px;padding:3px 7px;border-radius:3px;background:color-mix(in srgb,var(--vscode-testing-iconPassed,#388a34) 15%,transparent);color:var(--vscode-testing-iconPassed,#388a34);border:1px solid var(--vscode-testing-iconPassed,#388a34)">&#10003; Hooks installed &mdash; events streaming to Pixel Office</div>
  <div class="cfg-row">
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_openCodeHooksEnabled"> Stream OpenCode hook events to Pixel Office <small style="opacity:.6">(.opencode/plugins/autodev-hooks.ts)</small></label></div>
  </div>
  <div id="openCodeHooksStatusBadge" style="display:none;font-size:11px;margin-bottom:4px;padding:3px 7px;border-radius:3px;background:color-mix(in srgb,var(--vscode-testing-iconPassed,#388a34) 15%,transparent);color:var(--vscode-testing-iconPassed,#388a34);border:1px solid var(--vscode-testing-iconPassed,#388a34)">&#10003; OpenCode plugin installed &mdash; events streaming to Pixel Office</div>
  <div class="cfg-section">Paths</div>
  <div class="cfg-field"><label class="cfg-label">TODO.md Path</label><input class="cfg-input" id="cfg_todoPath" placeholder="(workspace root)"></div>
  <button class="cfg-save" id="saveSettingsBtn">Save Settings</button>
  <button class="cfg-json" id="editJsonBtn">Edit raw JSON</button>
  <div class="cfg-section" style="margin-top:10px">Copilot TUI</div>
  <div style="font-size:11px;line-height:1.6;margin-bottom:6px">
    Requires an <strong>OAuth token</strong> (<code>gho_*</code>) with the <code>copilot</code> scope — classic PATs (<code>ghp_*</code>) are rejected.
    Set it as the <code>GH_TOKEN</code> environment variable on the agent machine, or add <code>copilotGithubToken</code> to <code>.autodev/settings.json</code>.
    <button id="copilotTokenHelpBtn" style="display:inline;background:none;border:none;color:var(--vscode-textLink-foreground,#4daafc);cursor:pointer;font-size:11px;padding:0;margin-left:4px;text-decoration:underline">How to get one &#9660;</button>
  </div>
  <div id="copilotTokenHelp" style="display:none;font-size:11px;line-height:1.7;margin-bottom:8px;padding:8px;border-radius:4px;border:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background)">
    <p style="margin:0 0 6px"><strong>Step 1 &mdash; Clear any PAT from the environment</strong></p>
    <pre style="margin:0 0 8px;background:var(--vscode-textCodeBlock-background,#1e1e1e);padding:6px 8px;border-radius:3px;font-size:11px;overflow-x:auto">unset GH_TOKEN</pre>
    <p style="margin:0 0 6px"><strong>Step 2 &mdash; Run device-flow auth</strong></p>
    <pre style="margin:0 0 8px;background:var(--vscode-textCodeBlock-background,#1e1e1e);padding:6px 8px;border-radius:3px;font-size:11px;overflow-x:auto">gh auth refresh -h github.com --scopes copilot</pre>
    <p style="margin:0 0 6px"><strong>Step 3 &mdash; Copy the OAuth token</strong></p>
    <pre style="margin:0 0 8px;background:var(--vscode-textCodeBlock-background,#1e1e1e);padding:6px 8px;border-radius:3px;font-size:11px;overflow-x:auto">gh auth token -h github.com</pre>
    <p style="margin:0 0 6px"><strong>Step 4 &mdash; Provide to AutoDev</strong></p>
    <ul style="margin:0 0 8px;padding-left:16px">
      <li><code>export GH_TOKEN=gho_&#8230;</code></li>
      <li>or <code>{ &quot;copilotGithubToken&quot;: &quot;gho_&#8230;&quot; }</code> in <code>.autodev/settings.json</code></li>
    </ul>
  </div>
  <button class="cfg-json" id="rebuildCopilotNativeBtn" title="Run npm rebuild inside @github/copilot to compile pty.node for this machine (needed on Linux)">Rebuild native modules (pty.node)</button>
  <div id="rebuildCopilotNativeNote" style="font-size:10px;opacity:.6;margin-top:3px">Compiles the native pty module for the current OS/arch. Requires node-gyp build tools (python3, make, g++).</div>
</div>
`;

export const settingsPanelScript = `
// --- Dirty-field guard -----------------------------------------------------
// While the task loop runs, the sidebar periodically pushes fresh agent/settings
// state to this webview, which calls populateSettings() and would re-write every
// input from the stored values. That clobbers whatever the user is currently
// typing (e.g. a WebSocket URL) before they've hit Save. To prevent that we track
// a "dirty" flag per field (set on the first user input/change, cleared on Save)
// and never overwrite a field that is either focused or dirty.
var settingsDirty = Object.create(null);
function markSettingsFieldDirty(el){ if(el && el.id){ settingsDirty[el.id]=true; } }
function clearSettingsDirty(){ settingsDirty = Object.create(null); }
function isSettingsFieldProtected(el){
  if(!el){ return false; }
  if(el===document.activeElement){ return true; }       // user is actively editing it
  return !!(el.id && settingsDirty[el.id]);              // user has unsaved changes
}
// Guarded setters: only write to the field when it is safe to do so.
function setSettingValue(el, val){ if(el && !isSettingsFieldProtected(el)){ el.value=val; } }
function setSettingChecked(el, val){ if(el && !isSettingsFieldProtected(el)){ el.checked=val; } }
// Mark a field dirty the moment the user touches it. Uses event delegation on the
// settings panel so it also covers fields rendered later (e.g. the profile path
// input). Programmatic assignments in populateSettings do NOT fire input/change,
// so this never produces false positives.
(function wireSettingsDirtyTracking(){
  var panel=document.getElementById('panelSettings');
  if(!panel || panel.dataset.dirtyWired){ return; }
  panel.dataset.dirtyWired='1';
  function onEdit(e){
    var t=e.target;
    if(t && t.id && t.id.indexOf('cfg_')===0){ markSettingsFieldDirty(t); }
  }
  panel.addEventListener('input', onEdit);
  panel.addEventListener('change', onEdit);
})();

function populateSettings(s){
  ['wsUrl','discordToken','discordChannelId','discordOwners','todoPath'].forEach(function(k){
    setSettingValue(document.getElementById('cfg_'+k), s[k]||'');
  });
  setSettingValue(document.getElementById('cfg_loopInterval'), s.loopInterval!==undefined?s.loopInterval:30);
  setSettingValue(document.getElementById('cfg_taskTimeoutMinutes'), s.taskTimeoutMinutes!==undefined?s.taskTimeoutMinutes:30);
  setSettingValue(document.getElementById('cfg_taskCheckInMinutes'), s.taskCheckInMinutes!==undefined?s.taskCheckInMinutes:20);
  setSettingChecked(document.getElementById('cfg_retryOnTimeout'), !!s.retryOnTimeout);
  setSettingChecked(document.getElementById('cfg_autoResetPendingTasks'), s.autoResetPendingTasks!==false);
  setSettingChecked(document.getElementById('cfg_autoCompact'), !!s.autoCompact);
  setSettingValue(document.getElementById('cfg_autoCompactInterval'), s.autoCompactInterval||5);
  setSettingChecked(document.getElementById('cfg_autoStartLoop'), !!s.autoStartLoop);
  setSettingChecked(document.getElementById('cfg_vncEnabled'), !!s.vncEnabled);
  setSettingChecked(document.getElementById('cfg_enableFileBrowser'), !!s.enableFileBrowser);
  setSettingChecked(document.getElementById('cfg_gitEnabled'), !!s.gitEnabled);
  setSettingValue(document.getElementById('cfg_vncHost'), s.vncHost||'');
  setSettingValue(document.getElementById('cfg_vncPort'), s.vncPort!==undefined?s.vncPort:5900);
  setSettingValue(document.getElementById('cfg_vncPassword'), s.vncPassword||'');
  setSettingChecked(document.getElementById('cfg_rdpEnabled'), !!s.rdpEnabled);
  setSettingValue(document.getElementById('cfg_rdpHost'), s.rdpHost||'');
  setSettingValue(document.getElementById('cfg_rdpPort'), s.rdpPort!==undefined?s.rdpPort:3389);
  setSettingValue(document.getElementById('cfg_rdpUsername'), s.rdpUsername||'');
  setSettingValue(document.getElementById('cfg_rdpPassword'), s.rdpPassword||'');
  setSettingValue(document.getElementById('cfg_rdpDomain'), s.rdpDomain||'');
  setSettingValue(document.getElementById('cfg_rdpGuacWsUrl'), s.rdpGuacWsUrl||'');
  setSettingChecked(document.getElementById('cfg_hooksEnabled'), !!s.hooksEnabled);
  setSettingChecked(document.getElementById('cfg_openCodeHooksEnabled'), !!s.openCodeHooksEnabled);
  renderProfileSelect(state.profiles||[], s['profilePath']||'');
}

function renderProfileSelect(profiles, currentPath){
  var sel=document.getElementById('cfg_profileSelect');
  var input=document.getElementById('cfg_profilePath');
  if(!sel||!input){ return; }
  sel.innerHTML=profiles.map(function(p){
    var fileName=(p.filePath||'').split(/[\\\\/]/).pop()||p.filePath||'';
    var tip=[p.description||'', fileName].filter(function(x){ return !!x; }).join('\\n');
    var label=(p.title||'')+' \u00b7 '+fileName;
    return '<option value="'+esc(p.filePath)+'" title="'+esc(tip)+'">'+esc(label)+'</option>';
  }).join('')+'<option value="__custom__">Custom path\u2026</option>';
  var match=profiles.find(function(p){ return p.filePath===currentPath; });
  if(match){
    sel.value=match.filePath;
    input.style.display='none';
  } else if(currentPath){
    sel.value='__custom__';
    if(!isSettingsFieldProtected(input)){ input.value=currentPath; }
    input.style.display='';
  } else {
    sel.value=profiles[0]?profiles[0].filePath:'__custom__';
    input.style.display='none';
  }
  sel.onchange=function(){
    if(sel.value==='__custom__'){ input.style.display=''; input.focus(); }
    else{ input.style.display='none'; }
  };
  var openBtn=document.getElementById('openProfileBtn');
  if(openBtn){
    openBtn.onclick=function(){
      var path=sel.value==='__custom__'?input.value:sel.value;
      if(path&&path!=='__custom__'){ vscode.postMessage({command:'openFile',filePath:path}); }
    };
  }
}

document.getElementById('saveSettingsBtn').addEventListener('click',function(){
  var s={
    provider:state.selectedProvider,
    wsUrl:document.getElementById('cfg_wsUrl').value,
    discordToken:document.getElementById('cfg_discordToken').value,
    discordChannelId:document.getElementById('cfg_discordChannelId').value,
    discordOwners:document.getElementById('cfg_discordOwners').value,
    loopInterval:parseInt(document.getElementById('cfg_loopInterval').value)||30,
    taskTimeoutMinutes:parseInt(document.getElementById('cfg_taskTimeoutMinutes').value)||30,
    taskCheckInMinutes:parseInt(document.getElementById('cfg_taskCheckInMinutes').value)||20,
    retryOnTimeout:document.getElementById('cfg_retryOnTimeout').checked,
    autoResetPendingTasks:document.getElementById('cfg_autoResetPendingTasks').checked,
    autoStartLoop:document.getElementById('cfg_autoStartLoop').checked,
    autoCompact:document.getElementById('cfg_autoCompact').checked,
    autoCompactInterval:parseInt(document.getElementById('cfg_autoCompactInterval').value)||5,
    vncEnabled:document.getElementById('cfg_vncEnabled').checked,
    vncHost:document.getElementById('cfg_vncHost').value.trim(),
    vncPort:parseInt(document.getElementById('cfg_vncPort').value)||5900,
    vncPassword:document.getElementById('cfg_vncPassword').value,
    rdpEnabled:document.getElementById('cfg_rdpEnabled').checked,
    rdpHost:document.getElementById('cfg_rdpHost').value.trim(),
    rdpPort:parseInt(document.getElementById('cfg_rdpPort').value)||3389,
    rdpUsername:document.getElementById('cfg_rdpUsername').value,
    rdpPassword:document.getElementById('cfg_rdpPassword').value,
    rdpDomain:document.getElementById('cfg_rdpDomain').value.trim(),
    rdpGuacWsUrl:document.getElementById('cfg_rdpGuacWsUrl').value.trim(),
    enableFileBrowser:document.getElementById('cfg_enableFileBrowser').checked,
    gitEnabled:document.getElementById('cfg_gitEnabled').checked,
    hooksEnabled:document.getElementById('cfg_hooksEnabled').checked,
    hooksScope:'project',
    openCodeHooksEnabled:document.getElementById('cfg_openCodeHooksEnabled').checked,
    resumeSession:!!(state.settings&&state.settings.resumeSession),
    copilotModel:(state.settings&&state.settings.copilotModel)||'',
    opencodeModel:(state.settings&&state.settings.opencodeModel)||'',
    opencodeCacheEnabled:!!(state.settings&&state.settings.opencodeCacheEnabled),
    todoPath:document.getElementById('cfg_todoPath').value,
    copilotGithubToken:(state.settings&&state.settings.copilotGithubToken)||'',
  };
  vscode.postMessage({command:'saveSettings',settings:s});
  // The current field values are now the persisted source of truth, so drop the
  // dirty flags — subsequent state pushes may freely repopulate the form again.
  clearSettingsDirty();
  document.getElementById('tabTasks').click();
});

document.getElementById('editJsonBtn').addEventListener('click',function(){
  vscode.postMessage({command:'openSettings'});
});

var rebuildNativeBtn=document.getElementById('rebuildCopilotNativeBtn');
if(rebuildNativeBtn){
  rebuildNativeBtn.addEventListener('click',function(){
    rebuildNativeBtn.textContent='Rebuilding…';
    rebuildNativeBtn.disabled=true;
    vscode.postMessage({command:'rebuildCopilotNative'});
    setTimeout(function(){rebuildNativeBtn.textContent='Rebuild native modules (pty.node)';rebuildNativeBtn.disabled=false;},35000);
  });
}
var copilotHelpBtn=document.getElementById('copilotTokenHelpBtn');
var copilotHelp=document.getElementById('copilotTokenHelp');
if(copilotHelpBtn&&copilotHelp){
  copilotHelpBtn.addEventListener('click',function(){
    var open=copilotHelp.style.display==='block';
    copilotHelp.style.display=open?'none':'block';
    copilotHelpBtn.innerHTML=open?'How to get one &#9660;':'How to get one &#9650;';
  });
}
`;
