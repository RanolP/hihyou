/**
 * The renderer's stylesheet. Colours come from VS Code's theme variables inside a webview; elsewhere the
 * fallbacks follow the page's colour scheme through `light-dark()`. A file taller than
 * `--hihyou-file-max-height` scrolls inside its own box, which is also what keeps declaration headers sticky.
 */
export const diffStyles = `
.hh-diff {
  color-scheme: light dark;
  --hh-bg: var(--vscode-editor-background, light-dark(#ffffff, #1e1e1e));
  --hh-fg: var(--vscode-editor-foreground, light-dark(#1f2328, #d4d4d4));
  --hh-muted: var(--vscode-editorLineNumber-foreground, light-dark(#6e7781, #858585));
  --hh-border: var(--vscode-panel-border, light-dark(#d0d7de, #3c3c3c));
  --hh-header-bg: var(--vscode-sideBarSectionHeader-background, light-dark(#f6f8fa, #252526));
  --hh-node-bg: var(--vscode-editorStickyScroll-background, light-dark(#eef1f4, #2a2d2e));
  --hh-added-line: var(--vscode-diffEditor-insertedLineBackground, light-dark(rgb(155 185 85 / 0.2), rgb(155 185 85 / 0.2)));
  --hh-removed-line: var(--vscode-diffEditor-removedLineBackground, light-dark(rgb(255 0 0 / 0.2), rgb(255 0 0 / 0.2)));
  --hh-added-text: var(--vscode-diffEditor-insertedTextBackground, light-dark(rgb(156 204 44 / 0.4), rgb(156 204 44 / 0.3)));
  --hh-removed-text: var(--vscode-diffEditor-removedTextBackground, light-dark(rgb(255 0 0 / 0.3), rgb(255 0 0 / 0.4)));
  --hh-empty: var(--vscode-diffEditor-diagonalFill, light-dark(rgb(34 34 34 / 0.12), rgb(204 204 204 / 0.12)));
  --hh-accent: var(--vscode-focusBorder, light-dark(#0969da, #2f81f7));
  --hh-button-fg: var(--vscode-textLink-foreground, light-dark(#0969da, #4daafc));
  --hh-flash: var(--vscode-editor-findMatchHighlightBackground, light-dark(rgb(234 92 0 / 0.33), rgb(234 92 0 / 0.33)));
  --hh-added-fg: var(--vscode-gitDecoration-addedResourceForeground, light-dark(#1a7f37, #81b88b));
  --hh-removed-fg: var(--vscode-gitDecoration-deletedResourceForeground, light-dark(#cf222e, #c74e39));
  --hh-mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  --hh-mono-size: var(--vscode-editor-font-size, 12px);
  background: var(--hh-bg);
  color: var(--hh-fg);
  font-family: var(--vscode-font-family, system-ui, sans-serif);
  font-size: var(--vscode-font-size, 13px);
}
.hh-file {
  border: 1px solid var(--hh-border);
  border-radius: 4px;
  margin: 0 0 16px;
  overflow: hidden;
}
.hh-file-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  padding: 6px 10px;
  background: var(--hh-header-bg);
  border-bottom: 1px solid var(--hh-border);
}
.hh-path {
  margin: 0;
  font: inherit;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.hh-old-path { font-weight: 400; color: var(--hh-muted); }
.hh-status {
  font-size: 0.85em;
  padding: 0 6px;
  border: 1px solid currentColor;
  border-radius: 8px;
  color: var(--hh-muted);
}
.hh-status-added { color: var(--hh-added-fg); }
.hh-status-deleted { color: var(--hh-removed-fg); }
.hh-counts { font-family: var(--hh-mono); font-size: 0.9em; }
.hh-count-added { color: var(--hh-added-fg); }
.hh-count-removed { color: var(--hh-removed-fg); }
.hh-scroll {
  position: relative;
  overflow: auto;
  max-height: var(--hihyou-file-max-height, 80vh);
}
.hh-table {
  border-collapse: collapse;
  min-width: 100%;
  font-family: var(--hh-mono);
  font-size: var(--hh-mono-size);
  line-height: 1.5;
}
.hh-col-code { width: 50%; }
.hh-head th {
  text-align: left;
  font-family: var(--vscode-font-family, system-ui, sans-serif);
  font-weight: 400;
  color: var(--hh-muted);
  padding: 2px 8px;
  border-bottom: 1px solid var(--hh-border);
}
.hh-num {
  min-width: 3ch;
  padding: 0 8px;
  text-align: right;
  vertical-align: top;
  color: var(--hh-muted);
  user-select: none;
  white-space: nowrap;
}
.hh-code {
  padding: 0 12px 0 4px;
  white-space: pre;
  vertical-align: top;
  tab-size: 4;
}
.hh-line > .hh-code:nth-child(2) { border-right: 1px solid var(--hh-border); }
.hh-removed { background: var(--hh-removed-line); }
.hh-added { background: var(--hh-added-line); }
.hh-empty {
  background: repeating-linear-gradient(-45deg, transparent 0 4px, var(--hh-empty) 4px 5px);
}
.hh-changed { text-decoration: none; border-radius: 2px; }
del.hh-changed { background: var(--hh-removed-text); }
ins.hh-changed { background: var(--hh-added-text); }
.hh-node th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 2px 8px;
  text-align: left;
  font-weight: 600;
  background: var(--hh-node-bg);
  border-top: 1px solid var(--hh-border);
  border-bottom: 1px solid var(--hh-border);
}
.hh-node-label { position: sticky; left: 8px; }
.hh-top { font-weight: 400; font-style: italic; color: var(--hh-muted); }
.hh-move-cell { padding: 2px 8px 0; font-family: var(--vscode-font-family, system-ui, sans-serif); }
.hh-elided-cell, .hh-collapsed-cell {
  padding: 4px 8px;
  color: var(--hh-muted);
  font-family: var(--vscode-font-family, system-ui, sans-serif);
  background: var(--hh-header-bg);
}
.hh-button {
  font: inherit;
  color: var(--hh-button-fg);
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
}
.hh-button:disabled { color: var(--hh-muted); cursor: progress; }
.hh-button:focus-visible, .hh-line:focus-visible {
  outline: 1px solid var(--hh-accent);
  outline-offset: 1px;
}
.hh-flash > td { animation: hh-flash 1.5s ease-out; }
@keyframes hh-flash { from { box-shadow: inset 0 0 0 100vmax var(--hh-flash); } }
@media (prefers-reduced-motion: reduce) {
  .hh-flash > td { animation-timing-function: steps(1, end); }
}
.hh-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
`;
