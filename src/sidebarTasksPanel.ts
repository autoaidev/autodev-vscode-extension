// ---------------------------------------------------------------------------
// Tasks panel — HTML + JS for the Tasks tab
// renderLoop() is here because the loop bar lives just above the tasks list
// ---------------------------------------------------------------------------

export const tasksPanelHtml = `
<div id="panelTasks">
<div id="providerBanner" class="provider-banner" style="display:none"></div>
<form class="add-form" id="addForm">
  <input class="add-input" id="taskInput" placeholder="New task&#x2026;" autocomplete="off">
  <button class="add-btn" type="submit">Add</button>
</form>
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
  <div class="section-label" style="margin-bottom:0">Tasks</div>
  <span id="taskProgress" style="font-size:11px;color:var(--vscode-descriptionForeground)"></span>
</div>
<div id="taskList"></div>
</div>
`;

export const tasksPanelScript = `
function renderLoop(){
  var statusEl=document.getElementById('loopStatus');
  var btnEl=document.getElementById('loopBtn');
  if(state.loopState==='running' && state.loopTask){
    statusEl.className='loop-status running';
    var taskLabel='&#9654; '+esc(state.loopTask);
    var activityLabel=state.claudeActivity?'<div style="font-size:10px;font-weight:400;opacity:.75;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(state.claudeActivity)+'</div>':'';
    statusEl.innerHTML=taskLabel+activityLabel;
    btnEl.className='loop-btn stop';
    btnEl.innerHTML='&#9632; Stop';
    btnEl.disabled=false;
    btnEl.onclick=function(){vscode.postMessage({command:'stopLoop'});};
  }else if(state.loopState==='running'){
    // Loop is active but polling (no current task)
    statusEl.className='loop-status idle-polling';
    statusEl.innerHTML='&#9711; Idle &mdash; polling&hellip;';
    btnEl.className='loop-btn stop';
    btnEl.innerHTML='&#9632; Stop';
    btnEl.disabled=false;
    btnEl.onclick=function(){vscode.postMessage({command:'stopLoop'});};
  }else if(state.loopState==='paused'){
    statusEl.className='loop-status';
    var resumeStr=state.resumeAt?new Date(state.resumeAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'soon';
    statusEl.innerHTML='&#9208; Rate limited \u2014 auto-resume '+esc(resumeStr);
    btnEl.className='loop-btn retry';
    btnEl.innerHTML='&#9654; Retry Now';
    btnEl.disabled=false;
    btnEl.onclick=function(){vscode.postMessage({command:'retryLoop'});};
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
    btnEl.innerHTML='&#9654; Start agent';
    // Gate Start on Step-0 provider readiness: if we probed and the CLI is
    // missing, disable it and point at the blocker instead of a silent spawn
    // failure. installed===null (probe pending) leaves Start enabled.
    var r=state.selectedProviderReady;
    if(r && r.installed===false){
      btnEl.disabled=true;
      btnEl.title=(r.label||'Provider')+' not installed — install & sign in first (see the banner above).';
      btnEl.onclick=null;
    }else{
      btnEl.disabled=false;
      btnEl.title='';
      btnEl.onclick=function(){vscode.postMessage({command:'startLoop'});};
    }
  }
}

// Step-0 onboarding banner: shown at the top of the Tasks tab when the selected
// provider's CLI was probed and is missing. Turns the #1 silent first-run
// failure into a one-click guided path (install / sign in / docs).
function renderProviderBanner(){
  var b=document.getElementById('providerBanner');
  if(!b){return;}
  var r=state.selectedProviderReady;
  if(!(r && r.installed===false)){ b.style.display='none'; b.innerHTML=''; return; }
  b.style.display='';
  b.innerHTML=
    '<div class="pb-title">&#9888; '+esc(r.label||'Agent CLI')+' not found</div>'
    +'<div class="pb-desc">AutoDev needs an agent CLI installed and signed in before it can run tasks.</div>'
    +'<div class="pb-actions">'
    +'<button class="pb-btn pb-primary" id="pbInstallBtn">Install '+esc(r.label||'CLI')+'</button>'
    +'<button class="pb-btn" id="pbSignInBtn">Sign in</button>'
    +'<button class="pb-btn" id="pbDocsBtn">Docs</button>'
    +'</div>';
  var ib=document.getElementById('pbInstallBtn'); if(ib){ib.onclick=function(){vscode.postMessage({command:'installProvider'});};}
  var sb=document.getElementById('pbSignInBtn'); if(sb){sb.onclick=function(){vscode.postMessage({command:'signInProvider'});};}
  var db=document.getElementById('pbDocsBtn');   if(db){db.onclick=function(){vscode.postMessage({command:'openProviderDocs'});};}
}

function renderTasks(){
  var list=document.getElementById('taskList');
  var prog=document.getElementById('taskProgress');
  var total=state.tasks.length;
  var doneCount=state.tasks.filter(function(t){return t.status==='done';}).length;
  var remaining=total-doneCount;
  if(prog){prog.textContent=total?doneCount+'/'+total+' done \u2022 '+remaining+' left':'';}
  if(!state.tasks.length){
    // No workspace open → nothing the extension can do; the header controls
    // silently persist to nowhere. Point at the one real next step.
    if(state.hasWorkspace===false){
      list.innerHTML='<div class="empty">Open a folder to get started.<br>'
        +'<button class="add-btn" id="openFolderBtn" style="margin-top:10px">Open Folder</button></div>';
      var ofb=document.getElementById('openFolderBtn');
      if(ofb){ofb.onclick=function(){vscode.postMessage({command:'openFolder'});};}
      return;
    }
    // First-run checklist — contextual to real state so the next action is never
    // ambiguous: get a provider → add a task → press Start.
    var r=state.selectedProviderReady;
    var provOk=!(r && r.installed===false);
    var c1=(provOk?'&#10003;':'&#9675;');
    list.innerHTML='<div class="first-run">'
      +'<div class="fr-title">Let\\'s run your first task</div>'
      +'<div class="fr-step '+(provOk?'fr-done':'')+'">'+c1+' 1. Provider ready'+(provOk?'':' &mdash; see the banner above')+'</div>'
      +'<div class="fr-step">&#9675; 2. Add a task above &#8593; '
        +'<button class="fr-example" id="addExampleTaskBtn">Add example task</button></div>'
      +'<div class="fr-step">&#9675; 3. Press <strong>&#9654; Start agent</strong></div>'
      +'</div>';
    var ex=document.getElementById('addExampleTaskBtn');
    if(ex){ex.onclick=function(){vscode.postMessage({command:'addExampleTask'});};}
    return;
  }
  var pending=state.tasks.filter(function(t){return t.status!=='done';});
  var done=state.tasks.filter(function(t){return t.status==='done';});
  list.innerHTML=pending.concat(done).map(function(t){
    return '<div class="task '+t.status+'" data-line="'+(t.line||0)+'">'
      +'<span class="task-icon">'+statusIcon(t.status)+'</span>'
      +'<div class="task-body"><div class="task-text">'+esc(t.text)+'</div>'
      +(t.completedDate?'<div class="task-date">'+esc(t.completedDate)+'</div>':'')
      +'</div></div>';
  }).join('');
  list.querySelectorAll('.task').forEach(function(el){
    el.addEventListener('click',function(){
      var line=parseInt(el.getAttribute('data-line')||'0');
      if(line>0){vscode.postMessage({command:'openTask',line:line});}
    });
  });
}

document.getElementById('addForm').addEventListener('submit',function(e){
  e.preventDefault();
  var input=document.getElementById('taskInput');
  var text=input.value.trim();
  if(!text){return;}
  vscode.postMessage({command:'addTask',text:text});
  input.value='';
  input.focus();
});
`;
