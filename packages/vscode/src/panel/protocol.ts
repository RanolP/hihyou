import type { Theme } from "@hihyou/engine";
import type { DiffFile, ElidedRef } from "@hihyou/ui";

/** Extension host -> webview. */
export type ToWebview =
  | { type: "loading"; title: string }
  | { type: "files"; title: string; refreshable: boolean; files: DiffFile[] }
  | { type: "error"; title: string; message: string }
  /** Sent after `ready` and on every colour theme change, apart from the state above. */
  | { type: "theme"; theme: Theme }
  /** Scroll to the file at `path`, once per `seq`: the host replays the latest on every `ready`. */
  | { type: "focus"; path: string; seq: number };

/** Webview -> extension host. */
export type FromWebview =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "expand"; path: string; elided: ElidedRef };
