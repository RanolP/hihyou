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
  sessionViewedStore,
  type ViewedState,
  type ViewedStore,
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

const viewedStorageKey = (owner: string, repo: string, pull: number) =>
  `hihyou:viewed:${owner}/${repo}#${pull}`;
const viewModeStorageKey = "hihyou:view-mode";

const storedAllFiles = () => {
  try {
    return localStorage.getItem(viewModeStorageKey) !== "one";
  } catch {
    return true;
  }
};

const storeAllFiles = (allFiles: boolean) => {
  try {
    localStorage.setItem(viewModeStorageKey, allFiles ? "all" : "one");
  } catch {
    // Storage restrictions leave the mode usable for this mount.
  }
};

const parseViewedState = (value: string): ViewedState | undefined => {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  for (const entry of Object.values(parsed)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const candidate = entry as Record<string, unknown>;
    const ts = candidate["ts"];
    if (
      typeof candidate["viewed"] !== "boolean" ||
      typeof candidate["device"] !== "string" ||
      !ts ||
      typeof ts !== "object" ||
      Array.isArray(ts) ||
      !Number.isFinite((ts as Record<string, unknown>)["wall"]) ||
      !Number.isFinite((ts as Record<string, unknown>)["logical"])
    )
      return;
  }
  return parsed as ViewedState;
};

function persistentViewedStore(key: string): {
  store: ViewedStore;
  dispose(): void;
} {
  const store = sessionViewedStore();
  const read = (value: string | null) => {
    if (value === null) return;
    try {
      const state = parseViewedState(value);
      if (state) store.merge(state);
    } catch {
      // A malformed persisted value leaves the in-memory store usable.
    }
  };
  try {
    read(localStorage.getItem(key));
  } catch {
    // Storage may be unavailable; viewed state still lasts for this mount.
  }
  const unsubscribe = store.subscribe(() => {
    try {
      localStorage.setItem(key, JSON.stringify(store.state()));
    } catch {
      // Quota and privacy restrictions must not break the review UI.
    }
  });
  const mergeFromAnotherTab = (event: StorageEvent) => {
    if (event.key === key) read(event.newValue);
  };
  window.addEventListener("storage", mergeFromAnotherTab);
  return {
    store,
    dispose() {
      unsubscribe();
      window.removeEventListener("storage", mergeFromAnotherTab);
    },
  };
}

