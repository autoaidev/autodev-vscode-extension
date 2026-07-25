// ---------------------------------------------------------------------------
// Profile panel — HTML + JS for the Profile tab
// ---------------------------------------------------------------------------

export const profilePanelHtml = `
<div id="panelProfile" style="display:none">
  <div style="font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:8px;line-height:1.5">
    Choose which protocol sections are included in program.md.
    All are enabled by default. Unchecked sections are excluded.
  </div>
  <div id="profileSectionList" style="margin-bottom:8px"></div>
  <div style="display:flex;gap:5px;margin-bottom:10px">
    <button class="cfg-save" style="flex:1;margin-top:0" id="profileSelectAll">Select All</button>
    <button class="cfg-save" style="flex:1;margin-top:0;background:transparent;color:var(--vscode-descriptionForeground);border:1px solid var(--vscode-panel-border)" id="profileClearAll">Clear All</button>
  </div>
  <div class="cfg-section" style="margin-top:0">Custom References</div>
  <div style="font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:5px;line-height:1.5">
    One path per line. Each path is appended as <code style="font-size:10px">@path</code> at the end of program.md so agents auto-load those files.
  </div>
  <textarea id="profileCustomRefs" class="cfg-input" rows="4" placeholder="CLAUDE.md&#10;docs/architecture.md&#10;.cursor/rules/coding.mdc" style="resize:vertical;font-family:var(--vscode-editor-font-family,monospace);font-size:11px"></textarea>
  <div style="display:flex;gap:5px;margin-top:8px">
    <button class="cfg-save" id="saveProfileBtn" style="flex:1;margin-top:0">Save &amp; Rebuild Profile</button>
    <button class="cfg-save" id="openProfileBtn" style="flex:0 0 auto;margin-top:0;background:transparent;color:var(--vscode-descriptionForeground);border:1px solid var(--vscode-panel-border)" title="Open program.md in editor">&#128196; Open</button>
  </div>
</div>
`;

export const profilePanelScript = `
function renderProfileSections(sections, enabled, customRefs) {
  var allEnabled = !enabled || enabled.length === 0;
  var enabledSet = new Set(enabled);
  var list = document.getElementById('profileSectionList');
  if (!list) { return; }
  list.innerHTML = sections.map(function(s) {
    var isChecked = allEnabled || enabledSet.has(s.id);
    return '<label class="profile-section-row' + (isChecked ? ' checked' : '') + '">'
      + '<input type="checkbox" data-section-id="' + esc(s.id) + '"' + (isChecked ? ' checked' : '') + '>'
      + '<span class="profile-section-label">' + esc(s.label) + '</span>'
      + '</label>';
  }).join('');
  list.querySelectorAll('.profile-section-row').forEach(function(row) {
    row.querySelector('input').addEventListener('change', function() {
      if (this.checked) { row.classList.add('checked'); } else { row.classList.remove('checked'); }
    });
  });
  var ta = document.getElementById('profileCustomRefs');
  if (ta) { ta.value = (customRefs || []).join('\\n'); }
}

document.getElementById('profileSelectAll').addEventListener('click', function() {
  document.querySelectorAll('#profileSectionList input[type=checkbox]').forEach(function(cb) {
    cb.checked = true;
    cb.closest('.profile-section-row').classList.add('checked');
  });
});

document.getElementById('profileClearAll').addEventListener('click', function() {
  document.querySelectorAll('#profileSectionList input[type=checkbox]').forEach(function(cb) {
    cb.checked = false;
    cb.closest('.profile-section-row').classList.remove('checked');
  });
});

document.getElementById('openProfileBtn').addEventListener('click', function() {
  vscode.postMessage({ command: 'openAgentProfile' });
});

document.getElementById('saveProfileBtn').addEventListener('click', function() {
  var checked = Array.from(document.querySelectorAll('#profileSectionList input[type=checkbox]:checked'))
    .map(function(cb) { return cb.getAttribute('data-section-id'); })
    .filter(Boolean);
  var ta = document.getElementById('profileCustomRefs');
  var customRefs = ta ? ta.value.split('\\n').map(function(l){ return l.trim(); }).filter(Boolean) : [];
  vscode.postMessage({ command: 'saveProfileSections', sections: checked, customRefs: customRefs });
});
`;
