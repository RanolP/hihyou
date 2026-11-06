import { type ChangedFileRef, createEngine, type Theme } from "@hihyou/engine";
import {
  GENERATED_MERGE_SUBJECT,
  type GitHubWebDiffsetId,
  githubWebHost,
  type ThreadsAt,
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
  filesInReviewOrder,
  fileTree,
  githubDark,
  githubLight,
  isTestPath,
  renderDiffset,
  revealElided,
  sessionViewedStore,
  type ViewedState,
  type ViewedStore,
} from "@hihyou/ui";
import type { App, MountOptions, Mounted } from "./app-api.js";
import { renderDescription } from "./description.js";

/** One row of the diffsets panel: one of the pull request's commits. */
interface Row {
  key: string;
  label: string;
  description: string;
  tooltip?: string;
  id: GitHubWebDiffsetId;
  /** Which of the pull request's review threads have a line in this commit. */
  threadsAt: ThreadsAt;
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

/** The selection hash the last unmount cleared, and the page it belonged to. */
let turnedOffAt: { page: string; hash: string } | undefined;

function mount(host: HTMLElement, { page, fetch }: MountOptions): Mounted {
  const previousScrollbarGutter =
    document.documentElement.style.scrollbarGutter;
  document.documentElement.style.scrollbarGutter = "stable";
  // The view keeps its own place when it redraws; Chrome's scroll anchoring, reacting to GitHub's page loading
  // around it, moved a file restored from the URL 29px under the sticky bar.
  const previousOverflowAnchor = document.documentElement.style.overflowAnchor;
  document.documentElement.style.overflowAnchor = "none";
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  // The markup is a constant, so AMO's linter can see nothing is interpolated into innerHTML; the styles go in as text.
  shadow.innerHTML = `
<style class="styles"></style>
<style class="scheme"></style>
<div class="hh-app">
  <nav class="hh-sets" aria-label="Diffsets"><input class="hh-filter" type="search" aria-label="Filter changed files" placeholder="Filter changed files (/)" autocorrect="off" autocapitalize="off" spellcheck="false"><div class="hh-viewed-count" aria-live="polite"></div><div class="hh-sets-status">Loading commits…</div><ul role="tree"></ul><div class="hh-keys-dock"></div></nav>
  <section class="hh-main">
    <header class="hh-bar">
      <h2 class="hh-title"></h2>
      <span class="hh-meta message" role="status"></span>
      <button type="button" class="hh-nav previous" aria-label="Previous file" title="Previous file (k)" disabled>↑</button>
      <span class="hh-meta position"></span>
      <button type="button" class="hh-nav next" aria-label="Next file" title="Next file (j)" disabled>↓</button>
      <button type="button" class="hh-nav view-mode" aria-pressed="false">All files</button>
    </header>
    <section class="hh-diff hh-description" aria-labelledby="hh-description-title" hidden></section>
    <div class="hh-root"></div>
  </section>
</div>`;
  const $ = <T extends Element>(selector: string) =>
    shadow.querySelector(selector) as T;
  $<HTMLStyleElement>("style.styles").textContent = diffStyles + appStyles;
  const schemeStyle = $<HTMLStyleElement>("style.scheme");
  const filter = $<HTMLInputElement>(".hh-filter");
  const viewedCount = $<HTMLElement>(".hh-viewed-count");
  const setsStatus = $<HTMLElement>(".hh-sets-status");
  const tree = $<HTMLUListElement>(".hh-sets ul");
  const sets = $<HTMLElement>(".hh-sets");
  const keysDock = $<HTMLElement>(".hh-keys-dock");
  const appBar = $<HTMLElement>(".hh-main > .hh-bar");
  const title = $<HTMLElement>(".hh-title");
  const previous = $<HTMLButtonElement>(".previous");
  const next = $<HTMLButtonElement>(".next");
  const viewMode = $<HTMLButtonElement>(".view-mode");
  const position = $<HTMLElement>(".position");
  const status = $<HTMLElement>(".message");
  const description = $<HTMLElement>(".hh-description");
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
  /** Folders the reviewer folded in the sidebar, by row key and folder path. */
  const foldedFolders = new Set<string>();
  let allFiles = storedAllFiles();
  let currentPath: string | undefined;
  let pullBody: string | undefined;
  let descriptionExpanded = false;
  let testsShown = false;
  let targetedPath: string | undefined;
  // Where the page landed for `targetedPath`; the target holds until the reader scrolls away from it.
  let targetedY = Number.NaN;
  let trackingFrame: number | undefined;

  const measureDescription = () => {
    const text = description.querySelector<HTMLElement>(".hh-description-body");
    const toggle = description.querySelector<HTMLButtonElement>(
      ".hh-description-toggle",
    );
    if (!text || !toggle) return;
    // The collapsed box ends after the last block that fits whole, so no line is cut mid-glyph and no heading
    // is left standing without its section.
    text.style.maxHeight = "";
    if (!descriptionExpanded && text.scrollHeight > text.clientHeight + 1) {
      const top = text.getBoundingClientRect().top;
      let end = 0;
      for (const block of text.children) {
        const bottom = block.getBoundingClientRect().bottom - top;
        if (bottom > text.clientHeight) break;
        if (!/^H[1-6]$/.test(block.tagName)) end = bottom;
      }
      if (end > 0) text.style.maxHeight = `${Math.ceil(end)}px`;
    }
    toggle.hidden =
      !descriptionExpanded && text.scrollHeight <= text.clientHeight + 1;
  };
  const drawDescription = () => {
    description.replaceChildren();
    // The pull request's intent, above whichever commit is open.
    const body = pullBody;
    if (!body) {
      description.hidden = true;
      return;
    }
    description.hidden = false;
    const heading = el("h3", "hh-description-title", "Description");
    heading.id = "hh-description-title";
    const text = el("div", "hh-description-body");
    text.append(renderDescription(body, document));
    text.id = "hh-description-body";
    text.classList.toggle("hh-description-collapsed", !descriptionExpanded);
    const toggle = el(
      "button",
      "hh-button hh-description-toggle",
      descriptionExpanded ? "Hide description" : "Show full description",
    );
    toggle.type = "button";
    toggle.setAttribute("aria-controls", text.id);
    toggle.setAttribute("aria-expanded", String(descriptionExpanded));
    toggle.addEventListener("click", () => {
      descriptionExpanded = !descriptionExpanded;
      text.classList.toggle("hh-description-collapsed", !descriptionExpanded);
      toggle.textContent = descriptionExpanded
        ? "Hide description"
        : "Show full description";
      toggle.setAttribute("aria-expanded", String(descriptionExpanded));
      measureDescription();
    });
    description.append(heading, text, toggle);
    measureDescription();
  };
  const descriptionObserver = new ResizeObserver(measureDescription);
  descriptionObserver.observe(description);

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
            // GitHub's 2px page-load progress bar is fixed at the top too, but covers nothing.
            if (rect.top <= 1 && rect.height >= 8)
              bottom = Math.max(bottom, rect.bottom);
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

  const drawStatus = () => {
    status.classList.remove("error");
    if (files.length === 0) {
      status.textContent = "No changes.";
      return;
    }
    const testFiles = files.filter((file) => isTestPath(file.path));
    const grouped =
      allFiles && testFiles.length > 0 && testFiles.length < files.length;
    // With tests grouped, the two counts add up to the PR's total rather than one containing the other.
    const others = grouped ? files.length - testFiles.length : files.length;
    const changed = `${others} ${others === 1 ? "file" : "files"} changed`;
    if (!grouped) {
      status.textContent = changed;
      return;
    }
    // Each part's line counts, so tests hidden away still say how much of the pull request they are.
    const lines = (part: typeof files) => {
      const span = el("span", "hh-part-stats");
      const added = part.reduce((n, f) => n + (f.stats?.added ?? 0), 0);
      const removed = part.reduce((n, f) => n + (f.stats?.removed ?? 0), 0);
      span.append(
        el("span", "hh-stat-added", `+${added}`),
        " ",
        el("span", "hh-stat-removed", `−${removed}`),
      );
      return span;
    };
    const tests = `${testFiles.length} ${testFiles.length === 1 ? "test & fixture" : "tests & fixtures"}`;
    const source = files.filter((file) => !isTestPath(file.path));
    if (testsShown) {
      status.replaceChildren(
        `${changed} `,
        lines(source),
        ` · ${tests} shown `,
        lines(testFiles),
      );
      return;
    }
    const showTests = el("button", "hh-button", `${tests} hidden`);
    showTests.type = "button";
    showTests.addEventListener("click", () => {
      const path = testFiles[0]!.path;
      showFile(path);
      // The button is replaced once tests show; hand focus to the first test file instead of the page top.
      requestAnimationFrame(() =>
        [...root.querySelectorAll<HTMLElement>(".hh-file")]
          .find((section) => section.dataset["path"] === path)
          ?.querySelector<HTMLElement>(".hh-file-header a, .hh-file-header button")
          ?.focus({ preventScroll: true }),
      );
    });
    status.replaceChildren(
      `${changed} `,
      lines(source),
      " · ",
      showTests,
      " ",
      lines(testFiles),
    );
  };

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
  // Turning the view back on resumes where it was turned off, as long as the page and its hash are untouched.
  if (
    !location.hash &&
    turnedOffAt?.page === location.pathname + location.search
  )
    history.replaceState(history.state, "", turnedOffAt.hash);
  turnedOffAt = undefined;
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
    schemeStyle.textContent = `.hh-app, .hh-diff, .hh-keys { color-scheme: ${s}; }`;
    view?.setTheme(theme);
  };
  const themeObserver = new MutationObserver(applyTheme);
  themeObserver.observe(document.documentElement, {
    attributeFilter: ["data-color-mode"],
  });
  dark.addEventListener("change", applyTheme);
  applyTheme();

