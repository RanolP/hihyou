import { diffStyles, type DiffFile, type ElidedRef } from "@hihyou/ui";
import * as vscode from "vscode";
import { reportError } from "../errors.js";
import type { ReviewSource } from "../review.js";
import { expandElided } from "./expand.js";
import type { FromWebview, ToWebview } from "./protocol.js";
import { activeTheme } from "./theme.js";

/** Saves closer together than this refresh a working-tree panel once. */
const saveDebounceMs = 300;

/**
 * Opens a split-diff panel on `source` and resolves with the files it first posted (undefined when the first
 * load failed, already reported), which is what a command returns to its caller.
 */
export async function openReviewPanel(
  extensionUri: vscode.Uri,
  source: ReviewSource,
): Promise<DiffFile[] | undefined> {
  const bundle = vscode.Uri.joinPath(extensionUri, "dist");
  const panel = vscode.window.createWebviewPanel(
    "hihyou.review",
    source.title,
    vscode.ViewColumn.Active,
    { enableScripts: true, localResourceRoots: [bundle] },
  );
  panel.webview.html = page(
    panel.webview,
    panel.webview.asWebviewUri(vscode.Uri.joinPath(bundle, "webview.js")),
  );

  // The webview is rebuilt each time it is shown again, so it asks for this state on `ready`.
  let state: ToWebview = { type: "loading", title: source.title };
  const show = (next: ToWebview) => {
    state = next;
    void panel.webview.postMessage(state);
  };

  // Read once per panel and again on a theme change; posted before the state so the first draw is coloured.
  let theme = activeTheme();
  const showTheme = () =>
    theme.then((t) => panel.webview.postMessage({ type: "theme", theme: t } satisfies ToWebview));

  let generation = 0;
  const load = async (): Promise<DiffFile[] | undefined> => {
    const mine = ++generation;
    show({ type: "loading", title: source.title });
    try {
      const files = await source.load();
      if (mine === generation)
        show({
          type: "files",
          title: source.title,
          refreshable: source.refreshable,
          files,
        });
      return files;
    } catch (error) {
      reportError(`could not load ${source.title}`, error);
      if (mine === generation)
        show({
          type: "error",
          title: source.title,
          message: error instanceof Error ? error.message : String(error),
        });
      return undefined;
    }
  };

  const expand = async (path: string, elided: ElidedRef) => {
    if (state.type !== "files") return;
    const current = state;
    const index = current.files.findIndex((f) => f.path === path);
    const file = current.files[index];
    const after = file?.change?.after;
    let expanded: DiffFile | undefined;
    if (file && after) {
      try {
        const text = new TextDecoder().decode(await source.readBlob(after));
        expanded = expandElided(file, elided, text);
      } catch (error) {
        reportError(`could not expand ${path}`, error);
      }
    }
    // Posted even when nothing expanded, so the webview's busy button resets.
    if (state === current)
      show({
        ...current,
        files: expanded ? current.files.with(index, expanded) : current.files,
      });
  };

  const disposables: vscode.Disposable[] = [
    panel.webview.onDidReceiveMessage((message: FromWebview) => {
      switch (message.type) {
        case "ready":
          void showTheme().then(() => panel.webview.postMessage(state));
          return;
        case "refresh":
          if (source.refreshable) void load();
          return;
        case "expand":
          void expand(message.path, message.elided);
      }
    }),
    vscode.window.onDidChangeActiveColorTheme(() => {
      theme = activeTheme();
      void showTheme();
    }),
  ];
  if (source.refreshOnSave) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    disposables.push(
      vscode.workspace.onDidSaveTextDocument(() => {
        if (!panel.visible) return;
        clearTimeout(timer);
        timer = setTimeout(() => void load(), saveDebounceMs);
      }),
      { dispose: () => clearTimeout(timer) },
    );
  }
  panel.onDidDispose(() => {
    for (const d of disposables) d.dispose();
  });

  return load();
}

function page(webview: vscode.Webview, script: vscode.Uri): string {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
  ].join("; ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">${diffStyles}${pageStyles}</style>
</head>
<body>
<header class="bar">
<h1 id="title"></h1>
<span id="status" class="status" role="status"></span>
<button id="refresh" type="button" hidden>Refresh</button>
</header>
<main id="root"></main>
<script nonce="${nonce}" src="${script.toString()}"></script>
</body>
</html>`;
}

const pageStyles = `
body { margin: 0; padding: 0 16px 16px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
.bar { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 12px; padding: 8px 0; background: var(--vscode-editor-background); }
.bar h1 { margin: 0; font-size: 1.1em; font-weight: 600; }
.status { color: var(--vscode-descriptionForeground); }
.status.error { color: var(--vscode-errorForeground); white-space: pre-wrap; }
#refresh { margin-left: auto; padding: 4px 12px; border: none; border-radius: 2px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
#refresh:hover { background: var(--vscode-button-hoverBackground); }
#refresh:disabled { opacity: 0.5; cursor: default; }
#refresh:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
`;
