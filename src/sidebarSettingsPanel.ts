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
</div>
`;

export const settingsPanelScript = `
function populateSettings(s){
  ['wsUrl','discordToken','discordChannelId','discordOwners','todoPath'].forEach(function(k){
    var el=document.getElementById('cfg_'+k);
    if(el){ el.value=s[k]||''; }
  });
  var li=document.getElementById('cfg_loopInterval');
  if(li){ li.value=s.loopInterval!==undefined?s.loopInterval:30; }
  var tt=document.getElementById('cfg_taskTimeoutMinutes');
  if(tt){ tt.value=s.taskTimeoutMinutes!==undefined?s.taskTimeoutMinutes:30; }
  var ci=document.getElementById('cfg_taskCheckInMinutes');
  if(ci){ ci.value=s.taskCheckInMinutes!==undefined?s.taskCheckInMinutes:20; }
  var rot=document.getElementById('cfg_retryOnTimeout');
  if(rot){ rot.checked=!!s.retryOnTimeout; }
  var arp=document.getElementById('cfg_autoResetPendingTasks');
  if(arp){ arp.checked=s.autoResetPendingTasks!==false; }
  var ac=document.getElementById('cfg_autoCompact');
  if(ac){ ac.checked=!!s.autoCompact; }
  var aci=document.getElementById('cfg_autoCompactInterval');
  if(aci){ aci.value=s.autoCompactInterval||5; }
  var asl=document.getElementById('cfg_autoStartLoop');
  if(asl){ asl.checked=!!s.autoStartLoop; }
  var vnce=document.getElementById('cfg_vncEnabled');
  if(vnce){ vnce.checked=!!s.vncEnabled; }
  var efb=document.getElementById('cfg_enableFileBrowser');
  if(efb){ efb.checked=!!s.enableFileBrowser; }
  var gite=document.getElementById('cfg_gitEnabled');
  if(gite){ gite.checked=!!s.gitEnabled; }
  var vnch=document.getElementById('cfg_vncHost');
  if(vnch){ vnch.value=s.vncHost||''; }
  var vncprt=document.getElementById('cfg_vncPort');
  if(vncprt){ vncprt.value=s.vncPort!==undefined?s.vncPort:5900; }
  var vncpw=document.getElementById('cfg_vncPassword');
  if(vncpw){ vncpw.value=s.vncPassword||''; }
  var rdpe=document.getElementById('cfg_rdpEnabled');
  if(rdpe){ rdpe.checked=!!s.rdpEnabled; }
  var rdph=document.getElementById('cfg_rdpHost');
  if(rdph){ rdph.value=s.rdpHost||''; }
  var rdpprt=document.getElementById('cfg_rdpPort');
  if(rdpprt){ rdpprt.value=s.rdpPort!==undefined?s.rdpPort:3389; }
  var rdpu=document.getElementById('cfg_rdpUsername');
  if(rdpu){ rdpu.value=s.rdpUsername||''; }
  var rdppw=document.getElementById('cfg_rdpPassword');
  if(rdppw){ rdppw.value=s.rdpPassword||''; }
  var rdpd=document.getElementById('cfg_rdpDomain');
  if(rdpd){ rdpd.value=s.rdpDomain||''; }
  var rdpguac=document.getElementById('cfg_rdpGuacWsUrl');
  if(rdpguac){ rdpguac.value=s.rdpGuacWsUrl||''; }
  var he=document.getElementById('cfg_hooksEnabled');
  if(he){ he.checked=!!s.hooksEnabled; }
  var oce=document.getElementById('cfg_openCodeHooksEnabled');
  if(oce){ oce.checked=!!s.openCodeHooksEnabled; }
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
    input.value=currentPath;
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
  };
  vscode.postMessage({command:'saveSettings',settings:s});
  document.getElementById('tabTasks').click();
});

document.getElementById('editJsonBtn').addEventListener('click',function(){
  vscode.postMessage({command:'openSettings'});
});
`;
