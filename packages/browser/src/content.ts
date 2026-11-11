import type { App, Mounted } from "./app-api.js";
import { type PullFilesPage, pullFilesPage } from "./page.js";
import type { Privileged } from "./privileged.js";

/**
 * Where GitHub draws a PR's Files changed tab, most specific first: the classic page's `#files_bucket`, then the
 * root a React page renders into. Either can hold the PR header and its tab bar too, so hihyou hides only what
 * follows the tab bar there (see `diffParts`) and draws in its place.
 */
const tabRoots = [
  "#files_bucket",
  'react-app [data-target="react-app.reactRoot"]',
];
/**
 * Holds the view one width from "Loading" to the last file. On the React layout the view lands in PageLayout's
 * wrapping flex row, where it sized to its content: it shared the toggle's line while narrow, then wrapped and
 * grew as the description and files came in. GitHub's `container-xl` also capped it at 1280px there, where the
 * classic layout spans the page. The scrollbar gutter stays reserved so the page growing past the window does
 * not narrow it either. GitHub's own elements change only while the view is shown, so GitHub's view gets its own
 * layout back.
 */
const pageStyles = `
.hihyou-view { flex: 0 0 100%; min-width: 0; }
.container-xl:has(.hihyou-view:not([hidden])) { max-width: none; }
html:has(.hihyou-view:not([hidden])) { scrollbar-gutter: stable; }
`;
const optOutStorageKey = (key: string) => `hihyou:github-view:${key}`;

interface Current {
  key: string;
  page: PullFilesPage;
  bar: HTMLElement;
  view: HTMLElement;
  /** GitHub's diff, hidden while hihyou is on, with each element's own inline `display` to restore. */
  areas: { element: HTMLElement; display: string }[];
  mounted?: Mounted;
  on: boolean;
  /** Bumped on every toggle, so a mount that finishes after the reviewer turned hihyou off again is dropped. */
  generation: number;
}
let current: Current | undefined;
let privileged: Privileged;
let loaded: Promise<App> | undefined;
let eagerlyLoaded: string | undefined;
let globallyEnabled = true;

function optedOut(key: string): boolean {
  try {
    return sessionStorage.getItem(optOutStorageKey(key)) === "1";
  } catch {
    return false;
  }
}

function rememberOptOut(key: string, optOut: boolean) {
  try {
    if (optOut) sessionStorage.setItem(optOutStorageKey(key), "1");
    else sessionStorage.removeItem(optOutStorageKey(key));
  } catch {
    // A page with storage blocked just forgets the temporary choice.
  }
}

function teardown() {
  if (!current) return;
  current.mounted?.dispose();
  current.bar.remove();
  current.view.remove();
  show(current, true);
  current = undefined;
}

function show(state: Current, visible: boolean) {
  for (const { element, display } of state.areas)
    element.style.display = visible ? display : "none";
}

/**
 * The elements that draw the diff, never the PR header or its tab bar, whichever layout GitHub serves. The tab
 * bar is found by its Commits tab, which every PR page links. Of the candidate roots, the one holding that tab
 * wins, and hihyou hides everything after the tab bar there: from the link, the outermost ancestor inside the
 * root that has following siblings, and those siblings (the classic page's `diff-layout`, the React page's
 * `PageLayoutContent`). Only a root that does not hold the tab bar is hidden whole.
 */
function diffParts(page: PullFilesPage): HTMLElement[] {
  const roots = tabRoots.flatMap((s) => [
    ...document.querySelectorAll<HTMLElement>(s),
  ]);
  const tab = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].find(
    (a) => a.pathname.endsWith(`/pull/${page.pull}/commits`),
  );
  const root = roots.find((r) => tab && r.contains(tab));
  if (!root || !tab) return roots.slice(0, 1);
  let after: HTMLElement[] = [];
  for (let e: HTMLElement | null = tab; e && e !== root; e = e.parentElement) {
    const siblings: HTMLElement[] = [];
    for (let s = e.nextElementSibling; s; s = s.nextElementSibling)
      if (s instanceof HTMLElement) siblings.push(s);
    if (siblings.length > 0) after = siblings;
  }
  return after;
}

