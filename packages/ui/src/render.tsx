import { type AnchorData, compileTheme, type Theme } from "@hihyou/engine";
import {
  createComputed,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  on,
  untrack,
} from "solid-js";
import { insert } from "solid-js/web";
import {
  type AtomIndex,
  atomIndex,
  atomViewed,
  type NodeRef,
  nodeScore,
  setViewed,
  treeOf,
  viewedOf,
} from "./atoms.js";
import {
  addAt,
  bindModal,
  emptyModal,
  type ModalBinding,
  type ModalEffect,
  type ModalState,
  narrowAt,
  selectAt,
} from "./modal.js";
import {
  anchorOf,
  type CharRange,
  type CommentStore,
  displayRange,
  linePos,
  nodeText,
  refOf,
  sessionCommentStore,
} from "./comments.js";
import { approvalOf, reviewEvent } from "./approval.js";
import { type ElidedRef, type ExpandDirection, expandStep } from "./expand.js";
import { moveAt, type SideRef } from "./moves.js";
import { type DiffFile, gapOf } from "./rows.js";
import { Draw, type DrawContext } from "./view/context.js";
import { FileSection } from "./view/file.jsx";
import { flash } from "./view/flash.js";
import { createPainter } from "./view/highlights.js";
import { ApprovalBadge } from "./view/approval.jsx";
import { KeyInfo, KeyToolbar, scoreText, SubmitReview } from "./view/keys.jsx";
import { controls, modalRoot } from "./view/modal-root.js";
import { createPairs, type PairView } from "./view/pair.jsx";
import { createPlacer } from "./view/placement.js";
import { pointAt } from "./view/pointer.js";
import { viewState } from "./whole.js";
import {
  type KeyOf,
  plainKeyOf,
  type Score,
  type ScoreStore,
  sessionScoreStore,
  sessionViewedStore,
  type ViewedStore,
} from "./viewed.js";

export { type ElidedRef, type ExpandDirection, expandStep };

export interface RenderOptions {
  /**
   * The reviewer asked to see more of an elided run. `fileId` is `FileDiff.path`. `diff()` returns no text for
   * an elided run, so the host asks `Diffset.expand` for the lines (`gapOf` says which are still hidden) and
   * answers with `update`, the file's `revealed` grown by them.
   * Without this callback an elided run shows as a plain note.
   */
  onExpand?(
    fileId: string,
    elided: ElidedRef,
    direction: ExpandDirection,
  ): void;
  /** The reviewer folded a run's revealed lines away again: answer with `update`, its `revealed` entry dropped. */
  onCollapse?(fileId: string, elided: ElidedRef): void;
  /**
   * Draws one file at a time, the first until `show` picks another. Called with the file's path whenever the
   * renderer itself switches file (following a move into another file).
   */
  onShow?(fileId: string): void;
  /** Colours `Span.scope`: a VS Code theme, `include`s already followed. Without one, code is drawn uncoloured. */
  theme?: Theme;
  /** Which move pairs and files are viewed; an in-session store when absent. */
  viewed?: ViewedStore;
  /** Each node's Code-Review score; an in-session store when absent. */
  scores?: ScoreStore;
  /** The comments written on nodes; an in-session store when absent. */
  comments?: CommentStore;
  /** The store's key for each viewed subject and scored node; `plainKeyOf` when absent. */
  keyOf?: KeyOf;
}

export interface DiffsetView {
  /** Redraws with new files, keeping which collapsed files are open and each file's scroll position. */
  update(files: readonly DiffFile[]): void;
  /** Redraws with another theme, as `update` keeps state. */
  setTheme(theme: Theme | undefined): void;
  /** With `onShow`: draws the file at `path` instead, scrolled to its top. */
  show(path: string): void;
  /** With `onShow`: the path of the file drawn. */
  shown(): string | undefined;
  dispose(): void;
}

/**
 * Draws `files` into `root` as one unified table per file. All text goes in as text nodes, and the
 * styles are not injected: put `diffStyles` into the page.
 */
