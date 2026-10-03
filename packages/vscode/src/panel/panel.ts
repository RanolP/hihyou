import {
  collapseElided,
  type DiffFile,
  diffStyles,
  type ReviewSource,
  revealElided,
} from "@hihyou/ui";
import * as vscode from "vscode";
import { outputChannel, reportError } from "../errors.js";
import type { FromWebview, ToWebview } from "./protocol.js";
import { activeTheme } from "./theme.js";

/** Saves closer together than this refresh a working-tree panel once. */
const saveDebounceMs = 300;

export interface PanelTarget {
  /** Names the change set: opening the same key again reveals that panel instead of opening a second one. */
  key?: string;
  /** The changed file to show; absent, the first (or, for a panel already open, the one it shows). */
  file?: string;
}

interface OpenPanel {
  panel: vscode.WebviewPanel;
  show(path: string): void;
  step(delta: 1 | -1): void;
  files(): DiffFile[] | undefined;
}

const keyed = new Map<string, OpenPanel>();
/** The review panel last focused, which the next/previous file commands act on. */
let active: OpenPanel | undefined;

const fileShown = new vscode.EventEmitter<{ key: string; path: string }>();
/** A keyed panel now shows the file at `path`, or was focused showing it; the diffsets view selects its row. */
export const onDidShowFile = fileShown.event;

/** Next (1) or previous (-1) file in the review panel last focused. */
export function stepFile(delta: 1 | -1): void {
  active?.step(delta);
}

/**
 * Opens a diff panel on `source` and resolves with the files it first posted (undefined when the first
 * load failed, already reported), which is what a command returns to its caller.
 */
