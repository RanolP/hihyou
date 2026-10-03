import type { Theme } from "@hihyou/engine";
import type { AnchorData } from "@hihyou/engine";
import type {
  DiffFile,
  ElidedRef,
  ExpandDirection,
  ReviewEvent,
  ReviewNote,
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
  | { type: "step"; delta: 1 | -1 }
  /** The host keeps this panel's comments: their state, sent on `ready` and on every change. */
  | { type: "comments"; notes: ReviewNote[]; reviewing: boolean }
  /** The answer to the webview's request `id`; `error` when it failed. */
  | { type: "commented"; id: number; error?: string };

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
  | { type: "shown"; path: string }
  /** One call on the host's comment store, answered by `commented` with the same `id`. */
  | {
      type: "comment";
      id: number;
      how: "comment" | "review";
      anchor: AnchorData;
      body: string;
    }
  | {
      type: "reply";
      id: number;
      how: "reply" | "reviewReply";
      thread: string;
      body: string;
    }
  | { type: "submitReview"; id: number; event: ReviewEvent };