export function renderDiffset(
  root: HTMLElement,
  files: readonly DiffFile[],
  opts: RenderOptions = {},
): DiffsetView {
  return createRoot((dispose) => mount(root, files, opts, dispose));
}

function mount(
  root: HTMLElement,
  initial: readonly DiffFile[],
  opts: RenderOptions,
  disposeRoot: () => void,
): DiffsetView {
  const doc = root.ownerDocument;
  const single = opts.onShow !== undefined;
  const viewed = opts.viewed ?? sessionViewedStore();
  const keyOf = opts.keyOf ?? plainKeyOf;
  const isViewed = atomViewed(viewed, keyOf);

  const [files, setFiles] = createSignal(initial);
  const [theme, setTheme] = createSignal(
    opts.theme && compileTheme(opts.theme),
  );
  /** Bumped by every change of what is drawn that no other signal carries: a file opened or shown. */
  const [version, bump] = createSignal(0);
  const redraw = () => bump((v) => v + 1);
  /** The viewed store changes in place; this carries its changes to the parts that show them. */
  const [viewedTick, setViewedTick] = createSignal(0);
  const unsubscribe = viewed.subscribe(() => setViewedTick((v) => v + 1));
  const scores = opts.scores ?? sessionScoreStore();
  const [scoreTick, setScoreTick] = createSignal(0);
  const unsubscribeScores = scores.subscribe(() => setScoreTick((v) => v + 1));
  const comments = opts.comments ?? sessionCommentStore();
  const [commentTick, setCommentTick] = createSignal(0);
  const unsubscribeComments = comments.subscribe(() =>
    setCommentTick((v) => v + 1),
  );
  // A store kept outside the view (GitHub's pending review) may have moved in another tab while this one was away.
  const refreshComments = () => {
    if (root.ownerDocument.visibilityState === "hidden") return;
    comments
      .refresh()
      .catch((error: unknown) =>
        console.error("hihyou: could not refresh the comments", error),
      );
  };
  const win = root.ownerDocument.defaultView;
  win?.addEventListener("focus", refreshComments);
  root.ownerDocument.addEventListener("visibilitychange", refreshComments);
  /** The comment being written, kept across redraws, which rebuild its row; with `thread`, a reply drawn in it. */
  let draft:
    | {
        anchor: AnchorData;
        thread?: string;
        /** The anchored node's score when the box opened, posted with the comment as its verdict. */
        score?: Score;
        text: string;
        sending?: boolean;
        error?: string;
      }
    | undefined;
  const outline = createMemo(() => atomIndex(files()));

  let shownPath: string | undefined;
  const opened = new Set<string>();
  let fragmentRows = new Map<string, HTMLTableRowElement[]>();
  let focusables = new Map<string, HTMLElement>();
  const focusIds = new WeakMap<Element, string>();
  const placer = createPlacer(files);
  const painter = createPainter(doc, placer);
  const pairs = createPairs({ files, viewed, keyOf, isViewed, viewedTick });

  const fileKey = (file: DiffFile) =>
    keyOf({
      kind: "file",
      path: file.path,
      before: file.change?.before ?? null,
      after: file.change?.after ?? null,
    });

  /** Opens and shows the file at `i`, redrawing when either changes what is drawn. */
  const reveal = (i: number) => {
    const file = files()[i];
    if (!file) return;
    let changed = false;
    if (file.collapsed && !opened.has(file.path)) {
      opened.add(file.path);
      changed = true;
    }
    if (single && file.path !== shownPath) {
      shownPath = file.path;
      changed = true;
      opts.onShow?.(file.path);
    }
    if (changed) redraw();
  };

  const jump = (to: SideRef) => {
    reveal(to.file);
    const current = files();
    const all = fragmentRows.get(`${to.file}:${to.fragment}`);
    // A table holds both sides of the fragment; only the target side's lines are the target.
    const own = all?.filter((r) => r.dataset["side"] === to.side);
    const sided = own?.length ? own : all;
    // A move that holds only some of its side's lines is the target alone.
    const move = moveAt(current, to);
    const inMove = sided?.filter((r) => {
      const line = Number(r.dataset[to.side]);
      return move !== undefined && move.first <= line && line <= move.last;
    });
    const rows = inMove?.length ? inMove : sided;
    const first = rows?.[0];
    if (!rows || !first) return;
    first.scrollIntoView({ block: "center" });
    first.tabIndex = -1;
    first.focus({ preventScroll: true });
    flash(rows, move !== undefined);
  };

  /** Shows the file at `path`, for a cross-file move whose other half was not found in it. */
  const openFile = (path: string) => {
    const file = files().find((f) => f.path === path);
    if (!file) return;
    if (file.collapsed) opened.add(path);
    if (single && path !== shownPath) {
      shownPath = path;
      opts.onShow?.(path);
    }
    redraw();
    for (const s of root.querySelectorAll<HTMLElement>(".hh-scroll"))
      if (s.dataset["path"] === path) s.closest(".hh-file")?.scrollIntoView();
  };

  const ctx: DrawContext = {
    doc,
    files,
    theme,
    placer,
    pairs,
    actions: new WeakMap(),
    pairOfElement: new WeakMap<Element, PairView>(),
    focusable(e, id) {
      focusables.set(id, e);
      focusIds.set(e, id);
    },
    remember(index, fragment, tr) {
      const key = `${index}:${fragment}`;
      const list = fragmentRows.get(key) ?? [];
      list.push(tr);
      fragmentRows.set(key, list);
    },
    jump,
    openFile,
    isOpened: (path) => opened.has(path),
    open(path) {
      opened.add(path);
      redraw();
    },
    /** A file with an outline is viewed when all its atoms are; one without keeps the `file` subject. */
    fileViewed(i, file) {
      viewedTick();
      return (
        viewedOf(outline(), { kind: "file", file: i }, isViewed) ??
        viewed.get(fileKey(file))
      );
    },
    setFileViewed(i, file, on) {
      const index = outline();
      if ((index.fileAtoms[i]?.length ?? 0) > 0)
        setViewed(index, { kind: "file", file: i }, on, viewed, keyOf);
      else viewed.set(fileKey(file), on);
    },
    viewState(t) {
      viewedTick();
      return viewState(outline(), t, isViewed);
    },
    select(t) {
      if (!modal) return;
      clicking = true;
      modal.set({
        ...modal.state(),
        mode: "normal",
        selections: [t],
        primary: 0,
      });
      clicking = false;
    },
    onExpand: opts.onExpand,
    onCollapse: opts.onCollapse,
  };

  const keys = modalRoot(root);
  let modal: ModalBinding | undefined;
  /** Set while a click places the selection, which is already where the reviewer is looking. */
  let clicking = false;
  const [hasSelection, setHasSelection] = createSignal(false);
  const [keyInfo, setKeyInfo] = createSignal(false);
  const [pending, setPending] = createSignal<"s">();
  const [primary, setPrimary] = createSignal<NodeRef>();
  const primaryScore = () => {
    scoreTick();
    const p = primary();
    return p ? nodeScore(outline(), scores, keyOf)(p) : null;
  };
  const pendingComments = () => {
    commentTick();
    return comments.all().filter((n) => n.pending).length;
  };
  const reviewing = () => {
    commentTick();
    return comments.reviewing();
  };
  const [submitError, setSubmitError] = createSignal<string>();
  let submitting = false;
  const submitReview = () => {
    if (submitting || !comments.reviewing()) return;
    submitting = true;
    setSubmitError(undefined);
    comments.submitReview(reviewEvent(approval())).then(
      () => (submitting = false),
      (error: unknown) => {
        submitting = false;
        setSubmitError(error instanceof Error ? error.message : String(error));
        console.error("hihyou: could not submit the review", error);
      },
    );
  };
  const approval = createMemo(() => {
    scoreTick();
    viewedTick();
    const index = outline();
    return approvalOf(index, nodeScore(index, scores, keyOf), isViewed);
  });
  /** Mirrors the modal state into the signals the toolbar and the info box read. */
  const showModal = (s: ModalState) => {
    setHasSelection(s.selections.length > 0);
    setPending(s.pending);
    const p = s.selections[s.primary];
    setPrimary(p?.kind === "node" ? p : undefined);
  };
  /** A toolbar button runs its key with focus on the root, where the modal editor reads keys. */
  const press = (key: string) => {
    root.focus({ preventScroll: true });
    modal?.press(key);
  };
  /** A node's drawn text, or only the characters `chars` narrows it to. */
  const narrowedRanges = (
    index: AtomIndex,
    ref: NodeRef,
    chars?: CharRange,
  ) => {
    const tree = treeOf(index, ref);
    const text = chars && tree && nodeText(tree, ref.node);
    if (!chars || !tree || text === undefined)
      return painter.nodeRanges(index, ref);
    const shown = displayRange(text, chars);
    return painter.textRanges(
      ref,
      linePos(tree, ref.node, shown.start),
      linePos(tree, ref.node, shown.end),
    );
  };
  const paintSelection = () => {
    const { selections, primary, chars } = modal?.state() ?? emptyModal;
    const index = outline();
    painter.set(
      "hh-selection",
      selections
        .filter((_, i) => i !== primary)
        .flatMap((t) => painter.targetRanges(index, t)),
    );
    const p = selections[primary];
    painter.set(
      "hh-selection-primary",
      p?.kind === "node"
        ? narrowedRanges(index, p, chars)
        : p
          ? painter.targetRanges(index, p)
          : [],
    );
  };
  /** Every drawn occurrence of a viewed atom, so a move's counterpart dims in its own file too. */
  const paint = () => {
    const index = outline();
    painter.set(
      "hh-viewed",
      index.atoms
        .filter((a) => isViewed(a.id))
        .flatMap((a) =>
          a.occurrences.flatMap((o) => painter.nodeRanges(index, o)),
        ),
    );
    paintScores();
    paintComments();
    paintSelection();
  };
  /** Each comment's anchored text, highlighted, and a row under its last line holding the comment or the draft. */
  const paintComments = () => {
    const index = outline();
    for (const r of root.querySelectorAll(".hh-comment-row, .hh-comment-file"))
      r.remove();
    const all: Range[] = [];
    const lastRow = new Map<Element, Element>();
    /** A thread no drawn node holds (on the file, or on lines the diff no longer has), listed under its file's header. */
    const listed = (path: string, cell: (el: HTMLElement) => void) => {
      const scroll = [...root.querySelectorAll<HTMLElement>(".hh-scroll")].find(
        (s) => s.dataset["path"] === path,
      );
      if (!scroll) return;
      const el = doc.createElement("div");
      el.className = "hh-comment-file";
      cell(el);
      scroll.before(el);
    };
    const place = (anchor: AnchorData, cell: (td: HTMLElement) => void) => {
      const ref = refOf(index, anchor);
      const tree = ref && treeOf(index, ref);
      const text = ref && tree && nodeText(tree, ref.node);
      if (!ref || text === undefined) return;
      const shown = anchor.chars && displayRange(text, anchor.chars);
      const ranges = narrowedRanges(index, ref, anchor.chars);
      all.push(...ranges);
      const tr = ranges.at(-1)?.endContainer.parentElement?.closest("tr");
      if (!tr) return;
      const row = doc.createElement("tr");
      row.className = "hh-comment-row";
      const td = doc.createElement("td");
      td.colSpan = [...tr.children].reduce(
        (n, c) => n + ((c as HTMLTableCellElement).colSpan || 1),
        0,
      );
      const quote = doc.createElement("div");
      quote.className = "hh-comment-quote";
      quote.textContent = shown
        ? text.slice(shown.start, shown.end)
        : (text.split("\n")[0] ?? "");
      td.append(quote);
      cell(td);
      row.append(td);
      (lastRow.get(tr) ?? tr).after(row);
      lastRow.set(tr, row);
    };
    /** A note's "Pending" label and dashed edge. */
    const pendingMark = (el: HTMLElement) => {
      el.classList.add("hh-comment-pending");
      const label = doc.createElement("span");
      label.className = "hh-comment-label";
      label.textContent = "Pending";
      el.prepend(label);
    };
    const bodyOf = (text: string, author?: string) => {
      const body = doc.createElement("p");
      body.className = "hh-comment-body";
      if (author !== undefined) {
        const by = doc.createElement("span");
        by.className = "hh-comment-author";
        by.textContent = author;
        body.append(by, " ");
      }
      body.append(text);
      return body;
    };
    /** The draft's text box and its send buttons, appended to `el`. */
    const editor = (el: HTMLElement, d: NonNullable<typeof draft>) => {
      const reviewing = comments.reviewing();
      const what = d.thread === undefined ? "comment" : "reply";
      const area = doc.createElement("textarea");
      area.value = d.text;
      area.setAttribute("aria-label", what === "comment" ? "Comment" : "Reply");
      area.addEventListener("input", () => (d.text = area.value));
      const cancel = () => {
        draft = undefined;
        paintComments();
        root.focus({ preventScroll: true });
      };
      /** Sends the draft as a single comment or reply, or into the review; a failure keeps it, with the host's error. */
      const send = (how: "single" | "review") => {
        if (d.text.trim() === "" || d.sending) return;
        d.sending = true;
        delete d.error;
        const sent =
          d.thread === undefined
            ? comments[how === "single" ? "comment" : "review"](
                d.anchor,
                d.text,
                d.score,
              )
            : comments[how === "single" ? "reply" : "reviewReply"](
                d.thread,
                d.text,
              );
        sent.then(
          () => {
            if (draft === d) draft = undefined;
            paintComments();
            root.focus({ preventScroll: true });
          },
          (error: unknown) => {
            d.sending = false;
            d.error = error instanceof Error ? error.message : String(error);
            console.error(`hihyou: could not save a ${how} ${what}`, error);
            paintComments();
          },
        );
      };
      area.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          send(reviewing || e.shiftKey ? "review" : "single");
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      });
      const button = (label: string, key: string, action: () => void) => {
        const b = doc.createElement("button");
        b.type = "button";
        b.className = "hh-tool";
        b.textContent = `${label} `;
        const kbd = doc.createElement("kbd");
        kbd.textContent = key;
        b.append(kbd);
        b.title = `${label} (${key})`;
        b.addEventListener("click", action);
        return b;
      };
      // GitHub's review UI: once a review is started, a comment or a reply can only join it.
      el.append(
        area,
        ...(reviewing
          ? [button("Add review comment", "Ctrl+Enter", () => send("review"))]
          : [
              button(`Add single ${what}`, "Ctrl+Enter", () => send("single")),
              button("Start a review", "Ctrl+Shift+Enter", () =>
                send("review"),
              ),
            ]),
        button("Cancel", "Escape", cancel),
      );
      if (d.error !== undefined) {
        const error = doc.createElement("p");
        error.className = "hh-comment-error";
        error.setAttribute("role", "alert");
        error.textContent = d.error;
        el.append(error);
      }
    };
    const notes = comments.all();
    // A thread's replies, and a reply being written, are drawn in its row under the note that began it.
    for (const note of notes) {
      if (note.thread !== undefined) continue;
      const cell = (td: HTMLElement) => {
        if (note.pending) pendingMark(td);
        td.append(bodyOf(note.body, note.author));
        for (const r of notes) {
          if (r.thread !== note.id) continue;
          const reply = doc.createElement("div");
          reply.className = "hh-comment-reply";
          reply.append(bodyOf(r.body, r.author));
          if (r.pending) pendingMark(reply);
          td.append(reply);
        }
        if (draft?.thread === note.id) {
          const box = doc.createElement("div");
          box.className = "hh-comment-draft";
          editor(box, draft);
          td.append(box);
        }
      };
      if (refOf(index, note.anchor)) place(note.anchor, cell);
      else listed(note.anchor.path, cell);
    }
    if (draft && draft.thread === undefined) {
      const d = draft;
      place(d.anchor, (td) => {
        td.parentElement?.classList.add("hh-comment-draft");
        td.classList.add("hh-comment-draft");
        editor(td, d);
      });
    }
    painter.set("hh-comment", all);
  };
  /** Each scored node is underlined (solid for plus, wavy for minus) and badged with its signed score. */
  const paintScores = () => {
    const index = outline();
    const scoreOf = nodeScore(index, scores, keyOf);
    const plus: Range[] = [];
    const minus: Range[] = [];
    for (const b of root.querySelectorAll(".hh-score-badge")) b.remove();
    index.hunks.flat().forEach((h) => {
      for (const side of ["before", "after"] as const)
        h[side].nodes.forEach((_, node) => {
          const ref = { file: h.file, fragment: h.fragment, side, node };
          const score = scoreOf(ref);
          if (score === null) return;
          const ranges = painter.nodeRanges(index, ref);
          (score > 0 ? plus : minus).push(...ranges);
          const first = ranges[0];
          const scroll =
            first?.startContainer.parentElement?.closest<HTMLElement>(
              ".hh-scroll",
            );
          if (!first || !scroll) return;
          const at = first.getBoundingClientRect();
          const origin = scroll.getBoundingClientRect();
          const badge = doc.createElement("span");
          badge.className = `hh-score-badge hh-score-${score > 0 ? "plus" : "minus"}`;
          badge.textContent = scoreText(score);
          Object.assign(badge.style, {
            top: `${at.top - origin.top + scroll.scrollTop}px`,
            left: `${at.right - origin.left + scroll.scrollLeft + 4}px`,
          });
          scroll.append(badge);
        });
    });
    painter.set("hh-score-plus", plus);
    painter.set("hh-score-minus", minus);
  };
  const scrollToPrimary = () => {
    const s = modal?.state();
    const p = s?.selections[s.primary];
    const first = p && painter.targetRanges(outline(), p)[0];
    first?.startContainer.parentElement?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  };

  const onEffect = (effect: ModalEffect) => {
    const current = files();
    switch (effect.kind) {
      case "expandMove": {
        const { at } = effect;
        const f = current[at.file]?.fragments[at.fragment];
        const n = treeOf(outline(), at)?.nodes[at.node];
        if (f?.kind !== "diff" || !n) return;
        const side = f[at.side];
        const line = side.startLine + n.start.line;
        const move = side.moves?.find((m) => m.first <= line && line <= m.last);
        const view = move && pairs.of(at.file, at.fragment, at.side, move);
        if (!view) return;
        if (view.pair.crossFile) return pairs.toggle(view);
        const other = at.side === "before" ? view.pair.after : view.pair.before;
        if (other) jump(other.ref);
        return;
      }
      case "expandElided": {
        const file = current[effect.file];
        const gap = file && gapOf(file, effect.fragment);
        if (!opts.onExpand || !file || !gap || gap.count === 0) return;
        const s = modal?.state();
        const p = s?.selections[s.primary];
        const above =
          p !== undefined && p.kind !== "file" && effect.fragment < p.fragment;
        const direction: ExpandDirection =
          gap.count !== undefined && gap.count <= expandStep
            ? "all"
            : gap.atEnd
              ? "down"
              : gap.atStart || above
                ? "up"
                : "down";
        opts.onExpand(
          file.path,
          { fragment: effect.fragment, lines: gap.origin },
          direction,
        );
        return;
      }
      case "jump":
        reveal(effect.to.file);
        paint();
        scrollToPrimary();
        return;
      case "help":
        setKeyInfo((open) => !open);
        return;
      case "submitReview":
        submitReview();
        return;
      case "comment": {
        const anchor = anchorOf(outline(), effect.at, effect.chars);
        if (!anchor) return;
        const score = nodeScore(outline(), scores, keyOf)(effect.at);
        draft = { anchor, text: "", ...(score !== null && { score }) };
        paintComments();
        root
          .querySelector<HTMLTextAreaElement>(".hh-comment-draft textarea")
          ?.focus();
        return;
      }
      case "reply": {
        const index = outline();
        const at = effect.at;
        const thread = comments.all().findLast((n) => {
          if (n.thread !== undefined) return false;
          const ref = refOf(index, n.anchor);
          if (!("node" in at))
            return !ref && index.files[at.file]?.path === n.anchor.path;
          return (
            ref &&
            ref.file === at.file &&
            ref.fragment === at.fragment &&
            ref.side === at.side &&
            ref.node === at.node
          );
        });
        if (!thread) return;
        draft = { anchor: thread.anchor, thread: thread.id, text: "" };
        paintComments();
        root
          .querySelector<HTMLTextAreaElement>(".hh-comment-draft textarea")
          ?.focus();
        return;
      }
    }
  };

  /** Each file's scroll position and the focused control, read off the old rows before a redraw replaces them. */
  let kept: { scrolls: Map<string, [number, number]>; focused?: string } = {
    scrolls: new Map(),
  };
  const DiffList = () => {
    // Placement is a side effect of drawing the rows in order, so every change of structure redraws the whole
    // list at once; viewed state and the selection change in place.
    const list = createMemo(() => {
      const current = files();
      theme();
      pairs.expanded();
      version();
      return untrack(() => {
        const active = keys.ownerDocument.activeElement;
        const focused =
          active && root.contains(active) ? focusIds.get(active) : undefined;
        const scrolls = new Map<string, [number, number]>();
        for (const s of root.querySelectorAll<HTMLElement>(".hh-scroll")) {
          const path = s.dataset["path"];
          if (path !== undefined)
            scrolls.set(path, [s.scrollTop, s.scrollLeft]);
        }
        kept = focused === undefined ? { scrolls } : { scrolls, focused };
        focusables = new Map();
        fragmentRows = new Map();
        placer.reset();
        pairs.reset();
        if (single && !current.some((f) => f.path === shownPath))
          shownPath = current[0]?.path;
        return current.flatMap((file, index) =>
          single && file.path !== shownPath
            ? []
            : [<FileSection index={index} file={file} />],
        );
      });
    });
    createEffect(
      on(list, () => {
        for (const s of root.querySelectorAll<HTMLElement>(".hh-scroll")) {
          const saved = kept.scrolls.get(s.dataset["path"] ?? "");
          if (saved) [s.scrollTop, s.scrollLeft] = saved;
        }
        if (kept.focused !== undefined)
          focusables.get(kept.focused)?.focus({ preventScroll: true });
      }),
    );
    createEffect(() => {
      list();
      viewedTick();
      scoreTick();
      commentTick();
      untrack(paint);
    });
    return (
      <div class="hh-diff">
        <div class="hh-bar">
          <ApprovalBadge approval={approval} />
          <KeyToolbar shown={hasSelection} press={press} score={primaryScore} />
          <SubmitReview
            reviewing={reviewing}
            pending={pendingComments}
            event={() => reviewEvent(approval())}
            error={submitError}
            press={press}
          />
        </div>
        {list()}
        <KeyInfo open={keyInfo} pending={pending} />
      </div>
    );
  };

  const placedAt = (node: Node, offset: number) => {
    const at = node instanceof Text ? placer.placeOf(node) : undefined;
    return at && { ...at, column: at.column + offset };
  };
  const onClick = (e: MouseEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    // A button acts through its own handler.
    if (target?.closest("button")) return;
    // A click that ends a text selection is selecting, not expanding. Shift+click adds a review selection, so the
    // text range the browser extended for it is dropped.
    const text = doc.getSelection();
    if (e.shiftKey && text?.rangeCount) text.collapseToEnd();
    const selecting = !(doc.getSelection()?.isCollapsed ?? true);
    if (!target?.closest(controls)) root.focus({ preventScroll: true });
    // Read the point before an action redraws the rows it is in.
    const at =
      !selecting && modal ? pointAt(root, placer, e, target) : undefined;
    if (at && modal) {
      clicking = true;
      modal.set((e.shiftKey ? addAt : selectAt)(modal.state(), outline(), at));
      clicking = false;
    }
    // Text selected inside one node narrows the review selection to it, for a comment on those characters.
    const range =
      selecting && text?.rangeCount ? text.getRangeAt(0) : undefined;
    const from = range && placedAt(range.startContainer, range.startOffset);
    const to = range && placedAt(range.endContainer, range.endOffset);
    if (from && to && modal) {
      clicking = true;
      modal.set(narrowAt(modal.state(), outline(), from, to));
      clicking = false;
    }
    // Code text selects; the rest of a cross-file move's block (its gutter) still expands it, which views it.
    const block = target?.closest(".hh-pair-toggle");
    if (block && !selecting && !at) ctx.actions.get(block)?.();
  };
  /**
   * Escape folds the expanded pair that holds the focus, and hands focus back to its label. It is added ahead of
   * the modal editor, which leaves a key this handled alone, so Escape reaches the modal editor only when no
   * expansion holds the focus.
   */
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    let node = e.target instanceof Element ? e.target : null;
    let view: PairView | undefined;
    while (node && node !== root && !view) {
      view = ctx.pairOfElement.get(node);
      node = node.parentElement;
    }
    if (!view || !pairs.isExpanded(view.id)) {
      // Next, Escape closes the key info box, as Kakoune's does.
      if (!untrack(keyInfo)) return;
      e.preventDefault();
      setKeyInfo(false);
      return;
    }
    e.preventDefault();
    pairs.collapse(view);
    focusables.get(`toggle\n${view.id}`)?.focus({ preventScroll: true });
  };
  // Ahead of the modal editor's listener, so Escape folds a pair before the modal editor sees it.
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKey);
  // The modal editor rebinds to each new outline, keeping its selection.
  createComputed(() => {
    const index = outline();
    untrack(() => {
      const state = modal?.state() ?? emptyModal;
      modal?.dispose();
      modal = bindModal(keys, {
        index,
        viewed,
        scores,
        keyOf,
        initial: state,
        onChange: (s) => {
          showModal(s);
          paintSelection();
          if (!clicking) scrollToPrimary();
        },
        onEffect,
      });
      showModal(state);
    });
  });

  const ownTabIndex = !root.hasAttribute("tabindex");
  if (ownTabIndex) root.tabIndex = 0;
  root.classList.add("hh-review");
  root.replaceChildren();
  insert(root, () => (
    <Draw.Provider value={ctx}>
      <DiffList />
    </Draw.Provider>
  ));

  return {
    update: (next) => setFiles(next),
    setTheme: (next) => setTheme(next && compileTheme(next)),
    show(path) {
      if (!single || path === shownPath) return;
      shownPath = path;
      redraw();
      root.querySelector(".hh-scroll")?.scrollTo(0, 0);
    },
    shown: () => (single ? shownPath : undefined),
    dispose() {
      unsubscribe();
      unsubscribeScores();
      unsubscribeComments();
      win?.removeEventListener("focus", refreshComments);
      root.ownerDocument.removeEventListener(
        "visibilitychange",
        refreshComments,
      );
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKey);
      modal?.dispose();
      disposeRoot();
      painter.clear();
      root.classList.remove("hh-review");
      if (ownTabIndex) root.removeAttribute("tabindex");
      root.replaceChildren();
    },
  };
}