  const updateNav = () => {
    const ordered = filesInReviewOrder(files);
    const i = ordered.findIndex((f) => f.path === currentPath);
    previous.disabled = i <= 0 && !scrolledIntoCurrent();
    next.disabled = i < 0 || i >= ordered.length - 1;
    // Hidden tests come last in review order and are not on the page, so the count stops at the files shown; ↓ from
    // the last one still goes on and reveals them.
    const sources = ordered.filter((f) => !isTestPath(f.path)).length;
    const total =
      allFiles && !testsShown && sources > 0 ? sources : ordered.length;
    position.textContent = i < 0 ? "" : `${i + 1} / ${total}`;
    // With one file there is nothing to step to or between, so the controls would only fill the bar.
    const lone = ordered.length <= 1;
    for (const control of [previous, position, next, viewMode])
      control.hidden = lone;
    if (selected) replaceSelectionHash(selected, i < 0 ? "" : ordered[i]!.path);
    for (const section of root.querySelectorAll<HTMLElement>(".hh-file")) {
      if (allFiles && section.dataset["path"] === currentPath)
        section.setAttribute("aria-current", "true");
      else section.removeAttribute("aria-current");
    }
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
  /** Whether the current file's header is scrolled up past where a file lands. */
  const scrolledIntoCurrent = () => {
    if (!allFiles) return false;
    const section = [...root.querySelectorAll<HTMLElement>(".hh-file")].find(
      (candidate) => candidate.dataset["path"] === currentPath,
    );
    return (
      section !== undefined &&
      section.getBoundingClientRect().top < stuckFileTop() - 1
    );
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
      targetedY = window.scrollY;
    }
    updateNav();
  };
  const showFile = (path: string) => {
    if (!view || !files.some((file) => file.path === path)) return;
    view.show(path);
    selectFile(path);
  };
  const step = (delta: 1 | -1) => {
    const ordered = filesInReviewOrder(files);
    const index = ordered.findIndex((f) => f.path === currentPath);
    // Read into a file, ↑ goes back to its top first, where a click on it in the tree lands.
    const target =
      delta < 0 && scrolledIntoCurrent()
        ? ordered[index]
        : ordered[index + delta];
    if (!target) return;
    showFile(target.path);
  };
  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));

  const advanceAfterViewedClick = (event: MouseEvent) => {
    if (!view) return;
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
    if (path === undefined) return;
    if (allFiles) {
      // Folding the file one reads keeps it current where it cannot reach the sticky line; ticking another file
      // further down while reading this one leaves the reader where they are.
      if (path !== currentPath) {
        window.requestAnimationFrame(scheduleViewportUpdate);
        return;
      }
      targetedPath = path;
      targetedY = window.scrollY;
      window.requestAnimationFrame(() => {
        targetedY = window.scrollY;
        scheduleViewportUpdate();
      });
      return;
    }
    if (!view.fileViewed(path)) return;
    const ordered = filesInReviewOrder(files);
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
    // A file showing less than a line under the bar is scrolled past: the next file's header is what one reads.
    const showing = (header: HTMLElement) => {
      const bottom =
        header.closest<HTMLElement>(".hh-file")?.getBoundingClientRect().bottom ??
        0;
      // An open file's header slides down to the file's end once its lines are gone.
      const below = header.classList.contains("hh-collapsed")
        ? stickyTop
        : header.getBoundingClientRect().bottom;
      return bottom > Math.max(stickyTop, below) + 18;
    };
    const atTop = headers.findLast(
      (header) =>
        header.getBoundingClientRect().top <= stickyTop + 1 && showing(header),
    );
    let active = atTop ?? headers.find(showing);
    const scrolling = document.scrollingElement;
    const atBottom =
      scrolling !== null &&
      scrolling.scrollTop > 0 &&
      scrolling.scrollTop + scrolling.clientHeight >=
        scrolling.scrollHeight - 1;
    // A selected short file cannot reach the sticky line.
    if (targetedPath !== undefined) {
      const targeted = headers.find(
        (header) =>
          header.closest<HTMLElement>(".hh-file")?.dataset["path"] ===
          targetedPath,
      );
      const unmoved = Math.abs(window.scrollY - targetedY) < 2;
      if (unmoved && targeted !== undefined) active = targeted;
      else targetedPath = undefined;
    }
    // Scrolled to the end with no file stepped to, the reader is at the last one, however short.
    if (targetedPath === undefined && atBottom) active = headers.at(-1);
    const path = active?.closest<HTMLElement>(".hh-file")?.dataset["path"];
    if (path === undefined) return;
    if (path === currentPath) {
      // ↑ on the first file turns on once its top scrolls away, to go back to it.
      previous.disabled =
        filesInReviewOrder(files)[0]?.path === currentPath &&
        !scrolledIntoCurrent();
      return;
    }
    currentPath = path;
    updateNav();
  };
  // GitHub draws a tab as wide as the repository's .editorconfig says, per file; its own diff tables carry the width.
  const applyTabSizes = () => {
    const sizes = new Map<string, string>();
    for (const table of document.querySelectorAll("table[data-tab-size]")) {
      const path = table
        .closest("[data-tagsearch-path]")
        ?.getAttribute("data-tagsearch-path");
      const size = table.getAttribute("data-tab-size");
      if (path && size) sizes.set(path, size);
    }
    // A file GitHub has not drawn yet takes the width most of the drawn ones have.
    const counts = new Map<string, number>();
    for (const size of sizes.values()) counts.set(size, (counts.get(size) ?? 0) + 1);
    const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    for (const section of root.querySelectorAll<HTMLElement>(".hh-file")) {
      const size = sizes.get(section.dataset["path"] ?? "") ?? common;
      if (size && section.style.getPropertyValue("--hh-tab-size") !== size)
        section.style.setProperty("--hh-tab-size", size);
    }
  };
  const updateViewport = () => {
    trackingFrame = undefined;
    applyTabSizes();
    updatePageStickyTop();
    // Before the sidebar sticks it still ends at the window's bottom, so the key panel at its foot is on screen.
    const setsTop = `${Math.max(0, sets.getBoundingClientRect().top)}px`;
    if (sets.style.getPropertyValue("--hh-sets-top") !== setsTop)
      sets.style.setProperty("--hh-sets-top", setsTop);
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
    // Before a diffset loads, or after it failed, the status holds "Loading…" or the error.
    if (view) drawStatus();
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
      // The old files keep their height until the new ones draw, so the page does not collapse to the footer
      // and spring back while the diffset loads.
      root.style.minHeight = `${root.offsetHeight}px`;
      view?.dispose();
      view = undefined;
      currentPath = undefined;
      testsShown = false;
      targetedPath = undefined;
      root.textContent = "";
      position.textContent = "";
    }
    drawDescription();
    title.replaceChildren(`${row.description} `, ...codeSpans(row.label));
    title.title = `${row.description} ${row.label}`;
    status.textContent = "Loading…";
    status.classList.remove("error");
    drawTree();
    const current = review as NonNullable<typeof review>;
    try {
      const [loaded, reviewThreads] = await Promise.all([
        current.load(),
        // Threads come from the public REST API; a private repository (404) or an exhausted rate limit draws the review without them.
        host_
          .resolveReviewThreads(
            row.id.owner,
            row.id.repo,
            page.pull,
            row.threadsAt,
          )
          .catch((error: unknown) => {
            console.warn("hihyou: review threads unavailable", error);
            return [];
          }),
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
      files = filesInReviewOrder(files);
      drawStatus();
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
          onTestsShown: (shown) => {
            testsShown = shown;
            drawStatus();
            updateNav();
          },
          single: !allFiles,
          theme,
          viewed: persistedViewed.store,
          // github.com serves a commit's file at /raw/, on the page's own origin and session, so a private
          // repository's image loads too.
          media: (path) => {
            const { owner, repo } = row.id;
            const at = "commit" in row.id ? row.id.commit : row.id.head;
            return `https://github.com/${owner}/${repo}/raw/${at}/${path.split("/").map(encodeURIComponent).join("/")}`;
          },
          keysMount: keysDock,
          hostKeys: [
            {
              key: "/",
              label: "Filter files",
              section: "find",
              run: () => filter.focus(),
            },
          ],
        });
      root.style.minHeight = "";
      const hasPath =
        path === undefined || files.some((file) => file.path === path);
      const shownPath =
        path !== undefined && hasPath
          ? path
          : filesInReviewOrder(files)[0]?.path;
      if (shownPath !== undefined) {
        const section = [
          ...root.querySelectorAll<HTMLElement>(".hh-file"),
        ].find((candidate) => candidate.dataset["path"] === shownPath);
        // With no file asked for, a first file still below the bar leaves the page where the reader has it, as
        // GitHub's own load does.
        if (
          path === undefined &&
          allFiles &&
          section &&
          section.getBoundingClientRect().top >= stuckFileTop()
        )
          currentPath = shownPath;
        else showFile(shownPath);
      }
      updateNav();
      return hasPath;
    } catch (error) {
      if (at === generation && !disposed) {
        root.style.minHeight = "";
        fail(`could not load ${row.label}`, error);
      }
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
        const label = el("button", "hh-label");
        label.append(...codeSpans(row.label));
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
            else if (row === selected) {
              const testFiles = changes.filter((file) => isTestPath(file.path));
              const nonTestFiles = changes.filter(
                (file) => !isTestPath(file.path),
              );
              if (testFiles.length > 0 && nonTestFiles.length > 0) {
                group.append(...drawNodes(row, fileTree(nonTestFiles), shown));
                const tests = el("li");
                tests.setAttribute("role", "treeitem");
                tests.setAttribute("aria-expanded", "true");
                tests.append(el("div", "hh-folder hh-tests-folder", "Tests & fixtures"));
                const testGroup = el("ul");
                testGroup.setAttribute("role", "group");
                // Its own key space: a folder holding both sources and tests folds in each tree apart.
                testGroup.append(
                  ...drawNodes(row, fileTree(testFiles), shown, "tests:"),
                );
                tests.append(testGroup);
                group.append(tests);
              } else group.append(...drawNodes(row, fileTree(changes), shown));
            } else
              group.append(
                ...drawNodes(
                  row,
                  fileTree(changes),
                  undefined,
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
    prefix = "",
  ): HTMLElement[] =>
    nodes.map((node) => {
      const li = el("li");
      li.setAttribute("role", "treeitem");
      if (node.kind === "folder") {
        const path = `${prefix}${node.name}/`;
        const key = `${row.key}:${path}`;
        const open = !foldedFolders.has(key);
        li.setAttribute("aria-expanded", String(open));
        // A long folder chain wraps after a slash, not inside a name.
        const folder = el("button", "hh-folder");
        folder.type = "button";
        folder.dataset["key"] = key;
        folder.setAttribute("aria-expanded", String(open));
        const twisty = el("span", "hh-folder-twisty", open ? "▾" : "▸");
        twisty.setAttribute("aria-hidden", "true");
        folder.append(twisty);
        node.name.split("/").forEach((part, i) => {
          if (i > 0) folder.append("/", document.createElement("wbr"));
          folder.append(part);
        });
        folder.addEventListener("click", () => {
          if (open) foldedFolders.add(key);
          else foldedFolders.delete(key);
          drawTree();
          // drawTree rebuilds every node; keep keyboard focus on the folder just toggled.
          tree
            .querySelector<HTMLElement>(`button[data-key="${CSS.escape(key)}"]`)
            ?.focus();
        });
        li.append(folder);
        if (open) {
          const group = el("ul");
          group.setAttribute("role", "group");
          group.append(...drawNodes(row, node.children, shown, path));
          li.append(group);
        }
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
            ? "hh-file-name hh-file-viewed"
            : "hh-file-name",
          node.name,
        ),
      );
      const reason = file.collapsed
        ? collapseReasons[file.collapsed.reason]
        : undefined;
      // The D letter already says a deleted file is gone.
      if (reason && file.collapsed?.reason !== "deleted") {
        const hint = el("span", "hh-collapsed-hint");
        hint.append(el("span", "", reason));
        button.append(hint);
      }
      // The size of each file before opening it, so a reviewer can pick an order.
      if (file.stats) {
        const stats = el("span", "hh-file-stats");
        stats.append(
          el("span", "hh-stat-added", `+${file.stats.added}`),
          " ",
          el("span", "hh-stat-removed", `−${file.stats.removed}`),
        );
        stats.setAttribute(
          "aria-label",
          `${file.stats.added} lines added, ${file.stats.removed} lines removed`,
        );
        button.append(stats);
      }
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
    const pullBodyRequest = host_
      .resolvePullBody(page.owner, page.repo, page.pull)
      .then((body) => body.replace(/<!--[\s\S]*?-->/g, "").trim())
      .catch((error: unknown) => {
        console.warn(
          `hihyou: pull request #${page.pull} description unavailable`,
          error,
        );
        return "";
      });
    try {
      const pull = await host_.resolvePull(page.owner, page.repo, page.pull);
      if (disposed) return;
      const { owner, repo } = page;
      // A merge from the base moves the merge base past the first commit's parent.
      const merged = pull.commits.some((c) =>
        GENERATED_MERGE_SUBJECT.test(c.subject),
      );
      // A pull request is reviewed one commit at a time, newest first; no row diffs it whole.
      rows = pull.commits
        .map(
          (c, i): Row => ({
            key: c.sha,
            label: c.subject,
            description: c.sha.slice(0, 7),
            // The sidebar cuts a long subject short; the tooltip carries it whole.
            tooltip: `${c.subject}\n${c.author} · ${new Date(c.date).toLocaleString()}`,
            id: { owner, repo, commit: c.sha },
            threadsAt: {
              commit: c.sha,
              head: c.sha === pull.head,
              leftIsBefore: i === 0 && !merged,
            },
            expanded: false,
          }),
        )
        .toReversed();
      const [newest] = rows;
      if (!newest) {
        setsStatus.textContent = "No commits.";
        return;
      }
      setsStatus.remove();
      const saved = selectionFromHash();
      const savedRow = saved
        ? rows.find((row) => webDiffsetIdOf(row.id) === saved.id)
        : undefined;
      const initial = savedRow ?? newest;
      const described = pullBodyRequest.then((body) => {
        if (disposed) return;
        pullBody = body || undefined;
        drawDescription();
      });
      // The description sits above the files, so drawing it after them would push the diff down under the
      // reader; wait for it briefly first.
      await Promise.race([
        described,
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
      if (disposed) return;
      void expand(initial);
      const restored = await open(
        initial,
        savedRow && saved?.path ? saved.path : undefined,
      );
      if (savedRow && !restored && selected === initial && !disposed) {
        if (initial !== newest) void expand(newest);
        await open(newest);
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
      document.documentElement.style.overflowAnchor = previousOverflowAnchor;
      appBarObserver.disconnect();
      descriptionObserver.disconnect();
      host.style.removeProperty("--hh-app-bar-height");
      host.style.removeProperty("--hh-page-sticky-top");
      sets.style.removeProperty("--hh-sets-top");
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
      // With the view gone the selection hash names nothing on screen; GitHub's own view keeps a clean URL.
      if (location.hash.startsWith(hashPrefix)) {
        turnedOffAt = {
          page: location.pathname + location.search,
          hash: location.hash,
        };
        history.replaceState(history.state, "", location.pathname + location.search);
      }
    },
  };
}

/** Commit and PR titles as GitHub shows them: a `backticked` span reads as code. */
function codeSpans(text: string): Node[] {
  return text
    .split(/(`[^`]+`)/)
    .filter((part) => part !== "")
    .map((part) =>
      part.length > 2 && part.startsWith("`") && part.endsWith("`")
        ? el("code", "", part.slice(1, -1))
        : document.createTextNode(part),
    );
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
  /* VS Code's olive word highlight leaves a grey comment barely readable on an added line; GitHub's green does not. */
  --vscode-diffEditor-insertedLineBackground: var(--diffBlob-additionLine-bgColor);
  --vscode-diffEditor-insertedTextBackground: var(--diffBlob-additionWord-bgColor);
  --vscode-diffEditor-removedLineBackground: var(--diffBlob-deletionLine-bgColor);
  --vscode-diffEditor-removedTextBackground: var(--diffBlob-deletionWord-bgColor);
}
.hh-app { display: grid; grid-template-columns: minmax(200px, 300px) minmax(0, 1fr); align-items: start; gap: 16px; min-height: 400px; color: var(--fgColor-default, CanvasText); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
/* The tree and the key panel split the sidebar's height, each scrolling in its own box, so the panel never lies over a row. */
.hh-sets { position: sticky; top: var(--hh-page-sticky-top); align-self: start; display: flex; flex-direction: column; box-sizing: border-box; max-height: calc(100dvh - var(--hh-sets-top, var(--hh-page-sticky-top))); overflow: hidden; border: 1px solid var(--borderColor-default, #d0d7de); border-radius: 6px; padding: 4px 0; }
.hh-sets > * { flex: none; }
.hh-sets > ul { flex: 0 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.hh-filter { box-sizing: border-box; width: calc(100% - 16px); margin: 8px; border: 1px solid var(--borderColor-default, #d0d7de); border-radius: 6px; padding: 5px 8px; background: var(--bgColor-default, Canvas); color: inherit; font: inherit; }
.hh-viewed-count { padding: 0 12px 4px; color: var(--fgColor-muted, GrayText); font-size: 12px; }
/* The key panel sits at the foot of the sidebar, folded to its header line until opened, and never takes over half the window. */
.hh-keys-dock { max-height: 50dvh; overflow-y: auto; overscroll-behavior: contain; margin: 4px 0 -4px; border-top: 1px solid var(--borderColor-default, #d0d7de); }
.hh-keys-dock:empty { display: none; }
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
.hh-sets button.hh-folder { display: block; width: 100%; color: var(--fgColor-muted, GrayText); }
.hh-folder-twisty { display: inline-block; width: 1.2em; }
.hh-file-row { display: flex; align-items: baseline; gap: 6px; width: 100%; min-width: 0; white-space: nowrap; }
/* A long name ends in an ellipsis in place of widening the list; its hint gives way first. */
.hh-file-name, .hh-collapsed-hint > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.hh-file-name { flex: 0 1 auto; }
.hh-collapsed-hint { flex: 1 1 0; min-width: 0; container-type: inline-size; }
.hh-collapsed-hint > span { display: block; }
/* A hint squeezed to a letter or two reads as noise; the row title still carries it. */
@container (max-width: 7em) { .hh-collapsed-hint > span { visibility: hidden; } }
.hh-file-viewed { color: var(--fgColor-muted, GrayText); }
.hh-viewed-mark { margin-left: auto; color: var(--fgColor-muted, GrayText); }
.hh-file-stats { margin-left: auto; flex: none; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.hh-file-stats + .hh-viewed-mark { margin-left: 0; }
.hh-part-stats { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.hh-stat-added { color: var(--fgColor-success, #1a7f37); }
.hh-stat-removed { color: var(--fgColor-danger, #d1242f); }
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
.hh-title { flex: 1 1 24ch; min-width: 0; margin: 0; font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hh-title code, .hh-label code { padding: 0.1em 0.3em; border-radius: 6px; background: var(--bgColor-neutral-muted, rgba(175, 184, 193, 0.2)); font: 0.85em ui-monospace, SFMono-Regular, Menlo, monospace; }
.hh-meta { color: var(--fgColor-muted, GrayText); }
.hh-meta.error { color: var(--fgColor-danger, #cf222e); white-space: pre-wrap; }
.hh-nav { padding: 2px 8px; border: 1px solid var(--borderColor-default, #d0d7de); border-radius: 6px; background: var(--bgColor-muted, #f6f8fa); color: inherit; cursor: pointer; }
.hh-nav:disabled { opacity: 0.5; cursor: default; }
.hh-bar .position { min-width: 6ch; text-align: center; font-variant-numeric: tabular-nums; }
.hh-root { flex: 1; min-height: 0; overflow: visible; }
`;

export const app: App = { mount };