function mount(host: HTMLElement, { page, fetch }: MountOptions): Mounted {
  const previousScrollbarGutter =
    document.documentElement.style.scrollbarGutter;
  document.documentElement.style.scrollbarGutter = "stable";
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
<style>${diffStyles}${appStyles}</style>
<style class="scheme"></style>
<div class="hh-app">
  <nav class="hh-sets" aria-label="Diffsets"><input class="hh-filter" type="search" aria-label="Filter changed files" placeholder="Filter changed files (/)" autocorrect="off" autocapitalize="off" spellcheck="false"><div class="hh-viewed-count" aria-live="polite"></div><div class="hh-sets-status">Loading commits…</div><ul role="tree"></ul></nav>
  <section class="hh-main">
    <header class="hh-bar">
      <h2 class="hh-title"></h2>
      <button type="button" class="hh-nav previous" aria-label="Previous file" title="Previous file (k)" disabled>↑</button>
      <span class="hh-meta position"></span>
      <button type="button" class="hh-nav next" aria-label="Next file" title="Next file (j)" disabled>↓</button>
      <button type="button" class="hh-nav view-mode" aria-pressed="false">All files</button>
      <span class="hh-meta message" role="status"></span>
    </header>
    <div class="hh-root"></div>
  </section>
</div>`;
  const $ = <T extends Element>(selector: string) =>
    shadow.querySelector(selector) as T;
  const schemeStyle = $<HTMLStyleElement>("style.scheme");
  const filter = $<HTMLInputElement>(".hh-filter");
  const viewedCount = $<HTMLElement>(".hh-viewed-count");
  const setsStatus = $<HTMLElement>(".hh-sets-status");
  const tree = $<HTMLUListElement>(".hh-sets ul");
  const appBar = $<HTMLElement>(".hh-main > .hh-bar");
  const title = $<HTMLElement>(".hh-title");
  const previous = $<HTMLButtonElement>(".previous");
  const next = $<HTMLButtonElement>(".next");
  const viewMode = $<HTMLButtonElement>(".view-mode");
  const position = $<HTMLElement>(".position");
  const status = $<HTMLElement>(".message");
  const root = $<HTMLElement>(".hh-root");
  const persistedViewed = persistentViewedStore(
    viewedStorageKey(page.owner, page.repo, page.pull),
  );
  const appBarObserver = new ResizeObserver(() => {
    host.style.setProperty(
      "--hh-app-bar-height",
      `${appBar.getBoundingClientRect().height}px`,
    );
  });
  appBarObserver.observe(appBar);

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
  let allFiles = storedAllFiles();
  let currentPath: string | undefined;
  let targetedPath: string | undefined;
  let trackingFrame: number | undefined;

  const updatePageStickyTop = () => {
    const hostRect = host.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(window.innerWidth - 1, hostRect.left + hostRect.width / 2),
    );
    let bottom = 0;
    const visited = new Set<Element>();
    for (const hit of document.elementsFromPoint(x, 1)) {
      for (let element: Element | null = hit; element; ) {
        const rootNode = element.getRootNode();
        const insideHost =
          element === host ||
          host.contains(element) ||
          (rootNode instanceof ShadowRoot && rootNode.host === host);
        if (!visited.has(element) && !insideHost) {
          visited.add(element);
          const position = getComputedStyle(element).position;
          if (position === "sticky" || position === "fixed") {
            const rect = element.getBoundingClientRect();
            if (rect.top <= 1) bottom = Math.max(bottom, rect.bottom);
          }
        }
        element =
          element.parentElement ??
          (rootNode instanceof ShadowRoot ? rootNode.host : null);
      }
    }
    host.style.setProperty("--hh-page-sticky-top", `${Math.max(0, bottom)}px`);
  };

  const drawViewMode = () => {
    viewMode.textContent = "All files";
    viewMode.setAttribute("aria-pressed", String(allFiles));
    viewMode.title = allFiles ? "Switch to one file" : "Switch to all files";
  };
  drawViewMode();

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
    const i = ordered.findIndex((f) => f.path === currentPath);
    previous.disabled = i <= 0;
    next.disabled = i < 0 || i >= ordered.length - 1;
    position.textContent = i < 0 ? "" : `${i + 1} / ${ordered.length}`;
    if (selected) replaceSelectionHash(selected, i < 0 ? "" : ordered[i]!.path);
    drawTree();
  };
  const fileStickyTop = () =>
    root
      .querySelector<HTMLElement>(".hh-diff > .hh-bar")
      ?.getBoundingClientRect().bottom ?? appBar.getBoundingClientRect().bottom;
  // Where the sticky bar's bottom sits once stuck: measured where it is now, a bar still in flow at the page top
  // would be scrolled away and the file land that far below it.
  const stuckFileTop = () => {
    const bar = root.querySelector<HTMLElement>(".hh-diff > .hh-bar");
    if (!bar) return appBar.getBoundingClientRect().bottom;
    const top = Number.parseFloat(getComputedStyle(bar).top);
    return (Number.isNaN(top) ? 0 : top) + bar.getBoundingClientRect().height;
  };
  const selectFile = (path: string) => {
    currentPath = path;
    targetedPath = allFiles ? path : undefined;
    if (allFiles) {
      const section = [...root.querySelectorAll<HTMLElement>(".hh-file")].find(
        (candidate) => candidate.dataset["path"] === path,
      );
      if (section)
        window.scrollTo({
          top:
            window.scrollY +
            section.getBoundingClientRect().top -
            stuckFileTop(),
          // GitHub sets `scroll-behavior: smooth`; the tracker would read the frames in between.
          behavior: "instant",
        });
    }
    updateNav();
  };
  const showFile = (path: string) => {
    if (!view || !files.some((file) => file.path === path)) return;
    view.show(path);
    selectFile(path);
  };
  const step = (delta: 1 | -1) => {
    const ordered = filesInTreeOrder(files);
    const index = ordered.findIndex((f) => f.path === currentPath);
    const target = ordered[index + delta];
    if (!target) return;
    showFile(target.path);
  };
  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));

  const advanceAfterViewedClick = (event: MouseEvent) => {
    if (allFiles || !view) return;
    const button = event
      .composedPath()
      .find(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          element.matches(".hh-file-header .hh-viewed-toggle"),
      );
    const path = button
      ?.closest<HTMLElement>(".hh-file")
      ?.dataset["path"];
    if (path === undefined || !view.fileViewed(path)) return;
    const ordered = filesInTreeOrder(files);
    const index = ordered.findIndex((file) => file.path === path);
    if (index < 0) return;
    const target = ordered
      .slice(index + 1)
      .find((file) => view?.fileViewed(file.path) !== true);
    if (!target) return;
    showFile(target.path);
  };
  root.addEventListener("click", advanceAfterViewedClick);

  const trackCurrentFile = () => {
    if (!allFiles) return;
    const headers = [...root.querySelectorAll<HTMLElement>(".hh-file-header")];
    if (headers.length === 0) return;
    const stickyTop = fileStickyTop();
    const atTop = headers.findLast((header) => {
      const section = header.closest<HTMLElement>(".hh-file");
      return (
        header.getBoundingClientRect().top <= stickyTop + 1 &&
        (section?.getBoundingClientRect().bottom ?? 0) > stickyTop
      );
    });
    let active =
      atTop ??
      headers.find((header) => header.getBoundingClientRect().bottom > stickyTop);
    // A short final file cannot reach the sticky line.
    if (targetedPath !== undefined) {
      const scrolling = document.scrollingElement;
      const atBottom =
        scrolling !== null &&
        scrolling.scrollTop + scrolling.clientHeight >=
          scrolling.scrollHeight - 1;
      const targeted = headers.find(
        (header) =>
          header.closest<HTMLElement>(".hh-file")?.dataset["path"] ===
          targetedPath,
      );
      const section = targeted?.closest<HTMLElement>(".hh-file");
      const visible =
        targeted !== undefined &&
        section != null &&
        targeted.getBoundingClientRect().top < window.innerHeight &&
        section.getBoundingClientRect().bottom > stickyTop;
      if (atBottom && visible) active = targeted;
      else targetedPath = undefined;
    }
    const path = active?.closest<HTMLElement>(".hh-file")?.dataset["path"];
    if (path === undefined || path === currentPath) return;
    currentPath = path;
    updateNav();
  };
  const updateViewport = () => {
    trackingFrame = undefined;
    updatePageStickyTop();
    trackCurrentFile();
  };
  const scheduleViewportUpdate = () => {
    if (trackingFrame !== undefined) return;
    trackingFrame = requestAnimationFrame(updateViewport);
  };
  window.addEventListener("scroll", scheduleViewportUpdate, { passive: true });
  window.addEventListener("resize", scheduleViewportUpdate);
  scheduleViewportUpdate();
  const fileObserver = new MutationObserver(scheduleViewportUpdate);
  fileObserver.observe(root, { childList: true, subtree: true });

  viewMode.addEventListener("click", () => {
    const path = currentPath;
    allFiles = !allFiles;
    storeAllFiles(allFiles);
    drawViewMode();
    if (!allFiles && path !== undefined) showFile(path);
    view?.setSingle(!allFiles);
    if (allFiles && path !== undefined)
      requestAnimationFrame(() => {
        showFile(path);
        scheduleViewportUpdate();
      });
    updateNav();
  });
  const onKeydown = (event: KeyboardEvent) => {
    const target = event.composedPath()[0];
    if (
      event.defaultPrevented ||
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
  };
  document.addEventListener("keydown", onKeydown);

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
      currentPath = undefined;
      targetedPath = undefined;
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
          ? // Threads come from the public REST API; a private repository (404) or an exhausted rate limit draws the review without them.
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
            ...(thread.resolved !== undefined && {
              resolved: thread.resolved,
            }),
            comments: thread.comments,
          })),
      }));
      files = filesInTreeOrder(files);
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
          onShow: selectFile,
          single: !allFiles,
          theme,
          viewed: persistedViewed.store,
        });
      const hasPath =
        path === undefined || files.some((file) => file.path === path);
      const shownPath =
        path !== undefined && hasPath
          ? path
          : filesInTreeOrder(files)[0]?.path;
      if (shownPath !== undefined) {
        showFile(shownPath);
      }
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
    const shown = currentPath;
    const viewedFiles = files.filter(
      (file) => view?.fileViewed(file.path) === true,
    ).length;
    viewedCount.textContent = view
      ? `${viewedFiles} / ${files.length} viewed`
      : "";
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
          void open(row, currentPath);
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
        el(
          "span",
          row === selected && view?.fileViewed(file.path)
            ? "hh-file-viewed"
            : "",
          node.name,
        ),
      );
      const reason = file.collapsed
        ? collapseReasons[file.collapsed.reason]
        : undefined;
      if (reason) button.append(el("span", "hh-collapsed-hint", reason));
      if (row === selected && view?.fileViewed(file.path))
        button.append(el("span", "hh-viewed-mark", "✓"));
      const pathTitle = file.oldPath
        ? `${file.oldPath} → ${file.path}`
        : file.path;
      button.title = reason
        ? `${pathTitle} — ${reason} — diff hidden until opened`
        : pathTitle;
      button.addEventListener("click", () => {
        if (row === selected && view) {
          showFile(file.path);
        } else void open(row, file.path);
      });
      li.append(button);
      return li;
    });

  const unsubscribeViewed = persistedViewed.store.subscribe(drawTree);

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
      if (savedRow && !restored && selected === initial && !disposed) {
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
      document.documentElement.style.scrollbarGutter =
        previousScrollbarGutter;
      appBarObserver.disconnect();
      host.style.removeProperty("--hh-app-bar-height");
      host.style.removeProperty("--hh-page-sticky-top");
      themeObserver.disconnect();
      fileObserver.disconnect();
      if (trackingFrame !== undefined) cancelAnimationFrame(trackingFrame);
      window.removeEventListener("scroll", scheduleViewportUpdate);
      window.removeEventListener("resize", scheduleViewportUpdate);
      dark.removeEventListener("change", applyTheme);
      document.removeEventListener("keydown", onKeydown);
      root.removeEventListener("click", advanceAfterViewedClick);
      unsubscribeViewed();
      persistedViewed.dispose();
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
.hh-sets { position: sticky; top: var(--hh-page-sticky-top); align-self: start; box-sizing: border-box; max-height: calc(100dvh - var(--hh-page-sticky-top)); overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; border: 1px solid var(--borderColor-default, #d0d7de); border-radius: 6px; padding: 4px 0; }
.hh-filter { box-sizing: border-box; width: calc(100% - 16px); margin: 8px; border: 1px solid var(--borderColor-default, #d0d7de); border-radius: 6px; padding: 5px 8px; background: var(--bgColor-default, Canvas); color: inherit; font: inherit; }
.hh-viewed-count { padding: 0 12px 4px; color: var(--fgColor-muted, GrayText); font-size: 12px; }
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
.hh-file-viewed { color: var(--fgColor-muted, GrayText); }
.hh-viewed-mark { margin-left: auto; color: var(--fgColor-muted, GrayText); }
.hh-file-row.selected { background: var(--bgColor-accent-muted, rgb(84 174 255 / 0.15)); }
.hh-collapsed-hint { color: var(--fgColor-muted, GrayText); font-size: 12px; }
.hh-sets button:hover { background: var(--bgColor-neutral-muted, rgb(175 184 193 / 0.2)); }
.hh-sets button:focus-visible, .hh-nav:focus-visible { outline: 2px solid var(--borderColor-accent-emphasis, #0969da); outline-offset: -2px; }
.hh-letter { width: 1ch; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.hh-letter.A { color: var(--fgColor-success, #1a7f37); }
.hh-letter.D { color: var(--fgColor-danger, #cf222e); }
.hh-letter.M, .hh-letter.R { color: var(--fgColor-attention, #9a6700); }
.hh-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.hh-main > .hh-bar { position: sticky; top: var(--hh-page-sticky-top); z-index: 4; box-sizing: border-box; min-height: 37px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 0 0 8px; background: var(--bgColor-default, Canvas); }
.hh-main > .hh-bar > :not(.hh-title) { flex-shrink: 0; white-space: nowrap; }
.hh-root .hh-bar { top: calc(var(--hh-page-sticky-top) + var(--hh-app-bar-height)); }
.hh-title { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hh-meta { color: var(--fgColor-muted, GrayText); }
.hh-meta.error { color: var(--fgColor-danger, #cf222e); white-space: pre-wrap; }
.hh-nav { padding: 2px 8px; border: 1px solid var(--borderColor-default, #d0d7de); border-radius: 6px; background: var(--bgColor-muted, #f6f8fa); color: inherit; cursor: pointer; }
.hh-nav:disabled { opacity: 0.5; cursor: default; }
.hh-root { flex: 1; min-height: 0; overflow: visible; }
`;

export const app: App = { mount };
