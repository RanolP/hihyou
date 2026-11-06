import { type AnchorData, compileTheme, type Theme } from "@hihyou/engine";
import {
  createComputed,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  on,
  onCleanup,
  untrack,
} from "solid-js";
import { insert, Portal } from "solid-js/web";
import {
  type AtomIndex,
  atomIndex,
  atomViewed,
  type NodeRef,
  nodeScore,
  readParts,
  setViewed,
  treeOf,
  viewedOf,
} from "./atoms.js";
import {
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
import { isTestPath } from "./test-files.js";
import { Draw, type DrawContext } from "./view/context.js";
import { FileSection } from "./view/file.jsx";
import { flash } from "./view/flash.js";
import { createPainter } from "./view/highlights.js";
import { ApprovalBadge } from "./view/approval.jsx";
import {
  type HostKey,
  KeyPanel,
  scoreText,
  SubmitReview,
} from "./view/keys.jsx";
import { controls, modalRoot } from "./view/modal-root.js";
import { createPairs, type PairView } from "./view/pair.jsx";
import { createPlacer } from "./view/placement.js";
import { pointAt } from "./view/pointer.js";
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
  /** Draw one file at a time. Defaults to whether `onShow` is present. */
  single?: boolean;
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
  /** Called when grouped test files are shown or hidden. */
  onTestsShown?(shown: boolean): void;
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
  /**
   * Where the always-shown key panel goes (the browser's sidebar, under the file tree). Without one it runs along
   * the bottom of the diff.
   */
  keysMount?: HTMLElement;
  /** Keys the host binds itself, listed in the key panel with the renderer's own. */
  hostKeys?: readonly HostKey[];
}

export interface DiffsetView {
  /** Redraws with new files, keeping which collapsed files are open and each file's scroll position. */
  update(files: readonly DiffFile[]): void;
  /** Redraws with another theme, as `update` keeps state. */
  setTheme(theme: Theme | undefined): void;
  /** Switches between drawing one file and drawing every file. */
  setSingle(single: boolean): void;
  /** Draws only the file at `path`, or scrolls to it when every file is drawn. */
  show(path: string): void;
  /** The last file passed to `show`, or selected by a cross-file move. */
  shown(): string | undefined;
  /** Whether every reviewable edit in the file at `path` has been viewed. */
  fileViewed(path: string): boolean | undefined;
  dispose(): void;
}

const keysCollapsedKey = "hihyou.keys.collapsed";
/**
 * The panel opens folded to its one-line header until the reviewer opens it. Storage can be blocked (a sandboxed
 * webview, site data off); the panel then opens folded each time.
 */
function storedKeysCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(keysCollapsedKey) !== "0";
  } catch {
    return true;
  }
}
function storeKeysCollapsed(collapsed: boolean) {
  try {
    globalThis.localStorage?.setItem(keysCollapsedKey, collapsed ? "1" : "0");
  } catch {
    // Not remembered; the choice holds for this page.
  }
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
  let single = opts.single ?? opts.onShow !== undefined;
  const viewed = opts.viewed ?? sessionViewedStore();
  const keyOf = opts.keyOf ?? plainKeyOf;
  const isViewed = atomViewed(viewed, keyOf);

  const [files, setFiles] = createSignal(initial);
  const [testsShown, setTestsShown] = createSignal(false);
  createEffect(() => opts.onTestsShown?.(testsShown()));
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
  /** A file the reader folded (true) or unfolded (false) by hand, over what its reason or Viewed implies. */
  const folded = new Map<string, boolean>();
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

  /** A file with an outline is viewed when all its atoms are; one without keeps the `file` subject. */
  const fileViewed = (i: number, file: DiffFile) => {
    viewedTick();
    return (
      viewedOf(outline(), { kind: "file", file: i }, isViewed) ??
      viewed.get(fileKey(file))
    );
  };

  /** Collapsed and viewed are separate: Viewed or a collapse reason only folds a file the reader has not set. */
  const fileCollapsed = (i: number, file: DiffFile) =>
    folded.get(file.path) ??
    (file.collapsed !== undefined || fileViewed(i, file));

  /** Opens and shows the file at `i`, redrawing when either changes what is drawn. */
  const reveal = (i: number) => {
    const file = files()[i];
    if (!file) return;
    if (!single && isTestPath(file.path)) setTestsShown(true);
    let changed = false;
    if (fileCollapsed(i, file)) {
      folded.set(file.path, false);
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
    if (!single && isTestPath(path)) setTestsShown(true);
    folded.set(path, false);
    if (single && path !== shownPath) shownPath = path;
    redraw();
    for (const s of root.querySelectorAll<HTMLElement>(".hh-scroll"))
      if (s.dataset["path"] === path) s.closest(".hh-file")?.scrollIntoView();
    opts.onShow?.(path);
  };

  const fileSection = (path: string) =>
    [...root.querySelectorAll<HTMLElement>(".hh-file")].find(
      (section) => section.dataset["path"] === path,
    );

  /**
   * Runs `change`, which folds or unfolds the file at `path`, then scrolls so what the reader was looking at stays
   * put: the file's header when it is on screen, else the files below when this one lies above the viewport (the
   * page turns off the browser's own scroll anchoring).
   */
  // Room below the last file, grown when a scroll would otherwise stop at the page end (a folded file near the end, a
  // last file brought to the top) and dropped once it is out of sight below the viewport.
  let tail = 0;
  const setTail = (px: number) => {
    tail = Math.max(0, px);
    root.style.paddingBottom = tail > 0 ? `${tail}px` : "";
  };
  const scrollWithRoom = (dy: number) => {
    if (win == null) return;
    const page = root.ownerDocument.documentElement;
    const short = win.scrollY + dy - (page.scrollHeight - win.innerHeight);
    if (short > 0) setTail(tail + Math.ceil(short));
    // A host page may set `scroll-behavior: smooth` (GitHub does), which would animate a correction.
    win.scrollBy({ top: dy, behavior: "instant" });
  };
  const dropTail = () => {
    if (tail > 0 && win != null && root.getBoundingClientRect().bottom - tail >= win.innerHeight)
      setTail(0);
  };
  win?.addEventListener("scroll", dropTail, { passive: true });

  const keepInPlace = (path: string, change: () => void) => {
    const header = () =>
      fileSection(path)?.querySelector<HTMLElement>(".hh-file-header");
    const h = header()?.getBoundingClientRect();
    const s = fileSection(path)?.getBoundingClientRect();
    const onScreen =
      win != null && h !== undefined && h.bottom > 0 && h.top < win.innerHeight;
    const above = !onScreen && s !== undefined && s.top < 0;
    const before = onScreen ? h.top : above ? s.bottom : undefined;
    // Folding near the page end shortens the page under the reader, and the browser pulls the scroll back with it.
    const y = win?.scrollY ?? 0;
    change();
    if (before === undefined || win == null) return;
    win.requestAnimationFrame(() => {
      const clamped = y - win.scrollY;
      if (clamped > 0) {
        setTail(tail + clamped);
        win.scrollTo({ top: y, behavior: "instant" });
      }
      const now = onScreen
        ? header()?.getBoundingClientRect().top
        : fileSection(path)?.getBoundingClientRect().bottom;
      if (now !== undefined && now !== before) scrollWithRoom(now - before);
    });
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
    fileCollapsed,
    setFileCollapsed(path, on) {
      keepInPlace(path, () => {
        folded.set(path, on);
        redraw();
      });
    },
    fileViewed,
    setFileViewed(i, file, on) {
      keepInPlace(file.path, () => {
        // Ticking Viewed folds the file and unticking unfolds it; the chevron can still open or close it after.
        if (on) folded.delete(file.path);
        else folded.set(file.path, false);
        const index = outline();
        if ((index.fileAtoms[i]?.length ?? 0) > 0)
          setViewed(index, { kind: "file", file: i }, on, viewed, keyOf);
        else viewed.set(fileKey(file), on);
      });
    },
    onExpand: opts.onExpand,
    onCollapse: opts.onCollapse,
  };

  const keys = modalRoot(root);
  let modal: ModalBinding | undefined;
  /** Set while a click places the selection, which is already where the reviewer is looking. */
  let clicking = false;
  const [hasSelection, setHasSelection] = createSignal(false);
  const [keysCollapsed, setKeysCollapsed] = createSignal(storedKeysCollapsed());
  const toggleKeys = () => {
    const collapsed = !keysCollapsed();
    setKeysCollapsed(collapsed);
    storeKeysCollapsed(collapsed);
  };
  const [pending, setPending] = createSignal<"s">();
  const [selected, setSelected] = createSignal<NodeRef>();
  const selectedScore = () => {
    scoreTick();
    const p = selected();
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
    setHasSelection(s.selection !== undefined);
    setPending(s.pending);
    const p = s.selection;
    setSelected(p?.kind === "node" ? p : undefined);
  };
  /** A toolbar button runs its key with focus on the root, where the modal editor reads keys. */
  const press = (key: string) => {
    root.focus({ preventScroll: true });
    modal?.press(key);
  };
  const keyPanel = (placement?: "inline") => (
    <KeyPanel
      {...(placement && { placement })}
      collapsed={keysCollapsed}
      toggle={toggleKeys}
      hasSelection={hasSelection}
      reviewing={reviewing}
      pending={pending}
      score={selectedScore}
      press={press}
      hostKeys={opts.hostKeys ?? []}
    />
  );
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
    const { selection: p, chars } = modal?.state() ?? emptyModal;
    const index = outline();
    painter.set(
      "hh-selection",
      p?.kind === "node"
        ? narrowedRanges(index, p, chars)
        : p
          ? painter.targetRanges(index, p)
          : [],
    );
  };
  /**
   * Every drawn occurrence of a viewed atom, so a move's counterpart dims in its own file too, and every node and
   * changed line `readParts` finds read, so `v` on a node greys all of it, not only the atoms inside.
   */
  const paint = () => {
    const index = outline();
    const read = readParts(index, isViewed);
    painter.set("hh-viewed", [
      ...index.atoms
        .filter((a) => isViewed(a.id))
        .flatMap((a) =>
          a.occurrences.flatMap((o) => painter.nodeRanges(index, o)),
        ),
      ...read.nodes.flatMap((r) => painter.nodeRanges(index, r)),
      ...read.rows.flatMap((r) =>
        painter.textRanges(
          r,
          { line: r.line, column: 0 },
          { line: r.line, column: Number.POSITIVE_INFINITY },
        ),
      ),
    ]);
    // A row drops its line colour once a line drawn in it is read and none is unread.
    const rowRead = new Map<Element, boolean>();
    for (const l of read.lines)
      for (const tr of painter.lineRows(l, l.line))
        rowRead.set(tr, (rowRead.get(tr) ?? true) && l.read);
    for (const tr of root.querySelectorAll("tr.hh-read"))
      if (!rowRead.get(tr)) tr.classList.remove("hh-read");
    for (const [tr, r] of rowRead) tr.classList.toggle("hh-read", r);
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
  const scrollToSelection = () => {
    const p = modal?.state().selection;
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
        const p = modal?.state().selection;
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
        scrollToSelection();
        return;
      case "help":
        toggleKeys();
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
    const measureReviewBar = (bar: HTMLElement) => {
      const observer = new ResizeObserver(() => {
        bar.parentElement?.style.setProperty(
          "--hh-review-bar-height",
          `${bar.getBoundingClientRect().height}px`,
        );
      });
      observer.observe(bar);
      onCleanup(() => observer.disconnect());
    };
    // Placement is a side effect of drawing the rows in order, so every change of structure redraws the whole
    // list at once; viewed state and the selection change in place.
    const list = createMemo(() => {
      const current = files();
      const showTests = testsShown();
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
        const testCount = current.filter((file) =>
          isTestPath(file.path),
        ).length;
        const grouped = !single && testCount > 0 && testCount < current.length;
        const firstTest = current.findIndex((file) => isTestPath(file.path));
        return current.flatMap((file, index) => {
          if (single)
            return file.path === shownPath
              ? [<FileSection index={index} file={file} />]
              : [];
          if (!grouped || !isTestPath(file.path))
            return [<FileSection index={index} file={file} />];
          const group = index === firstTest
            ? [
                <div class="hh-test-group">
                  {testCount} test & fixture {testCount === 1 ? "file" : "files"}
                  {showTests ? "" : " hidden"} ·{" "}
                  <button
                    type="button"
                    class="hh-button"
                    aria-expanded={showTests}
                    onClick={(event) => {
                      const groupTop = event.currentTarget
                        .closest<HTMLElement>(".hh-test-group")
                        ?.getBoundingClientRect().top;
                      setTestsShown((shown) => !shown);
                      if (groupTop !== undefined)
                        win?.requestAnimationFrame(() => {
                          const newTop = root
                            .querySelector<HTMLElement>(".hh-test-group")
                            ?.getBoundingClientRect().top;
                          if (newTop !== undefined && newTop !== groupTop)
                            win.scrollBy(0, newTop - groupTop);
                        });
                    }}
                  >
                    {showTests ? "Hide tests & fixtures" : "Show tests & fixtures"}
                  </button>
                </div>,
              ]
            : [];
          return showTests
            ? [...group, <FileSection index={index} file={file} />]
            : group;
        });
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
        <div ref={measureReviewBar} class="hh-bar">
          <ApprovalBadge approval={approval} />
          <SubmitReview
            reviewing={reviewing}
            pending={pendingComments}
            event={() => reviewEvent(approval())}
            error={submitError}
            press={press}
          />
        </div>
        {list()}
        {opts.keysMount ? (
          <Portal mount={opts.keysMount}>{keyPanel()}</Portal>
        ) : (
          keyPanel("inline")
        )}
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
    // A click that ends a text selection is selecting, not expanding.
    const text = doc.getSelection();
    const selecting = !(text?.isCollapsed ?? true);
    if (!target?.closest(controls)) root.focus({ preventScroll: true });
    // Read the point before an action redraws the rows it is in.
    const at =
      !selecting && modal ? pointAt(root, placer, e, target) : undefined;
    if (at && modal) {
      clicking = true;
      modal.set(selectAt(modal.state(), outline(), at));
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
    if (!view || !pairs.isExpanded(view.id)) return;
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
          if (!clicking) scrollToSelection();
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
    setSingle(next) {
      if (next === single) return;
      single = next;
      redraw();
    },
    show(path) {
      if (!files().some((file) => file.path === path)) return;
      if (!single) {
        if (isTestPath(path)) setTestsShown(true);
        shownPath = path;
        const section = fileSection(path);
        if (!section) return;
        section.scrollIntoView({ block: "start" });
        // The last files cannot reach the top on their own; room below lets them land where every other file does.
        const margin = Number.parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
        const gap = section.getBoundingClientRect().top - margin;
        if (gap > 1) scrollWithRoom(gap);
        return;
      }
      if (path === shownPath) return;
      shownPath = path;
      redraw();
      root.querySelector(".hh-scroll")?.scrollTo(0, 0);
      const section = fileSection(path);
      if (section && section.getBoundingClientRect().top < 0)
        section.scrollIntoView({ block: "start" });
    },
    shown: () => shownPath,
    fileViewed: (path) => {
      const current = files();
      const index = current.findIndex((file) => file.path === path);
      const file = current[index];
      return file ? fileViewed(index, file) : undefined;
    },
    dispose() {
      unsubscribe();
      unsubscribeScores();
      unsubscribeComments();
      win?.removeEventListener("focus", refreshComments);
      win?.removeEventListener("scroll", dropTail);
      setTail(0);
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
