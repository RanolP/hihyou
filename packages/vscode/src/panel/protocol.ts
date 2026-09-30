import type { DiffFile, ElidedRef } from "@hihyou/ui";

/** Extension host -> webview. */
export type ToWebview =
  | { type: "loading"; title: string }
  | { type: "files"; title: string; refreshable: boolean; files: DiffFile[] }
  | { type: "error"; title: string; message: string };

/** Webview -> extension host. */
export type FromWebview =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "expand"; path: string; elided: ElidedRef };
