import type { App, MountOptions } from "./app-api.js";

/**
 * What the page-side logic (src/content.ts) needs beyond what a content script may do: the extension answers it
 * through its background worker, the userscript through the userscript manager.
 */
export interface Privileged {
  /** Fetches a github.com URL with the reviewer's session; anything else must be refused. */
  fetch: MountOptions["fetch"];
  /** The engine and the renderer, loaded on first use. */
  loadApp(): Promise<App>;
}

/**
 * The only URLs either host fetches with the reviewer's cookies. `pull/<n>.diff` and `raw/...` redirect from
 * there to patch-diff.githubusercontent.com and raw.githubusercontent.com, which the fetch follows.
 */
export const fetchable = /^https:\/\/github\.com\//;
