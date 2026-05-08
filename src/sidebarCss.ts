// ---------------------------------------------------------------------------
// Shared sidebar CSS — imported by buildHtml() in sidebar.ts
// ---------------------------------------------------------------------------

export const sidebarBaseCss = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:transparent;padding:0 8px 12px;overflow-x:hidden}
.provider-row{display:flex;align-items:center;gap:6px;margin:10px 0 4px}
.provider-label{font-size:11px;color:var(--vscode-descriptionForeground);white-space:nowrap;flex-shrink:0}
.provider-select{flex:1;padding:4px 6px;font-family:var(--vscode-font-family);font-size:12px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:3px;outline:none;cursor:pointer}
.provider-select:focus{border-color:var(--vscode-focusBorder)}
.fallback-row{display:flex;align-items:center;gap:6px;margin:0 0 8px;font-size:11px;color:var(--vscode-descriptionForeground)}
.fallback-row input[type=checkbox]{cursor:pointer;flex-shrink:0}
.fallback-row .provider-select{opacity:.6}
.fallback-row .provider-select:not(:disabled){opacity:1}
.model-row{display:flex;align-items:center;gap:6px;margin:-6px 0 10px}
.model-select{flex:1;padding:4px 6px;font-family:var(--vscode-font-family);font-size:12px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:3px;outline:none;cursor:pointer}
.model-select:focus{border-color:var(--vscode-focusBorder)}
.resume-row{display:flex;align-items:center;gap:5px;margin:-4px 0 4px;font-size:11px;color:var(--vscode-descriptionForeground)}
.resume-row input{cursor:pointer}
.new-session-btn{margin-left:auto;padding:1px 5px;border-radius:3px;cursor:pointer;border:1px solid var(--vscode-panel-border);background:transparent;color:var(--vscode-descriptionForeground);font-size:12px;line-height:1.4;opacity:.7}
.new-session-btn:hover{opacity:1;background:var(--vscode-list-hoverBackground)}
.session-id-row{margin:0 0 10px;font-size:10px;color:var(--vscode-descriptionForeground);display:flex;align-items:center;gap:4px;min-width:0}
.session-id-val{font-family:var(--vscode-editor-font-family,monospace);color:var(--vscode-foreground);opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px}
.session-id-dot{width:6px;height:6px;border-radius:50%;background:var(--vscode-testing-iconPassed,#388a34);flex-shrink:0}
.loop-bar{display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:4px;margin-bottom:10px;font-size:12px}
.loop-status{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--vscode-descriptionForeground)}
.loop-status.running{color:var(--vscode-testing-iconPassed,#388a34);font-weight:600}
.loop-btn{padding:3px 8px;border-radius:3px;cursor:pointer;border:1px solid var(--vscode-button-background);background:transparent;color:var(--vscode-button-background);font-family:var(--vscode-font-family);font-size:11px;white-space:nowrap}
.loop-btn:hover:not(:disabled){background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.loop-btn:disabled{opacity:.4;cursor:not-allowed}
.loop-btn.stop{border-color:var(--vscode-testing-iconFailed,#c72e2e);color:var(--vscode-testing-iconFailed,#c72e2e)}
.loop-btn.stop:hover{background:var(--vscode-testing-iconFailed,#c72e2e);color:#fff}
.loop-btn.retry{border-color:var(--vscode-statusBarItem-warningBackground,#b5630d);color:var(--vscode-statusBarItem-warningBackground,#b5630d)}
.loop-btn.retry:hover{background:var(--vscode-statusBarItem-warningBackground,#b5630d);color:#fff}
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
.task{cursor:pointer}.task:hover{background:var(--vscode-list-hoverBackground)}
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
.mcp-subtabs{display:flex;gap:2px;margin-bottom:8px;border:1px solid var(--vscode-panel-border);border-radius:3px;padding:2px;background:var(--vscode-editor-background)}
.mcp-subtab{flex:1;padding:5px 8px;font-size:11px;cursor:pointer;border:none;background:transparent;color:var(--vscode-descriptionForeground);border-radius:2px;font-family:var(--vscode-font-family)}
.mcp-subtab:hover{background:var(--vscode-list-hoverBackground)}
.mcp-subtab.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground);font-weight:600}
.profile-section-row{display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:3px;border-radius:4px;border:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);cursor:pointer;font-size:12px;transition:border-color .1s}
.profile-section-row:hover{border-color:var(--vscode-focusBorder);background:var(--vscode-list-hoverBackground)}
.profile-section-row.checked{border-color:var(--vscode-button-background);background:color-mix(in srgb,var(--vscode-button-background) 10%,transparent)}
.profile-section-row input[type=checkbox]{flex-shrink:0;cursor:pointer;accent-color:var(--vscode-button-background);width:14px;height:14px}
.profile-section-label{flex:1;line-height:1.3;color:var(--vscode-foreground)}
`;
