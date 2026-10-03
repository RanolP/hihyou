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
  --hh-added-text: var(--vscode-diffEditor-insertedTextBackground, light-dark(rgb(156 204 44 / 0.4), rgb(156 204 44 / 0.3)));
  --hh-removed-text: var(--vscode-diffEditor-removedTextBackground, light-dark(rgb(255 0 0 / 0.3), rgb(255 0 0 / 0.4)));
  /* VS Code layers the text colour over the line colour; a changed node gets both, so it reads as strongly as VS Code's own diff. */
  --hh-added-line: var(--vscode-diffEditor-insertedLineBackground, light-dark(rgb(155 185 85 / 0.2), rgb(155 185 85 / 0.2)));
  --hh-removed-line: var(--vscode-diffEditor-removedLineBackground, light-dark(rgb(255 0 0 / 0.2), rgb(255 0 0 / 0.2)));
  /* Not diffEditor.move.border: VS Code defaults that to grey, and a moved block should read as yellow. */
  --hh-moved: var(--vscode-editorWarning-foreground, light-dark(#bf8803, #cca700));
  --hh-accent: var(--vscode-focusBorder, light-dark(#0969da, #2f81f7));
  --hh-button-fg: var(--vscode-textLink-foreground, light-dark(#0969da, #4daafc));
  --hh-flash: var(--vscode-editor-findMatchHighlightBackground, light-dark(rgb(234 92 0 / 0.33), rgb(234 92 0 / 0.33)));
  --hh-select: var(--vscode-editor-selectionHighlightBackground, light-dark(rgb(9 105 218 / 0.15), rgb(47 129 247 / 0.2)));
  --hh-select-primary: var(--vscode-editor-selectionBackground, light-dark(rgb(9 105 218 / 0.3), rgb(47 129 247 / 0.4)));
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
.hh-col-code { width: 100%; }
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
/* Only the changed nodes get a background; the gutter marks the line. */
.hh-num.hh-removed { box-shadow: inset 3px 0 var(--hh-removed-fg); }
.hh-num.hh-added { box-shadow: inset 3px 0 var(--hh-added-fg); }
.hh-changed { text-decoration: none; border-radius: 2px; }
del.hh-changed { background: linear-gradient(var(--hh-removed-text), var(--hh-removed-text)), var(--hh-removed-line); }
ins.hh-changed { background: linear-gradient(var(--hh-added-text), var(--hh-added-text)), var(--hh-added-line); }
/* A moved side is one box: its label cell is the top edge, gutter the left, code the right, last line the bottom. */
.hh-move-cell.hh-moved { box-shadow: inset 2px 2px var(--hh-moved), inset -2px 0 var(--hh-moved); }
.hh-num.hh-moved { box-shadow: inset 2px 0 var(--hh-moved); }
.hh-code.hh-moved { box-shadow: inset -2px 0 var(--hh-moved); }
.hh-num.hh-moved-last { box-shadow: inset 2px -2px var(--hh-moved); }
.hh-code.hh-moved-last { box-shadow: inset -2px -2px var(--hh-moved); }
/* One code column, both gutters before it; the column headings are for screen readers alone. */
.hh-head th { padding: 0; border: 0; line-height: 0; }
/* The inner gutter carries only a moved box's bottom edge. */
.hh-num.hh-moved-inner { box-shadow: none; }
.hh-num.hh-moved-inner.hh-moved-last { box-shadow: inset 0 -2px var(--hh-moved); }
.hh-sign { display: inline-block; width: 2ch; color: var(--hh-muted); user-select: none; }
.hh-removed ~ .hh-code > .hh-sign { color: var(--hh-removed-fg); }
.hh-added ~ .hh-code > .hh-sign { color: var(--hh-added-fg); }
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
.hh-whole th {
  padding: 2px 8px;
  text-align: left;
  font-weight: 400;
  font-family: var(--vscode-font-family, system-ui, sans-serif);
  border-top: 1px solid var(--hh-border);
}
.hh-whole-added th { box-shadow: inset 3px 0 var(--hh-added-fg); background: var(--hh-added-line); }
.hh-whole-deleted th { box-shadow: inset 3px 0 var(--hh-removed-fg); background: var(--hh-removed-line); }
.hh-whole-label { position: sticky; left: 8px; font-weight: 600; }
.hh-whole-added .hh-whole-label { color: var(--hh-added-fg); }
.hh-whole-deleted .hh-whole-label { color: var(--hh-removed-fg); }
.hh-whole-state { margin-left: 8px; color: var(--hh-muted); font-size: 0.9em; }
.hh-whole-viewed th { opacity: 0.6; }
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
.hh-expander-cell { padding: 0; vertical-align: middle; background: var(--hh-header-bg); }
.hh-expander {
  display: block;
  width: 100%;
  height: 20px;
  padding: 0;
  border: 0;
  color: var(--hh-muted);
  background: none;
  cursor: pointer;
}
.hh-expander svg { width: 16px; height: 16px; vertical-align: middle; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.hh-expander:hover { color: var(--hh-fg); background: var(--hh-accent); }
.hh-expander:disabled { opacity: 0.5; cursor: progress; background: none; }
.hh-expander:focus-visible { outline: 1px solid var(--hh-accent); outline-offset: -1px; }
/* A cross-file move's block expands on a click, like its label. */
.hh-pair-toggle { cursor: pointer; }
/* An expanded pair reads as an inset: tinted, with the moved colour down its left edge. */
.hh-pair-cell {
  padding: 4px 8px;
  font-family: var(--vscode-font-family, system-ui, sans-serif);
  background: var(--hh-header-bg);
  box-shadow: inset 4px 0 var(--hh-moved);
}
.hh-pair-row > td { background-color: var(--hh-header-bg); }
.hh-pair-row > td:first-child { border-left: 4px solid var(--hh-moved); }
/* Viewed code steps back; its label keeps full contrast so the check stays readable. */
.hh-viewed { opacity: 0.5; }
/* The modal review editor: the root takes keys while focused, and paints nodes through the Custom Highlight API. */
.hh-review:focus { outline: 2px solid var(--vscode-focusBorder, #0969da); outline-offset: -2px; }
.hh-diff ::highlight(hh-viewed) { color: var(--hh-muted); }
.hh-diff ::highlight(hh-selection) { background-color: var(--hh-select); }
.hh-diff ::highlight(hh-selection-primary) {
  background-color: var(--hh-select-primary);
  text-decoration: underline 2px var(--hh-accent);
}
.hh-file-viewed .hh-table { opacity: 0.5; }
.hh-viewed-toggle { text-decoration: none; color: var(--hh-muted); }
.hh-viewed-toggle[aria-pressed="true"] { color: var(--hh-added-fg); }
.hh-file-header .hh-viewed-toggle { margin-left: auto; }
/* A jump's target blinks as one box, twice, then the moved box's own outline is all that stays. */
.hh-flash-box {
  position: absolute;
  z-index: 2;
  pointer-events: none;
  box-sizing: border-box;
  border: 3px solid var(--hh-accent);
  border-radius: 2px;
  animation: hh-blink 1s steps(1, end) forwards;
}
.hh-flash-box.hh-flash-moved { border-color: var(--hh-moved); }
@keyframes hh-blink { 0%, 50% { opacity: 1; } 25%, 75%, 100% { opacity: 0; } }
@keyframes hh-fade { from { opacity: 1; } to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .hh-flash-box { background: var(--hh-flash); animation: hh-fade 1.2s ease-out forwards; }
}
/* Every key action as a button, its key as the hint; it stays in reach while a selection does. */
.hh-toolbar {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0 0 8px;
  padding: 4px;
  background: var(--hh-header-bg);
  border: 1px solid var(--hh-border);
  border-radius: 4px;
}
.hh-tool {
  font: inherit;
  font-size: 0.9em;
  color: var(--hh-fg);
  background: var(--hh-bg);
  border: 1px solid var(--hh-border);
  border-radius: 3px;
  padding: 1px 6px;
  cursor: pointer;
}
.hh-tool:hover { border-color: var(--hh-accent); }
.hh-tool:focus-visible { outline: 1px solid var(--hh-accent); outline-offset: 1px; }
.hh-toolbar kbd, .hh-keyinfo kbd {
  font-family: var(--hh-mono);
  font-size: 0.9em;
  padding: 0 3px;
  color: var(--hh-muted);
  border: 1px solid var(--hh-border);
  border-radius: 3px;
}
/* Kakoune's info box: bottom right, over the code, listing the keys that can follow. */
.hh-keyinfo {
  position: sticky;
  bottom: 8px;
  z-index: 3;
  width: fit-content;
  margin: 0 8px 0 auto;
  padding: 6px 10px;
  display: flex;
  gap: 16px;
  background: var(--hh-header-bg);
  border: 1px solid var(--hh-border);
  border-radius: 4px;
}
.hh-keyinfo-title { margin: 0 0 4px; font-size: 1em; font-weight: 600; }
.hh-keyinfo dl { display: grid; grid-template-columns: auto auto; gap: 2px 8px; margin: 0; }
.hh-keyinfo dd { margin: 0; }
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
