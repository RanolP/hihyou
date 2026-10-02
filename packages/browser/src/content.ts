import type { App, Mounted } from "./app-api.js";
import { type PullFilesPage, pullFilesPage } from "./page.js";
import type { Privileged } from "./privileged.js";

/**
 * Where GitHub draws a PR's diff, most specific first: the classic page's `#files_bucket`, then the root a
 * React page renders into. hihyou hides the first one present and draws in its place.
 */
const diffAreas = [
  "#files_bucket",
  'react-app [data-target="react-app.reactRoot"]',
];
const storageKey = "hihyou:on";

interface Current {
  key: string;
  page: PullFilesPage;
  bar: HTMLElement;
  view: HTMLElement;
  area: HTMLElement;
  areaDisplay: string;
  mounted?: Mounted;
  /** Bumped on every toggle, so a mount that finishes after the reviewer turned hihyou off again is dropped. */
  generation: number;
}
let current: Current | undefined;
let privileged: Privileged;
let loaded: Promise<App> | undefined;

function remembered(): boolean {
  try {
    return localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

function remember(on: boolean) {
  try {
    localStorage.setItem(storageKey, on ? "1" : "0");
  } catch {
    // A page with storage blocked just forgets the choice.
  }
}

function teardown() {
  if (!current) return;
  current.mounted?.dispose();
  current.bar.remove();
  current.view.remove();
  current.area.style.display = current.areaDisplay;
  current = undefined;
}

async function setOn(state: Current, on: boolean) {
  const generation = ++state.generation;
  const button = state.bar.querySelector("button") as HTMLButtonElement;
  const note = state.bar.querySelector(".hihyou-note") as HTMLElement;
  button.setAttribute("aria-pressed", String(on));
  remember(on);
  if (!on) {
    state.mounted?.dispose();
    delete state.mounted;
    state.view.hidden = true;
    state.area.style.display = state.areaDisplay;
    note.textContent = "";
    return;
  }
  state.area.style.display = "none";
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
  const page = pullFilesPage(location.href);
  const key = page && `${page.owner}/${page.repo}#${page.pull}`;
  if (
    current &&
    (current.key !== key ||
      !current.bar.isConnected ||
      !current.area.isConnected)
  )
    teardown();
  if (!page || !key || current) return;
  const area = diffAreas
    .map((s) => document.querySelector<HTMLElement>(s))
    .find((e) => e);
  if (!area) return;

  const bar = document.createElement("div");
  bar.className = "hihyou-bar";
  bar.style.cssText = "display:flex;align-items:center;gap:8px;margin:8px 0;";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-sm";
  button.textContent = "hihyou";
  button.title = "Review this pull request's changes with hihyou";
  const note = document.createElement("span");
  note.className = "hihyou-note color-fg-muted";
  bar.append(button, note);
  const view = document.createElement("div");
  view.className = "hihyou-view";
  view.hidden = true;
  area.before(bar, view);

  const state: Current = {
    key,
    page,
    bar,
    view,
    area,
    areaDisplay: area.style.display,
    generation: 0,
  };
  current = state;
  button.addEventListener(
    "click",
    () => void setOn(state, button.getAttribute("aria-pressed") !== "true"),
  );
  button.setAttribute("aria-pressed", "false");
  if (remembered()) void setOn(state, true);
}

// GitHub navigates without reloading (Turbo, and React's own router), and draws the diff area after load, so
// every DOM change re-checks; `sync` returns at once when nothing moved.
// Small on purpose: it runs on every github.com page, and loads the app only once a reviewer turns hihyou on.
export function start(host: Privileged) {
  privileged = host;
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
  sync();
}
