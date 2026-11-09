import type { CompiledTheme } from "@hihyou/engine";
import { type Accessor, createContext, useContext } from "solid-js";
import type { ElidedRef, ExpandDirection } from "../expand.js";
import type { SideRef } from "../moves.js";
import type { DiffFile } from "../rows.js";
import type { LazyFiles } from "./lazy.js";
import type { PairView, Pairs } from "./pair.jsx";
import type { Placer } from "./placement.js";

/** What every part of one drawn diffset reads and acts through. */
export interface DrawContext {
  doc: Document;
  files: Accessor<readonly DiffFile[]>;
  theme: Accessor<CompiledTheme | undefined>;
  /** `RenderOptions.media`. */
  media: ((path: string) => string | undefined) | undefined;
  placer: Placer;
  pairs: Pairs;
  /** Which files have drawn their rows, and draws the rest as they near the viewport or the page idles. */
  lazy: LazyFiles;
  /** What a click on a non-button element does: a cross-file move's block expands it, unless the click selects. */
  actions: WeakMap<Element, () => void>;
  /** Which pair a label or expansion row belongs to, for Escape. */
  pairOfElement: WeakMap<Element, PairView>;
  /** Registers a control that keeps keyboard focus across a redraw, by an id stable across draws. */
  focusable(e: HTMLElement, id: string): void;
  /** Records a fragment's row, for a jump into it. */
  remember(index: number, fragment: number, tr: HTMLTableRowElement): void;
  jump(to: SideRef): void;
  openFile(path: string): void;
  fileCollapsed(index: number, file: DiffFile): boolean;
  /** Folds or unfolds a file by hand; its Viewed state stays as it was. */
  setFileCollapsed(path: string, on: boolean): void;
  fileViewed(index: number, file: DiffFile): boolean;
  setFileViewed(index: number, file: DiffFile, on: boolean): void;
  onExpand:
    | ((fileId: string, elided: ElidedRef, direction: ExpandDirection) => void)
    | undefined;
  onCollapse: ((fileId: string, elided: ElidedRef) => void) | undefined;
}

export const Draw = createContext<DrawContext>();

export const useDraw = (): DrawContext => {
  const ctx = useContext(Draw);
  if (!ctx) throw new Error("hihyou: a diff part drew outside renderDiffset");
  return ctx;
};
