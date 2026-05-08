// ---------------------------------------------------------------------------
// Tasks panel — HTML + JS for the Tasks tab
// renderLoop() is here because the loop bar lives just above the tasks list
// ---------------------------------------------------------------------------

export const tasksPanelHtml = `
<div id="panelTasks">
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
  if(state.loopState==='running'){
    statusEl.className='loop-status running';
    var taskLabel=state.loopTask?'&#9654; '+esc(state.loopTask):'&#9654; Running\u2026';
    var activityLabel=state.claudeActivity?'<div style="font-size:10px;font-weight:400;opacity:.75;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(state.claudeActivity)+'</div>':'';
    statusEl.innerHTML=taskLabel+activityLabel;
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
    btnEl.innerHTML='&#9654; Start';
    btnEl.disabled=false;
    btnEl.onclick=function(){vscode.postMessage({command:'startLoop'});};
  }
}

function renderTasks(){
  var list=document.getElementById('taskList');
  var prog=document.getElementById('taskProgress');
  var total=state.tasks.length;
  var doneCount=state.tasks.filter(function(t){return t.status==='done';}).length;
  var remaining=total-doneCount;
  if(prog){prog.textContent=total?doneCount+'/'+total+' done \u2022 '+remaining+' left':'';}
  if(!state.tasks.length){
    list.innerHTML='<div class="empty">No tasks in TODO.md yet.<br>Add one above or edit <strong>TODO.md</strong> directly.</div>';
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