export async function openReviewPanel(
  extensionUri: vscode.Uri,
  source: ReviewSource,
  target: PanelTarget = {},
): Promise<DiffFile[] | undefined> {
  const existing = target.key === undefined ? undefined : keyed.get(target.key);
  if (existing) {
    existing.panel.reveal();
    if (target.file !== undefined) existing.show(target.file);
    return existing.files();
  }
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
  // The file the webview draws; it reports its own switches with `shown`, so this is current for a replay.
  let shown = target.file;
  const shownChanged = () => {
    const name = shown?.slice(shown.lastIndexOf("/") + 1);
    panel.title = name ? `${name} — ${source.title}` : source.title;
    if (shown !== undefined && target.key !== undefined)
      fileShown.fire({ key: target.key, path: shown });
  };
  const postShown = () => {
    if (shown !== undefined)
      void panel.webview.postMessage({
        type: "show",
        path: shown,
      } satisfies ToWebview);
  };
  const showFile = (path: string) => {
    shown = path;
    shownChanged();
    postShown();
  };

  // Read once per panel and again on a theme change; posted before the state so the first draw is coloured.
  let theme = activeTheme();
  const showTheme = () =>
    theme.then((t) =>
      panel.webview.postMessage({
        type: "theme",
        theme: t,
      } satisfies ToWebview),
    );

  // The webview proxies every call here; the store stays in the host, with the token.
  const comments = source.comments?.();
  const postComments = () =>
    comments &&
    panel.webview.postMessage({
      type: "comments",
      notes: [...comments.all()],
      reviewing: comments.reviewing(),
    } satisfies ToWebview);
  const answer = (id: number, call: () => Promise<void>) =>
    call().then(
      () =>
        panel.webview.postMessage({
          type: "commented",
          id,
        } satisfies ToWebview),
      (error: unknown) => {
        reportError("could not save the comment", error);
        void panel.webview.postMessage({
          type: "commented",
          id,
          error: error instanceof Error ? error.message : String(error),
        } satisfies ToWebview);
      },
    );

  let generation = 0;
  const load = async (): Promise<DiffFile[] | undefined> => {
    const mine = ++generation;
    show({ type: "loading", title: source.title });
    try {
      const started = performance.now();
      const files = await source.load();
      outputChannel().appendLine(
        `[${new Date().toISOString()}] loaded ${source.title}: ${files.length} files in ${Math.round(performance.now() - started)} ms`,
      );
      if (mine === generation) {
        show({
          type: "files",
          title: source.title,
          refreshable: source.refreshable,
          files,
        });
        if (!files.some((f) => f.path === shown)) shown = files[0]?.path;
        shownChanged();
        postShown();
      }
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

  /** Replaces `path`'s file in the state with `change(file)`, which may answer later; posted even unchanged, so a busy button resets. */
  const changeFile = async (
    path: string,
    change: (file: DiffFile) => Promise<DiffFile | undefined>,
  ) => {
    if (state.type !== "files") return;
    const current = state;
    const index = current.files.findIndex((f) => f.path === path);
    const file = current.files[index];
    let next: DiffFile | undefined;
    if (file)
      try {
        next = await change(file);
      } catch (error) {
        reportError(`could not expand ${path}`, error);
      }
    if (state === current)
      show({
        ...current,
        files: next ? current.files.with(index, next) : current.files,
      });
  };

  const disposables: vscode.Disposable[] = [
    panel.webview.onDidReceiveMessage((message: FromWebview) => {
      switch (message.type) {
        case "ready":
          // Comments before the files, so the webview knows to proxy them when it first draws.
          void showTheme().then(() => {
            void postComments();
            void panel.webview.postMessage(state);
            postShown();
          });
          return;
        case "refresh":
          if (source.refreshable) void load();
          return;
        case "expand":
          void changeFile(message.path, (file) =>
            revealElided(
              file,
              message.elided,
              message.direction,
              source.expand,
            ),
          );
          return;
        case "collapse":
          void changeFile(message.path, async (file) =>
            collapseElided(file, message.elided),
          );
          return;
        case "shown":
          shown = message.path;
          shownChanged();
          return;
        case "comment":
          if (comments)
            void answer(message.id, () =>
              comments[message.how](message.anchor, message.body),
            );
          return;
        case "reply":
          if (comments)
            void answer(message.id, () =>
              comments[message.how](message.thread, message.body),
            );
          return;
        case "submitReview":
          if (comments)
            void answer(message.id, () => comments.submitReview(message.event));
      }
    }),
    panel.onDidChangeViewState(({ webviewPanel }) => {
      if (!webviewPanel.active) return;
      active = opened;
      shownChanged();
    }),
    vscode.window.onDidChangeActiveColorTheme(() => {
      theme = activeTheme();
      void showTheme();
    }),
  ];
  if (comments) {
    // GitHub keeps the pending review, so another window or github.com may have moved it while this panel was away.
    const refreshComments = () =>
      void comments
        .refresh()
        .catch((error: unknown) =>
          outputChannel().appendLine(
            `[${new Date().toISOString()}] could not refresh the comments: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
          ),
        );
    disposables.push(
      { dispose: comments.subscribe(() => void postComments()) },
      panel.onDidChangeViewState(({ webviewPanel }) => {
        if (webviewPanel.active) refreshComments();
      }),
      vscode.window.onDidChangeWindowState(({ focused }) => {
        if (focused && panel.active) refreshComments();
      }),
    );
  }
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
  const opened: OpenPanel = {
    panel,
    show: showFile,
    step: (delta) =>
      void panel.webview.postMessage({
        type: "step",
        delta,
      } satisfies ToWebview),
    files: () => (state.type === "files" ? state.files : undefined),
  };
  active = opened;
  const key = target.key;
  if (key !== undefined) {
    keyed.set(key, opened);
    disposables.push({ dispose: () => keyed.delete(key) });
  }
  panel.onDidDispose(() => {
    if (active === opened) active = undefined;
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
<button id="previous" type="button" class="nav" aria-label="Previous file" title="Previous file (Alt+Up)" disabled>↑</button>
<span id="position" class="status"></span>
<button id="next" type="button" class="nav" aria-label="Next file" title="Next file (Alt+Down)" disabled>↓</button>
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
#refresh { margin-left: auto;padding: 4px 12px; border: none; border-radius: 2px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
#refresh:hover { background: var(--vscode-button-hoverBackground); }
#refresh:disabled { opacity: 0.5; cursor: default; }
#refresh:focus-visible, .nav:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.nav { padding: 2px 8px; border: none; border-radius: 2px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); cursor: pointer; }
.nav:hover { background: var(--vscode-button-secondaryHoverBackground); }
.nav:disabled { opacity: 0.5; cursor: default; }
`;