function loadApp(): Promise<App> {
  // A failed load is forgotten, so the next toggle tries again.
  loaded ??= privileged.loadApp().catch((error: unknown) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}

async function setOn(state: Current, on: boolean) {
  const generation = ++state.generation;
  const button = state.bar.querySelector("button") as HTMLButtonElement;
  const note = state.bar.querySelector(".hihyou-note") as HTMLElement;
  state.on = on;
  button.textContent = on ? "GitHub view" : "hihyou";
  button.title = on
    ? "Use GitHub's view for this pull request in this tab"
    : "Return to hihyou for this pull request";
  rememberOptOut(state.key, !on);
  if (!on) {
    state.mounted?.dispose();
    delete state.mounted;
    state.view.hidden = true;
    show(state, true);
    note.textContent = "";
    return;
  }
  show(state, false);
  state.view.hidden = false;
  if (state.mounted) return;
  try {
    note.textContent = "Loading hihyou…";
    const app = await loadApp();
    if (generation !== state.generation || current !== state) return;
    note.textContent = "";
    state.mounted = app.mount(state.view, {
      page: state.page,
      fetch: privileged.fetch,
    });
  } catch (error) {
    note.textContent = `hihyou could not start: ${String(error)}`;
    console.error("hihyou: could not start", error);
  }
}

function sync() {
  if (!globallyEnabled) {
    teardown();
    return;
  }
  const page = pullFilesPage(location.href);
  const key = page && `${page.owner}/${page.repo}#${page.pull}`;
  if (
    current &&
    (current.key !== key ||
      !current.bar.isConnected ||
      !current.areas.every((a) => a.element.isConnected))
  )
    teardown();
  if (!page || !key || current) return;
  // The app and its grammars load while GitHub is still drawing the diff area, not after it; once per pull
  // request, so a failed load is retried by the toggle rather than by every DOM change. setOn reports a failure.
  if (eagerlyLoaded !== key && !optedOut(key)) {
    eagerlyLoaded = key;
    loadApp().catch(() => {});
  }
  const parts = diffParts(page);
  const first = parts[0];
  // No root yet, or the tab bar is drawn but nothing after it: the next DOM change checks again.
  if (!first) return;

  const bar = document.createElement("div");
  bar.className = "hihyou-bar";
  bar.style.cssText = "display:flex;align-items:center;gap:8px;margin:8px 0;";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-sm";
  const note = document.createElement("span");
  note.className = "hihyou-note color-fg-muted";
  // Rides in the bar so it leaves with it.
  const style = document.createElement("style");
  style.textContent = pageStyles;
  bar.append(button, note, style);
  const view = document.createElement("div");
  view.className = "hihyou-view";
  view.hidden = true;
  first.before(bar, view);

  const state: Current = {
    key,
    page,
    bar,
    view,
    areas: parts.map((element) => ({
      element,
      display: element.style.display,
    })),
    on: false,
    generation: 0,
  };
  current = state;
  button.addEventListener("click", () => void setOn(state, !state.on));
  void setOn(state, !optedOut(key));
}

// GitHub navigates without reloading (Turbo, and React's own router), and draws the diff area after load, so
// every DOM change re-checks; `sync` returns at once when nothing moved.
// Small on purpose: it runs on every github.com page, and loads the app only on a pull request Files changed page.
export function start(host: Privileged) {
  privileged = host;
  globallyEnabled = host.isEnabled === undefined;
  try {
    localStorage.removeItem("hihyou:on");
  } catch {
    // A page with storage blocked may retain the obsolete preference.
  }
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  };
  // The document, not its root element: the extension starts before the parser has made one.
  new MutationObserver(schedule).observe(document, {
    childList: true,
    subtree: true,
  });
  addEventListener("turbo:load", schedule);
  addEventListener("popstate", schedule);
  let enabledGeneration = 0;
  const setEnabled = (enabled: boolean) => {
    enabledGeneration++;
    globallyEnabled = enabled;
    if (!enabled) teardown();
    schedule();
  };
  host.onEnabledChanged?.(setEnabled);
  if (host.isEnabled) {
    const generation = enabledGeneration;
    void host.isEnabled().then(
      (enabled) => {
        if (generation === enabledGeneration) setEnabled(enabled);
      },
      (error: unknown) => {
        console.error("hihyou: could not read the enabled setting", error);
        if (generation === enabledGeneration) setEnabled(true);
      },
    );
  } else sync();
}
