import { type ChangedFileRef, createEngine, type Theme } from "@hihyou/engine";
import { type GitHubWebDiffsetId, githubWebHost } from "@hihyou/github";
import {
  collapseElided,
  type DiffFile,
  type DiffsetView,
  diffStyles,
  engineReview,
  type FileTreeNode,
  fileTree,
  githubDark,
  githubLight,
  renderDiffset,
  revealElided,
} from "@hihyou/ui";
import type { App, MountOptions, Mounted } from "./app-api.js";

/** One row of the diffsets panel: the whole pull request, or one of its commits. */
interface Row {
  key: string;
  label: string;
  description?: string;
  tooltip?: string;
  id: GitHubWebDiffsetId;
  expanded: boolean;
  /** The row's files, once it was expanded or opened. */
  changes?: readonly ChangedFileRef[];
  error?: string;
}

function mount(host: HTMLElement, { page, fetch }: MountOptions): Mounted {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
<style>${diffStyles}${appStyles}</style>
<style class="scheme"></style>
<div class="hh-app">
  <nav class="hh-sets" aria-label="Diffsets"><div class="hh-sets-status">Loading commits…</div><ul role="tree"></ul></nav>
  <section class="hh-main">
    <header class="hh-bar">
      <h2 class="hh-title"></h2>
      <button type="button" class="hh-nav previous" aria-label="Previous file" title="Previous file" disabled>↑</button>
      <span class="hh-meta position"></span>
      <button type="button" class="hh-nav next" aria-label="Next file" title="Next file" disabled>↓</button>
      <span class="hh-meta message" role="status"></span>
    </header>
    <div class="hh-root"></div>
  </section>
</div>`;
  const $ = <T extends Element>(selector: string) =>
    shadow.querySelector(selector) as T;
  const schemeStyle = $<HTMLStyleElement>("style.scheme");
  const setsStatus = $<HTMLElement>(".hh-sets-status");
  const tree = $<HTMLUListElement>(".hh-sets ul");
  const title = $<HTMLElement>(".hh-title");
  const previous = $<HTMLButtonElement>(".previous");
  const next = $<HTMLButtonElement>(".next");
  const position = $<HTMLElement>(".position");
  const status = $<HTMLElement>(".message");
  const root = $<HTMLElement>(".hh-root");

  const host_ = githubWebHost({ fetch });
  const engine = createEngine(host_);
  let rows: Row[] = [];
  let selected: Row | undefined;
  let review: ReturnType<typeof engineReview> | undefined;
  let files: DiffFile[] = [];
  let view: DiffsetView | undefined;
  let generation = 0;
  let disposed = false;

  // Theme: GitHub's own `data-color-mode`, with `auto` following the system as GitHub does.
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const scheme = () => {
    const mode = document.documentElement.dataset["colorMode"];
    return mode === "light" || mode === "dark"
      ? mode
      : dark.matches
        ? "dark"
        : "light";
  };
  let theme: Theme = githubLight;
  const applyTheme = () => {
    const s = scheme();
    theme = s === "dark" ? githubDark : githubLight;
    schemeStyle.textContent = `.hh-app, .hh-diff { color-scheme: ${s}; }`;
    view?.setTheme(theme);
  };
  const themeObserver = new MutationObserver(applyTheme);
  themeObserver.observe(document.documentElement, {
    attributeFilter: ["data-color-mode"],
  });
  dark.addEventListener("change", applyTheme);
  applyTheme();

  const index = () => files.findIndex((f) => f.path === view?.shown());
  const updateNav = () => {
    const i = index();
    previous.disabled = i <= 0;
    next.disabled = i < 0 || i >= files.length - 1;
    position.textContent = i < 0 ? "" : `${i + 1} / ${files.length}`;
    drawTree();
  };
  const step = (delta: 1 | -1) => {
    const target = files[index() + delta];
    if (!view || !target) return;
    view.show(target.path);
    updateNav();
  };
  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));

  const replaceFile = (
    path: string,
    change: (file: DiffFile) => Promise<DiffFile | undefined> | DiffFile,
  ) => {
    const at = generation;
    const file = files.find((f) => f.path === path);
    if (!file) return;
    Promise.resolve(change(file)).then(
      (updated) => {
        if (!updated || at !== generation || disposed) return;
        files = files.map((f) => (f.path === path ? updated : f));
        view?.update(files);
      },
      (error: unknown) => fail(`could not expand ${path}`, error),
    );
  };

  const fail = (what: string, error: unknown) => {
    status.textContent = `${what}: ${error instanceof Error ? error.message : String(error)}`;
    status.classList.add("error");
    console.error(`hihyou: ${what}`, error);
  };

  /** Draws `row`'s diff, then `path` if given. */
  const open = async (row: Row, path?: string) => {
    const at = ++generation;
    if (selected !== row) {
      selected = row;
      review = engineReview(engine, () => row.id);
      files = [];
      view?.dispose();
      view = undefined;
      root.textContent = "";
    }
    title.textContent =
      row.key === "all"
        ? `#${page.pull} All changes`
        : `${row.description} ${row.label}`;
    status.textContent = "Loading…";
    status.classList.remove("error");
    drawTree();
    const current = review as NonNullable<typeof review>;
    try {
      const loaded = await current.load();
      if (at !== generation || disposed) return;
      files = loaded;
      status.textContent =
        files.length === 0
          ? "No changes."
          : `${files.length} ${files.length === 1 ? "file" : "files"} changed`;
      if (view) view.update(files);
      else
        view = renderDiffset(root, files, {
          onExpand: (p, elided, direction) =>
            replaceFile(p, (file) =>
              revealElided(file, elided, direction, current.expand),
            ),
          onCollapse: (p, elided) =>
            replaceFile(p, (file) => collapseElided(file, elided)),
          onShow: () => updateNav(),
          theme,
        });
      if (path !== undefined) view.show(path);
      updateNav();
    } catch (error) {
      if (at === generation && !disposed)
        fail(`could not load ${row.label}`, error);
    }
  };

  const expand = async (row: Row) => {
    row.expanded = !row.expanded;
    drawTree();
    if (!row.expanded || row.changes) return;
    try {
      row.changes = (await engine.diffset(row.id)).changes;
      delete row.error;
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
    }
    if (!disposed) drawTree();
  };

  // The diffsets panel, as VS Code's hihyou.diffsets view draws it: one row per diffset, each opening to its
  // files as a compact-folder tree.
  const drawTree = () => {
    const shown = view?.shown();
    tree.replaceChildren(
      ...rows.map((row) => {
        const li = el("li", "hh-set");
        li.setAttribute("role", "treeitem");
        li.setAttribute("aria-expanded", String(row.expanded));
        const head = el("div", `hh-row${row === selected ? " selected" : ""}`);
        const twisty = el("button", "hh-twisty", row.expanded ? "▾" : "▸");
        twisty.setAttribute("aria-label", row.expanded ? "Collapse" : "Expand");
        twisty.addEventListener("click", () => void expand(row));
        const label = el("button", "hh-label", row.label);
        if (row.tooltip) label.title = row.tooltip;
        label.addEventListener("click", () => {
          if (!row.expanded) void expand(row);
          void open(row);
        });
        head.append(twisty, label);
        if (row.description)
          head.append(el("span", "hh-desc", row.description));
        li.append(head);
        if (row.expanded) {
          const group = el("ul");
          group.setAttribute("role", "group");
          if (row.error)
            group.append(
              el("li", "hh-note error", `Could not load: ${row.error}`),
            );
          else if (!row.changes) group.append(el("li", "hh-note", "Loading…"));
          else if (row.changes.length === 0)
            group.append(el("li", "hh-note", "No changes"));
          else
            group.append(
              ...drawNodes(
                row,
                fileTree(row.changes),
                row === selected ? shown : undefined,
              ),
            );
          li.append(group);
        }
        return li;
      }),
    );
  };
  const drawNodes = (
    row: Row,
    nodes: FileTreeNode<ChangedFileRef>[],
    shown: string | undefined,
  ): HTMLElement[] =>
    nodes.map((node) => {
      const li = el("li");
      li.setAttribute("role", "treeitem");
      if (node.kind === "folder") {
        li.append(el("div", "hh-folder", node.name));
        const group = el("ul");
        group.setAttribute("role", "group");
        group.append(...drawNodes(row, node.children, shown));
        li.append(group);
        return li;
      }
      const { file } = node;
      const letter =
        file.before === null
          ? "A"
          : file.after === null
            ? "D"
            : file.oldPath
              ? "R"
              : "M";
      const button = el(
        "button",
        `hh-file-row${file.path === shown ? " selected" : ""}`,
      );
      button.append(
        el("span", `hh-letter ${letter}`, letter),
        el("span", "", node.name),
      );
      button.title = file.oldPath
        ? `${file.oldPath} → ${file.path}`
        : file.path;
      button.addEventListener("click", () => {
        if (row === selected && view) {
          view.show(file.path);
          updateNav();
        } else void open(row, file.path);
      });
      li.append(button);
      return li;
    });

  void (async () => {
    try {
      const pull = await host_.resolvePull(page.owner, page.repo, page.pull);
      if (disposed) return;
      const { owner, repo } = page;
      rows = [
        {
          key: "all",
          label: "All changes",
          id: { owner, repo, pull: page.pull, head: pull.head },
          expanded: false,
        },
        ...pull.commits.toReversed().map((c): Row => ({
          key: c.sha,
          label: c.subject,
          description: c.sha.slice(0, 7),
          tooltip: `${c.author} · ${new Date(c.date).toLocaleString()}`,
          id: { owner, repo, commit: c.sha },
          expanded: false,
        })),
      ];
      setsStatus.remove();
      const all = rows[0] as Row;
      void expand(all);
      await open(all);
    } catch (error) {
      if (disposed) return;
      setsStatus.textContent = "Could not list the commits.";
      fail(`could not load pull request #${page.pull}`, error);
    }
  })();

  return {
    dispose() {
      disposed = true;
      themeObserver.disconnect();
      dark.removeEventListener("change", applyTheme);
      view?.dispose();
      shadow.innerHTML = "";
    },
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// GitHub's own Primer variables reach into the shadow root, so the diff takes the page's colours and falls back
// to diffStyles' own where a variable is missing.
const appStyles = `
:host {
  display: block;
  --vscode-editor-background: var(--bgColor-default);
  --vscode-editor-foreground: var(--fgColor-default);
  --vscode-editorLineNumber-foreground: var(--fgColor-muted);
  --vscode-panel-border: var(--borderColor-default);
  --vscode-sideBarSectionHeader-background: var(--bgColor-muted);
  --vscode-focusBorder: var(--borderColor-accent-emphasis);
  --vscode-textLink-foreground: var(--fgColor-accent);
}
.hh-app { display: grid; grid-template-columns: minmax(200px, 300px) minmax(0, 1fr); gap: 16px; height: calc(100vh - 80px); min-height: 400px; color: var(--fgColor-default, CanvasText); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
.hh-sets { overflow: auto; border: 1px solid var(--borderColor-default, #d0d7de); border-radius: 6px; padding: 4px 0; }
.hh-sets ul { list-style: none; margin: 0; padding: 0; }
.hh-sets ul ul { padding-left: 14px; }
.hh-sets-status, .hh-note { padding: 4px 12px; color: var(--fgColor-muted, GrayText); }
.hh-note.error { color: var(--fgColor-danger, #cf222e); }
.hh-row { display: flex; align-items: center; gap: 4px; padding: 0 8px 0 4px; }
.hh-row.selected { background: var(--bgColor-accent-muted, rgb(84 174 255 / 0.15)); }
.hh-sets button { border: 0; background: none; color: inherit; font: inherit; cursor: pointer; text-align: left; padding: 2px 4px; }
.hh-twisty { width: 20px; color: var(--fgColor-muted, GrayText) !important; }
.hh-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hh-desc { color: var(--fgColor-muted, GrayText); font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.hh-folder { padding: 2px 4px; color: var(--fgColor-muted, GrayText); }
.hh-file-row { display: flex; gap: 6px; width: 100%; white-space: nowrap; }
.hh-file-row.selected { background: var(--bgColor-accent-muted, rgb(84 174 255 / 0.15)); }
.hh-sets button:hover { background: var(--bgColor-neutral-muted, rgb(175 184 193 / 0.2)); }
.hh-sets button:focus-visible, .hh-nav:focus-visible { outline: 2px solid var(--borderColor-accent-emphasis, #0969da); outline-offset: -2px; }
.hh-letter { width: 1ch; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.hh-letter.A { color: var(--fgColor-success, #1a7f37); }
.hh-letter.D { color: var(--fgColor-danger, #cf222e); }
.hh-letter.M, .hh-letter.R { color: var(--fgColor-attention, #9a6700); }
.hh-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.hh-bar { display: flex; align-items: center; gap: 12px; padding: 0 0 8px; }
.hh-title { margin: 0; font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hh-meta { color: var(--fgColor-muted, GrayText); }
.hh-meta.error { color: var(--fgColor-danger, #cf222e); white-space: pre-wrap; }
.hh-nav { padding: 2px 8px; border: 1px solid var(--borderColor-default, #d0d7de); border-radius: 6px; background: var(--bgColor-muted, #f6f8fa); color: inherit; cursor: pointer; }
.hh-nav:disabled { opacity: 0.5; cursor: default; }
.hh-root { flex: 1; min-height: 0; overflow: auto; }
`;

export const app: App = { mount };
