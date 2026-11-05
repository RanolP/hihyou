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
    if (!loaded) {
      note.textContent = "Loading hihyou…";
      // A failed load is forgotten, so the next toggle tries again.
      loaded = privileged.loadApp().catch((error: unknown) => {
        loaded = undefined;
        throw error;
      });
    }
    const app = await loaded;
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
  bar.append(button, note);
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
  new MutationObserver(schedule).observe(document.documentElement, {
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
