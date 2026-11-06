import type { App, MountOptions } from "./app-api.js";

/**
 * What the page-side logic (src/content.ts) needs beyond what a content script may do: the extension answers it
 * through its background worker, the userscript through the userscript manager.
 */
export interface Privileged {
  /** Fetches an allowed GitHub URL with the reviewer's session; anything else must be refused. */
  fetch: MountOptions["fetch"];
  /** The engine and the renderer, loaded on first use. */
  loadApp(): Promise<App>;
  /** Whether the extension is enabled globally. A userscript without this hook is always enabled. */
  isEnabled?(): Promise<boolean>;
  /** Watches the extension's global setting. */
  onEnabledChanged?(listener: (enabled: boolean) => void): () => void;
}

export const enabledStorageKey = "enabled";

/**
 * The only URLs either host fetches. `pull/<n>.diff` and `raw/...` redirect from github.com to
 * patch-diff.githubusercontent.com and raw.githubusercontent.com, which the GitHub web host also asks directly to
 * skip that hop; api.github.com serves public pull request data and review comments.
 */
export const fetchable =
  /^https:\/\/(?:github\.com|api\.github\.com|patch-diff\.githubusercontent\.com|raw\.githubusercontent\.com)\//;
