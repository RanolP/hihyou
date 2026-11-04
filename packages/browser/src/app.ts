import { type ChangedFileRef, createEngine, type Theme } from "@hihyou/engine";
import {
  type GitHubWebDiffsetId,
  githubWebHost,
  webDiffsetIdOf,
} from "@hihyou/github";
import {
  collapseReasons,
  collapseElided,
  type DiffFile,
  type DiffsetView,
  diffStyles,
  engineReview,
  type FileTreeNode,
  filesInTreeOrder,
  fileTree,
  githubDark,
  githubLight,
  renderDiffset,
  revealElided,
} from "@hihyou/ui";
import type { App, MountOptions, Mounted } from "./app-api.js";

/** One row of the diffsets panel: the pull request's whole change or one of its commits. */
interface Row {
  key: string;
  label: string;
  description: string;
  tooltip?: string;
  id: GitHubWebDiffsetId;
  expanded: boolean;
  /** The row's files, once it was expanded or opened. */
  changes?: readonly ChangedFileRef[];
  error?: string;
}

type SidebarFile = ChangedFileRef & Pick<DiffFile, "collapsed">;

function mount(host: HTMLElement, { page, fetch }: MountOptions): Mounted {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
<style>${diffStyles}${appStyles}</style>
<style class="scheme"></style>
<div class="hh-app">
  <nav class="hh-sets" aria-label="Diffsets"><input class="hh-filter" type="search" aria-label="Filter changed files" placeholder="Filter changed files (/)" autocorrect="off" autocapitalize="off" spellcheck="false"><div class="hh-sets-status">Loading commits…</div><ul role="tree"></ul></nav>
  <section class="hh-main">
    <header class="hh-bar">
      <h2 class="hh-title"></h2>
      <button type="button" class="hh-nav previous" aria-label="Previous file" title="Previous file (k)" disabled>↑</button>
      <span class="hh-meta position"></span>
      <button type="button" class="hh-nav next" aria-label="Next file" title="Next file (j)" disabled>↓</button>
      <span class="hh-meta message" role="status"></span>
    </header>
    <div class="hh-root"></div>
  </section>
</div>`;
  const $ = <T extends Element>(selector: string) =>
    shadow.querySelector(selector) as T;
  const schemeStyle = $<HTMLStyleElement>("style.scheme");
  const filter = $<HTMLInputElement>(".hh-filter");
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
  let mounting = true;
  let fileFilter = "";

  filter.addEventListener("input", () => {
    fileFilter = filter.value.toLowerCase();
    drawTree();
  });
  filter.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    filter.value = "";
    fileFilter = "";
    drawTree();
  });

  const hashPrefix = "#hihyou=";
  const selectionFromHash = () => {
    if (!location.hash.startsWith(hashPrefix)) return;
    const value = location.hash.slice(hashPrefix.length);
    const separator = value.indexOf(":");
    if (separator < 0) return;
    try {
      return {
        id: decodeURIComponent(value.slice(0, separator)),
        path: decodeURIComponent(value.slice(separator + 1)),
      };
    } catch {
      return;
    }
  };
  const replaceSelectionHash = (row: Row, path: string) => {
    if (mounting && location.hash && !location.hash.startsWith(hashPrefix))
      return;
    const hash = `${hashPrefix}${encodeURIComponent(webDiffsetIdOf(row.id))}:${encodeURIComponent(path)}`;
    history.replaceState(history.state, "", hash);
  };

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

  const updateNav = () => {
    const ordered = filesInTreeOrder(files);
    const i = ordered.findIndex((f) => f.path === view?.shown());
    previous.disabled = i <= 0;
    next.disabled = i < 0 || i >= ordered.length - 1;
    position.textContent = i < 0 ? "" : `${i + 1} / ${ordered.length}`;
    if (selected) replaceSelectionHash(selected, i < 0 ? "" : ordered[i]!.path);
    drawTree();
  };
  const step = (delta: 1 | -1) => {
    const ordered = filesInTreeOrder(files);
    const index = ordered.findIndex((f) => f.path === view?.shown());
    const target = ordered[index + delta];
    if (!view || !target) return;
    view.show(target.path);
    updateNav();
  };
  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  const onKeydown = (event: KeyboardEvent) => {
    const target = event.composedPath()[0];
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable))
    )
      return;

    if (event.key === "j") step(1);
    else if (event.key === "k") step(-1);
    else if (event.key === "/") filter.focus();
    else return;

    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener("keydown", onKeydown, true);

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
  const open = async (row: Row, path?: string): Promise<boolean> => {
    const at = ++generation;
    if (selected !== row) {
      // One open file tree at a time: a file clicked in the old row's tree would switch scope back.
      if (selected) selected.expanded = false;
      selected = row;
      review = engineReview(engine, () => row.id);
      files = [];
      view?.dispose();
      view = undefined;
      root.textContent = "";
    }
    title.textContent = `${row.description} ${row.label}`;
    status.textContent = "Loading…";
    status.classList.remove("error");
    drawTree();
    const current = review as NonNullable<typeof review>;
    try {
      const [loaded, reviewThreads] = await Promise.all([
        current.load(),
        "pull" in row.id
          ? // Threads come from GitHub's page markup; when it changes, the review still draws without them.
            host_
              .resolveReviewThreads(row.id.owner, row.id.repo, row.id.pull)
              .catch((error: unknown) => {
                console.warn("hihyou: review threads unavailable", error);
                return [];
              })
          : Promise.resolve([]),
      ]);
      if (at !== generation || disposed) return false;
      files = loaded.map((file) => ({
        ...file,
        reviewThreads: reviewThreads
          .filter(
            (thread) =>
              thread.path === file.path || thread.path === file.change?.oldPath,
          )
          .map((thread) => ({
            ...(thread.before !== undefined && { before: thread.before }),
            ...(thread.after !== undefined && { after: thread.after }),
            resolved: thread.resolved,
            comments: thread.comments,
          })),
      }));
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
      const hasPath =
        path === undefined || files.some((file) => file.path === path);
      const shownPath = path ?? filesInTreeOrder(files)[0]?.path;
      if (shownPath !== undefined && hasPath) view.show(shownPath);
      updateNav();
      return hasPath;
    } catch (error) {
      if (at === generation && !disposed)
        fail(`could not load ${row.label}`, error);
      return false;
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
          else {
            const source: readonly SidebarFile[] =
              row === selected && files.length > 0
                ? files.flatMap((file) =>
                    file.change
                      ? [
                          {
                            ...file.change,
                            ...(file.collapsed && {
                              collapsed: file.collapsed,
                            }),
                          },
                        ]
                      : [],
                  )
                : row.changes;
            const changes = source.filter((file) =>
              file.path.toLowerCase().includes(fileFilter),
            );
            if (changes.length === 0)
              group.append(el("li", "hh-note", "No matching files"));
            else
              group.append(
                ...drawNodes(
                  row,
                  fileTree(changes),
                  row === selected ? shown : undefined,
                ),
              );
          }
          li.append(group);
        }
        return li;
      }),
    );
  };
  const drawNodes = (
    row: Row,
    nodes: FileTreeNode<SidebarFile>[],
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
      const reason = file.collapsed
        ? collapseReasons[file.collapsed.reason]
        : undefined;
      if (reason) button.append(el("span", "hh-collapsed-hint", reason));
      const pathTitle = file.oldPath
        ? `${file.oldPath} → ${file.path}`
        : file.path;
      button.title = reason
        ? `${pathTitle} — ${reason} — diff hidden until opened`
        : pathTitle;
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
      const allChanges: Row = {
        key: `pull-${page.pull}`,
        label: "All changes",
        description: `${pull.commits.length} ${pull.commits.length === 1 ? "commit" : "commits"}`,
        id: { owner, repo, pull: page.pull, head: pull.head },
        expanded: false,
      };
      rows = [
        allChanges,
        ...pull.commits.map((c): Row => ({
          key: c.sha,
          label: c.subject,
          description: c.sha.slice(0, 7),
          tooltip: `${c.author} · ${new Date(c.date).toLocaleString()}`,
          id: { owner, repo, commit: c.sha },
          expanded: false,
        })),
      ];
      setsStatus.remove();
      const saved = selectionFromHash();
      const savedRow = saved
        ? rows.find((row) => webDiffsetIdOf(row.id) === saved.id)
        : undefined;
      const initial = savedRow ?? allChanges;
      void expand(initial);
      const restored = await open(
        initial,
        savedRow && saved?.path ? saved.path : undefined,
      );
      if (savedRow && !restored) {
        if (initial !== allChanges) void expand(allChanges);
        await open(allChanges);
      }
    } catch (error) {
      if (disposed) return;
      setsStatus.textContent = "Could not list the commits.";
      fail(`could not load pull request #${page.pull}`, error);
    } finally {
      mounting = false;
    }
  })();

  return {
    dispose() {
      disposed = true;
      themeObserver.disconnect();
      dark.removeEventListener("change", applyTheme);
      document.removeEventListener("keydown", onKeydown, true);
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
  --hh-page-sticky-top: 60px;
  --hh-app-bar-height: 37px;
  --hihyou-file-max-height: none;
  --vscode-editor-background: var(--bgColor-default);
  --vscode-editor-foreground: var(--fgColor-default);
  --vscode-editorLineNumber-foreground: var(--fgColor-muted);
  --vscode-panel-border: var(--borderColor-default);
  --vscode-sideBarSectionHeader-background: var(--bgColor-muted);
  --vscode-focusBorder: var(--borderColor-accent-emphasis);
  --vscode-textLink-foreground: var(--fgColor-accent);
}
.hh-app { display: grid; grid-template-columns: minmax(200px, 300px) minmax(0, 1fr); align-items: start; gap: 16px; min-height: 400px; color: var(--fgColor-default, CanvasText); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
.hh-sets { position: sticky; top: var(--hh-page-sticky-top); max-height: calc(100vh - var(--hh-page-sticky-top)); overflow: auto; border: 1px solid var(--borderColor-default, #d0d7de); border-radius: 6px; padding: 4px 0; }
.hh-filter { box-sizing: border-box; width: calc(100% - 16px); margin: 8px; border: 1px solid var(--borderColor-default, #d0d7de); border-radius: 6px; padding: 5px 8px; background: var(--bgColor-default, Canvas); color: inherit; font: inherit; }
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
.hh-collapsed-hint { color: var(--fgColor-muted, GrayText); font-size: 12px; }
.hh-sets button:hover { background: var(--bgColor-neutral-muted, rgb(175 184 193 / 0.2)); }
.hh-sets button:focus-visible, .hh-nav:focus-visible { outline: 2px solid var(--borderColor-accent-emphasis, #0969da); outline-offset: -2px; }
.hh-letter { width: 1ch; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.hh-letter.A { color: var(--fgColor-success, #1a7f37); }
.hh-letter.D { color: var(--fgColor-danger, #cf222e); }
.hh-letter.M, .hh-letter.R { color: var(--fgColor-attention, #9a6700); }
.hh-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.hh-main > .hh-bar { position: sticky; top: var(--hh-page-sticky-top); z-index: 4; box-sizing: border-box; min-height: var(--hh-app-bar-height); display: flex; align-items: center; gap: 12px; padding: 0 0 8px; background: var(--bgColor-default, Canvas); }
.hh-root .hh-bar { top: calc(var(--hh-page-sticky-top) + var(--hh-app-bar-height)); }
.hh-title { margin: 0; font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hh-meta { color: var(--fgColor-muted, GrayText); }
.hh-meta.error { color: var(--fgColor-danger, #cf222e); white-space: pre-wrap; }
.hh-nav { padding: 2px 8px; border: 1px solid var(--borderColor-default, #d0d7de); border-radius: 6px; background: var(--bgColor-muted, #f6f8fa); color: inherit; cursor: pointer; }
.hh-nav:disabled { opacity: 0.5; cursor: default; }
.hh-root { flex: 1; min-height: 0; overflow: visible; }
`;

export const app: App = { mount };
