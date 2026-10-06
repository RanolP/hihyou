import type { PullFilesPage } from "./page.js";

export interface MountOptions {
  page: PullFilesPage;
  /** Fetches a github.com URL with the browser's session, through the background worker. */
  fetch: (url: string, init?: { accept?: string }) => Promise<Response>;
}

export interface Mounted {
  dispose(): void;
}

/**
 * What app.js leaves behind for content.js. The two share the extension's isolated world, so a global is the
 * handshake: content.js stays small on every github.com page, and app.js is injected only once a reviewer
 * turns hihyou on.
 */
export interface App {
  mount(host: HTMLElement, options: MountOptions): Mounted;
}

declare global {
  var hihyouApp: App | undefined;
}
