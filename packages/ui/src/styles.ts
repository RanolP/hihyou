/**
 * The renderer's stylesheet. Colours come from VS Code's theme variables inside a webview; elsewhere the
 * fallbacks follow the page's colour scheme through `light-dark()`. A file taller than
 * `--hihyou-file-max-height` scrolls inside its own box, which is also what keeps declaration headers sticky.
 */
export const diffStyles = `
.hh-diff, .hh-keys {
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
  --hh-selection: var(--vscode-editor-selectionBackground, light-dark(rgb(9 105 218 / 0.3), rgb(47 129 247 / 0.4)));
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
  overflow: clip;
}
.hh-description {
  margin: 0 0 16px;
  overflow: clip;
  background: var(--hh-bg);
  border: 1px solid var(--hh-border);
  border-radius: 4px;
}
.hh-description-title {
  margin: 0;
  padding: 6px 10px;
  color: var(--hh-muted);
  font-size: 13px;
  font-weight: 600;
  background: var(--hh-header-bg);
  border-bottom: 1px solid var(--hh-border);
}
.hh-description-body {
  margin: 8px 10px 0;
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.hh-description-body > :first-child { margin-top: 0; }
.hh-description-body > :last-child { margin-bottom: 0; }
.hh-description-body p { margin: 8px 0; }
.hh-description-body h4, .hh-description-body h5, .hh-description-body h6 {
  margin: 12px 0 6px;
  font-size: 1.1em;
  font-weight: 600;
  line-height: 1.3;
}
.hh-description-body h5 { font-size: 1.05em; }
.hh-description-body h6 { font-size: 1em; }
.hh-description-body ul, .hh-description-body ol { margin: 8px 0; padding-left: 2em; }
.hh-description-body li + li { margin-top: 2px; }
.hh-description-task { list-style: none; }
.hh-description-task > input { margin: 0 0.5em 0 -1.5em; vertical-align: -0.1em; }
.hh-description-body pre {
  margin: 8px 0;
  padding: 8px 10px;
  overflow: auto;
  border-radius: 4px;
  background: var(--hh-header-bg);
}
.hh-description-body code { font-family: var(--hh-mono); }
.hh-description-body :not(pre) > code {
  padding: 0.15em 0.35em;
  border-radius: 3px;
  background: var(--hh-header-bg);
}
.hh-description-body blockquote {
  margin: 8px 0;
  padding-left: 10px;
  color: var(--hh-muted);
  border-left: 3px solid var(--hh-border);
}
.hh-description-body hr { height: 1px; margin: 12px 0; border: 0; background: var(--hh-border); }
.hh-description-body a { color: var(--hh-button-fg); }
.hh-description-collapsed {
  max-height: 9em;
  overflow: hidden;
}
.hh-description-toggle { margin: 6px 10px 8px; }
/* The file the counter and the tree name, for a page short enough that stepping to it scrolls nothing. */
.hh-file[aria-current="true"] { border-color: var(--hh-accent); }
.hh-test-group {
  margin: 0 0 16px;
  padding: 6px 10px;
  color: var(--hh-muted);
}
.hh-file-header {
  position: sticky;
  top: var(--hh-file-sticky-top, 0);
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  padding: 6px 10px;
  background: var(--hh-header-bg);
  border-radius: 3px 3px 0 0;
  border-bottom: 1px solid var(--hh-border);
}
.hh-path {
  margin: 0;
  font: inherit;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.hh-copy-path { color: var(--hh-muted); font-size: 0.85em; text-decoration: none; }
.hh-copy-path:hover { color: var(--hh-fg); }
.hh-path-directory { font-weight: 400; color: var(--hh-muted); }
.hh-old-path { font-weight: 400; }
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
  tab-size: var(--hh-tab-size, 4);
}
/*
 * Changed lines carry the side colour; changed nodes layer the stronger text colour over it. A merged line holds
 * both sides, so only its gutter takes the colour and its changed nodes alone show which side they came from.
 */
.hh-num.hh-removed,
tr:not(.hh-merged) > .hh-num.hh-removed ~ td { background: var(--hh-removed-line); }
.hh-num.hh-added,
tr:not(.hh-merged) > .hh-num.hh-added ~ td { background: var(--hh-added-line); }
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
/* An inline block inherits the cell's hanging text-indent, which would pull the sign into the gutter. */
.hh-sign { display: inline-block; width: 2ch; text-indent: 0; color: var(--hh-muted); user-select: none; }
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
  /* Drawn inside the cell: a collapsed border stays with the table, and the code scrolling under shows through it. */
  box-shadow: inset 0 1px var(--hh-border), inset 0 -1px var(--hh-border);
}
/* A boundary gap covers the outgoing scope label until the next one arrives. */
.hh-elided-handover td {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--hh-header-bg);
}
/* In the browser extension the page scrolls, so neither file wrapper may become a sticky scroll ancestor.
   The sticky tops round down: on a half pixel the row would blend with the code scrolling under it, and tucking
   half a pixel under the layer above hides nothing. */
:host .hh-diff {
  --hh-file-sticky-top: round(
    down,
    var(--hh-page-sticky-top, 0px) +
    var(--hh-app-bar-height, 0px) +
    var(--hh-review-bar-height, 0px),
    1px
  );
}
:host .hh-scroll {
  max-height: none;
  overflow: visible;
}
:host .hh-file { overflow: visible; scroll-margin-top: var(--hh-file-sticky-top); }
/* Fix the browser table to its grid track; the shared auto layout stays horizontally scrollable in VS Code. */
:host .hh-table { width: 100%; min-width: 0; table-layout: fixed; }
:host .hh-col-num { width: calc(5ch + 16px); }
:host .hh-col-code { width: auto; }
/* With no scroll box to pan, every token may wrap inside the fixed code column. */
:host .hh-code {
  padding-left: calc(10px + 2ch + var(--hh-indent, 0) * 1ch);
  text-indent: calc((-2 - var(--hh-indent, 0)) * 1ch);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
:host .hh-node th {
  top: round(down, var(--hh-file-sticky-top) + var(--hh-file-header-height, 0px), 1px);
}
:host .hh-elided-handover td {
  top: round(down, var(--hh-file-sticky-top) + var(--hh-file-header-height, 0px), 1px);
}
.hh-node-label { position: sticky; left: 8px; }
.hh-whole th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 2px 8px;
  text-align: left;
  font-weight: 400;
  font-family: var(--vscode-font-family, system-ui, sans-serif);
  border-top: 1px solid var(--hh-border);
}
.hh-whole-added th {
  box-shadow: inset 3px 0 var(--hh-added-fg);
  background: linear-gradient(var(--hh-added-line), var(--hh-added-line)), var(--hh-bg);
}
.hh-whole-deleted th {
  box-shadow: inset 3px 0 var(--hh-removed-fg);
  background: linear-gradient(var(--hh-removed-line), var(--hh-removed-line)), var(--hh-bg);
}
:host .hh-whole th {
  top: round(down, var(--hh-file-sticky-top) + var(--hh-file-header-height, 0px), 1px);
}
/* A heading first, so it reads like the scope rows rather than a link; the underline returns on hover. */
.hh-whole-label { position: sticky; left: 8px; font-weight: 600; }
.hh-button.hh-whole-label { text-decoration: none; }
.hh-button.hh-whole-label:hover { text-decoration: underline; }
.hh-whole-added .hh-whole-label { color: var(--hh-added-fg); }
.hh-whole-deleted .hh-whole-label { color: var(--hh-removed-fg); }
.hh-whole-state { margin-left: 8px; color: var(--hh-muted); font-size: 0.9em; }
.hh-whole-viewed .hh-whole-label, .hh-whole-viewed .hh-whole-state { opacity: 0.6; }
.hh-top { font-weight: 400; font-style: italic; color: var(--hh-muted); }
.hh-move-cell { padding: 2px 8px 0; font-family: var(--vscode-font-family, system-ui, sans-serif); }
.hh-elided-cell {
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
/* A handover gap stays pinned under the next scope row, so it is no taller than that row: a taller one would
   peek out beneath it. Its two buttons sit side by side. */
.hh-elided-handover .hh-elided-cell { padding-block: 2px; }
.hh-elided-handover .hh-expander:not(:only-child) { display: inline-block; width: 50%; vertical-align: top; }
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
/*
 * A read node cuts its own range out of the line's added/removed colour and word emphasis, so on a coloured
 * block it reads as faded context at a glance; the line-number grey alone vanished once whole lines took the
 * side colour. Per node, not per line: the rest of the line may still be unread.
 */
.hh-diff ::highlight(hh-viewed) {
  color: color-mix(in srgb, var(--hh-fg) 40%, var(--hh-bg));
  background-color: var(--hh-bg);
}
.hh-diff ::highlight(hh-selection) {
  background-color: var(--hh-selection);
  text-decoration: underline 2px var(--hh-accent);
}
/* A Code-Review score: plus solid, minus wavy, and the badge spells the sign, so colour is never the only cue. */
.hh-diff ::highlight(hh-score-plus) { text-decoration: underline solid 1px var(--hh-added-fg); }
.hh-diff ::highlight(hh-score-minus) { text-decoration: underline wavy 1px var(--hh-removed-fg); }
.hh-score-badge {
  position: absolute;
  z-index: 1;
  pointer-events: none;
  padding: 0 3px;
  font-family: var(--hh-mono);
  font-size: 0.85em;
  background: var(--hh-bg);
  border: 1px solid currentColor;
  border-radius: 3px;
}
.hh-score-plus { color: var(--hh-added-fg); }
.hh-score-minus { color: var(--hh-removed-fg); }
/* A comment's anchored text is boxed in the accent colour; the comment itself sits under the anchor's last line. */
.hh-diff ::highlight(hh-comment) { background-color: var(--hh-select); text-decoration: underline dotted 2px var(--hh-accent); }
.hh-comment-row > td, .hh-comment-file { padding: 4px 8px; background: var(--hh-header-bg); border-left: 3px solid var(--hh-accent); }
.hh-comment-author { font-weight: 600; }
.hh-comment-quote { font-family: var(--hh-mono); color: var(--hh-muted); }
.hh-comment-body { margin: 2px 0 0; white-space: pre-wrap; }
.hh-comment-html { white-space: normal; }
.hh-comment-html p { margin: 0 0 8px; }
.hh-comment-html p:last-child { margin-bottom: 0; }
.hh-comment-html pre, .hh-comment-html code { font-family: var(--hh-mono); background: var(--hh-bg); }
.hh-comment-html code { padding: 1px 3px; border-radius: 3px; }
.hh-comment-html pre { overflow-x: auto; padding: 8px; }
.hh-comment-html pre code { padding: 0; background: transparent; }
.hh-comment-html img { max-width: 100%; }
.hh-comment-html hr { height: 1px; margin: 12px 0; border: 0; background: var(--hh-border); }
.hh-comment-html details > summary { cursor: pointer; }
.hh-comment-html blockquote { margin: 8px 0; padding-left: 8px; color: var(--hh-muted); border-left: 3px solid var(--hh-border); }
.hh-comment-html ul, .hh-comment-html ol { padding-left: 2em; }
.hh-comment-html table { border-collapse: collapse; }
.hh-comment-html th, .hh-comment-html td { padding: 3px 6px; border: 1px solid var(--hh-border); }
.hh-comment-clip { position: relative; }
.hh-comment-clip.hh-comment-collapsed { max-height: 240px; overflow: hidden; }
.hh-comment-clip.hh-comment-collapsed::after { content: ""; position: absolute; right: 0; bottom: 0; left: 0; height: 48px; pointer-events: none; background: linear-gradient(transparent, var(--hh-header-bg)); }
.hh-comment-toggle { margin-top: 4px; }
.hh-review-thread > td { padding: 8px 16px; font-family: var(--vscode-font-family, system-ui, sans-serif); line-height: 1.5; white-space: normal; border-block: 1px solid var(--hh-border); }
.hh-review-comment { padding: 8px 12px; background: var(--hh-header-bg); border: 1px solid var(--hh-border); border-radius: 6px; }
.hh-review-comment + .hh-review-comment { margin-top: 8px; }
.hh-comment-meta { display: flex; align-items: center; gap: 6px; }
.hh-comment-avatar { width: 20px; height: 20px; border-radius: 50%; }
.hh-comment-age { color: var(--hh-muted); }
.hh-comment-draft textarea { display: block; width: 100%; box-sizing: border-box; min-height: 4em; font: inherit; }
/* A comment held in a review not yet submitted: dashed, and labelled so it never reads by style alone. */
.hh-comment-row > td.hh-comment-pending, .hh-comment-file.hh-comment-pending { border-left-style: dashed; }
/* A reply sits under the comment that began its thread, its own pending state marked the same way. */
.hh-comment-reply { margin-top: 4px; padding-left: 8px; border-left: 3px solid var(--hh-border); }
.hh-comment-reply.hh-comment-pending { border-left-style: dashed; }
.hh-comment-label { float: right; font-size: 0.85em; font-weight: 600; padding: 0 4px; border: 1px solid var(--hh-border); border-radius: 3px; color: var(--hh-muted); }
.hh-comment-error { margin: 2px 0 0; color: var(--hh-removed-fg); }
.hh-review-pending { align-self: center; color: var(--hh-muted); }
.hh-comment-row kbd { font-family: var(--hh-mono); font-size: 0.9em; color: var(--hh-muted); }
/* The approval stays in view with the toolbar, so scoring far down the diff shows what it did to the Diffset. */
/* flow-root keeps the badge's bottom margin inside the opaque bar, so code cannot show through below it. */
.hh-bar { position: sticky; top: 0; z-index: 3; display: flow-root; background: var(--hh-bg); }
.hh-approval { display: block; padding: 4px 0; margin: 0 0 4px; font-weight: 600; color: var(--hh-muted); }
.hh-approval span[title] { cursor: help; text-decoration: underline dotted; text-underline-offset: 3px; }
.hh-approval-help { margin-left: 8px; font-size: 0.9em; }
.hh-approval-explain { margin: 0 0 8px; max-width: 70ch; font-weight: 400; color: var(--hh-muted); }
.hh-approval-approved { color: var(--hh-added-fg); }
.hh-approval-blocked { color: var(--hh-removed-fg); }
.hh-viewed-toggle { text-decoration: none; color: var(--hh-muted); }
.hh-viewed-toggle[aria-pressed="true"] { color: var(--hh-added-fg); }
.hh-file-header .hh-viewed-toggle { margin-left: auto; }
.hh-file-header.hh-collapsed { cursor: pointer; }
.hh-collapse-reason { color: var(--hh-muted); }
/* The header's gap already spaces the chevron off the path, so it only needs a fixed width that does not jump. */
.hh-file-header .hh-fold { width: 1em; margin-right: -6px; font-size: 1.3em; line-height: 1; color: var(--hh-muted); text-decoration: none; }
.hh-file-header .hh-fold:hover { color: var(--hh-fg); }
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
/* The pending review's bar: its submit button, with the key as the hint, stays in reach while the review lasts. */
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
.hh-toolbar kbd, .hh-keys kbd {
  font-family: var(--hh-mono);
  font-size: 0.9em;
  padding: 0 3px;
  color: var(--hh-muted);
  border: 1px solid var(--hh-border);
  border-radius: 3px;
}
/* The key panel: every key under a heading for what the reviewer is doing, always on screen. */
.hh-keys {
  box-sizing: border-box;
  padding: 6px 4px 8px;
  font-size: 12px;
  line-height: 1.4;
  background: var(--hh-header-bg);
}
.hh-keys-head, .hh-keys-hint { padding-inline: 4px; }
.hh-keys-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.hh-keys-title { margin: 0; font-size: 12px; font-weight: 600; }
/* Scoped under .hh-keys so a host's own sidebar button styles do not reach the panel's. */
.hh-keys .hh-keys-toggle, .hh-keys .hh-key {
  font: inherit;
  color: var(--hh-fg);
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
}
.hh-keys .hh-keys-toggle { padding: 0 4px; color: var(--hh-muted); }
.hh-keys-hint { margin: 2px 0 0; color: var(--hh-muted); }
.hh-keys-hint .hh-score { font-weight: 600; }
.hh-keys-group { margin-top: 2px; padding: 1px 3px 2px; border: 1px solid transparent; border-radius: 4px; }
/* While s waits for its score key, the keys that can follow it stand out. */
.hh-keys-active { border-color: var(--hh-accent); background: var(--hh-select); }
.hh-keys-group-title { margin: 0 0 1px 4px; font-size: 11px; font-weight: 600; color: var(--hh-muted); }
.hh-keys-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5em, 1fr)); gap: 0 2px; }
.hh-keys .hh-key { display: flex; align-items: baseline; gap: 4px; min-width: 0; padding: 1px 2px; text-align: left; }
.hh-key kbd { flex: none; min-width: 1em; padding: 0 2px; text-align: center; color: var(--hh-fg); }
.hh-keys .hh-key:hover:not(:disabled), .hh-keys .hh-keys-toggle:hover { border-color: var(--hh-border); background: var(--hh-bg); }
.hh-keys .hh-key:focus-visible, .hh-keys .hh-keys-toggle:focus-visible { outline: 1px solid var(--hh-accent); outline-offset: -1px; }
.hh-keys .hh-key:disabled { cursor: default; opacity: 0.45; background: none; }
/* Without a host dock (VS Code), the panel runs along the bottom of the diff, its groups side by side. */
.hh-keys-inline { position: sticky; bottom: 0; z-index: 3; display: flex; flex-wrap: wrap; column-gap: 12px; border: 1px solid var(--hh-border); border-radius: 4px; }
.hh-keys-inline > .hh-keys-head, .hh-keys-inline > .hh-keys-hint { flex: 1 0 100%; }
.hh-keys-inline > .hh-keys-group { flex: 1 1 18em; }
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
