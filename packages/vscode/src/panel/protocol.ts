import type { Theme } from "@hihyou/engine";
import type {
  DiffFile,
  ElidedRef,
  ExpandDirection,
} from "@hihyou/ui";

/** Extension host -> webview. */
export type ToWebview =
  | { type: "loading"; title: string }
  | { type: "files"; title: string; refreshable: boolean; files: DiffFile[] }
  | { type: "error"; title: string; message: string }
  /** Sent after `ready` and on every colour theme change, apart from the state above. */
  | { type: "theme"; theme: Theme }
  /** Draw the file at `path`, the only one shown; replayed after the state on every `ready`. */
  | { type: "show"; path: string }
  /** Show the next (1) or previous (-1) file. */
  | { type: "step"; delta: 1 | -1 };

/** Webview -> extension host. */
export type FromWebview =
  | { type: "ready" }
  | { type: "refresh" }
  | {
      type: "expand";
      path: string;
      elided: ElidedRef;
      direction: ExpandDirection;
    }
  | { type: "collapse"; path: string; elided: ElidedRef }
  /** The webview switched file on its own (next/previous, a move into another file). */
  | { type: "shown"; path: string };
