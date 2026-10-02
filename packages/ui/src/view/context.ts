import type { CompiledTheme } from "@hihyou/engine";
import { type Accessor, createContext, useContext } from "solid-js";
import type { Target } from "../atoms.js";
import type { ElidedRef, ExpandDirection } from "../expand.js";
import type { SideRef } from "../moves.js";
import type { DiffFile } from "../rows.js";
import type { PairView, Pairs } from "./pair.jsx";
import type { Placer } from "./placement.js";

/** `unified` interleaves both sides in one column, merging the lines that differ only by changed nodes. */
export type DiffLayout = "unified" | "split";

/** What every part of one drawn diffset reads and acts through. */
export interface DrawContext {
  doc: Document;
  files: Accessor<readonly DiffFile[]>;
  layout: Accessor<DiffLayout>;
  theme: Accessor<CompiledTheme | undefined>;
  placer: Placer;
  pairs: Pairs;
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
  isOpened(path: string): boolean;
  open(path: string): void;
  fileViewed(index: number, file: DiffFile): boolean;
  setFileViewed(index: number, file: DiffFile, on: boolean): void;
  /** Reactive: whether the atoms beneath a target are all, some or none viewed. */
  viewState(t: Target): "viewed" | "partial" | "unviewed" | undefined;
  /** Makes the target the modal editor's only selection, as a click on code does. */
  select(t: Target): void;
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
