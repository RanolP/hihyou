// The visible tree, walked the way tree-sitter's tree_cursor.c walks it (aliases, hidden nodes, inherited
// fields), and appended to the typed-array arena.

import {
  FIXED,
  isFixed,
  MISSING,
  NAMED as NAMED_NODE,
  type Tree,
  TreeBuilder,
} from "./arena.js";
import { jsxText, LABEL_JSX_TEXT, labelModes } from "./label.js";
import {
  aliasAt,
  FLAG_NAMED,
  type Language,
  publicSymbol,
  SYM_ERROR,
  symbolFlags,
  symbolName,
} from "./language.js";
import type { StackNode } from "./stack.js";
import {
  CHILD_COUNT,
  CHILDREN,
  EXTRA,
  FLAGS,
  IS_MISSING,
  KIDS,
  MARK,
  NAMED,
  NONE,
  PADDING,
  PRODUCTION_ID,
  SIZE,
  type Subtree,
  type Subtrees,
  SYMBOL,
  VISIBLE,
} from "./subtree.js";

function fieldFor(
  lang: Language,
  productionId: number,
  structuralIndex: number,
): number {
  const start = lang.fieldSliceIndex[productionId] as number;
  const end = start + (lang.fieldSliceLength[productionId] as number);
  for (let i = start; i < end; i++) {
    if (
      lang.fieldEntryInherited[i] === 0 &&
      lang.fieldEntryChild[i] === structuralIndex
    )
      return lang.fieldEntryField[i] as number;
  }
  return 0;
}

/** What the walk needs of each symbol (aliases included), looked up once per language instead of per node. */
interface Symbols {
  kind: string[];
  /** For an alias: whether the alias is named; a node's own symbol reads its subtree's flag instead. */
  named: boolean[];
  label: Uint8Array;
  /**
   * For an anonymous token the grammar spells as a string, its name's length: unaliased, a node of that
   * width reads exactly its name. -1 where only the source can tell (external tokens, named symbols,
   * nonterminals, aliases).
   */
  fixedLength: Int32Array;
}

const symbolsOf = new WeakMap<Language, Symbols>();

function symbols(lang: Language): Symbols {
  let s = symbolsOf.get(lang);
  if (s) return s;
  const count = lang.symbolNames.length;
  s = {
    kind: [],
    named: [],
    label: labelModes(lang),
    fixedLength: new Int32Array(count).fill(-1),
  };
  const external = new Set(lang.externalSymbolMap);
  for (let symbol = 0; symbol < count; symbol++) {
    const kind = symbolName(lang, publicSymbol(lang, symbol));
    const named = (symbolFlags(lang, symbol) & FLAG_NAMED) !== 0;
    s.kind.push(kind);
    s.named.push(named);
    if (
      symbol > 0 &&
      symbol < lang.tokenCount &&
      !named &&
      !external.has(symbol)
    )
      s.fixedLength[symbol] = kind.length;
  }
  symbolsOf.set(lang, s);
  return s;
}

/**
 * Appends a visible node as it leaves: an inner node when records were appended since its `mark`, else a
 * leaf, which a node whose children are all hidden and childless also is, since it reads as one token.
 * Layout-only JSX text is dropped.
 */
function leave(
  b: TreeBuilder,
  lang: Language,
  sym: Symbols,
  source: string,
  w: Int32Array,
  tree: number,
  symbol: number,
  named: boolean,
  field: number,
  start: number,
  mark: number,
): void {
  const kind = publicSymbol(lang, symbol);
  const end = start + (w[tree + SIZE] as number);
  let flags =
    (named ? NAMED_NODE : 0) |
    (((w[tree + FLAGS] as number) & IS_MISSING) !== 0 ? MISSING : 0);
  if (mark !== b.mark()) {
    b.inner(kind, field, flags, start, end, mark);
    return;
  }
  if (
    sym.label[symbol] === LABEL_JSX_TEXT &&
    jsxText(source.slice(start, end)) === ""
  )
    return;
  if (flags === 0) {
    const length =
      symbol === w[tree + SYMBOL] ? (sym.fixedLength[symbol] ?? -1) : -1;
    if (
      length >= 0
        ? end - start === length
        : isFixed(lang, kind, source, start, end)
    )
      flags = FIXED;
  }
  b.leaf(kind, field, flags, start, end);
}

/**
 * The arena form of the visible tree under the parser's `root`: each visible node appended as it leaves, so
 * in postorder, less the layout-only JSX text. Reads the parser's records straight out of `subtrees.words`.
 */
export function buildTree(
  subtrees: Subtrees,
  root: Subtree,
  source: string,
): Tree {
  const lang = subtrees.lang;
  const w = subtrees.words;
  const sym = symbols(lang);
  const b = new TreeBuilder(lang, source);
  /** Characters ERROR nodes cover, nested ones counted once. */
  let errorChars = 0;
  /** Visible ERROR nodes open around the current one. */
  let errors = 0;

  // The frames of the walk as parallel arrays, `depth` deep. `hiddenField` is -1 for a visible frame; a
  // hidden one holds the field its visible descendants inherit when their own parent names none. The `open*`
  // arrays describe a visible frame's node, `openMark` being `b.mark()` when it entered.
  const trees: number[] = [root];
  const index: number[] = [0];
  const structural: number[] = [0];
  /** End of the previous child; the parent's start before the first. */
  const position: number[] = [w[root + PADDING] as number];
  const hiddenField: number[] = [-1];
  const openSymbol: number[] = [w[root + SYMBOL] as number];
  const openNamed: boolean[] = [((w[root + FLAGS] as number) & NAMED) !== 0];
  const openField: number[] = [0];
  const openStart: number[] = [w[root + PADDING] as number];
  const openMark: number[] = [b.mark()];
  if (w[root + SYMBOL] === SYM_ERROR) {
    errorChars += w[root + SIZE] as number;
    errors++;
  }
  let depth = 1;
  while (depth > 0) {
    const d = depth - 1;
    const tree = trees[d] as number;
    const i = index[d] as number;
    if (i === w[tree + CHILD_COUNT]) {
      depth = d;
      if (hiddenField[d] === -1) {
        const symbol = openSymbol[d] as number;
        if (symbol === SYM_ERROR) errors--;
        leave(
          b,
          lang,
          sym,
          source,
          w,
          tree,
          symbol,
          openNamed[d] as boolean,
          openField[d] as number,
          openStart[d] as number,
          openMark[d] as number,
        );
      }
      continue;
    }
    const child = w[tree + CHILDREN + i] as number;
    const childFlags = w[child + FLAGS] as number;
    const start =
      i === 0
        ? (position[d] as number)
        : (position[d] as number) + (w[child + PADDING] as number);
    position[d] = start + (w[child + SIZE] as number);
    index[d] = i + 1;
    let alias = 0;
    let field = 0;
    if ((childFlags & EXTRA) === 0) {
      const s = structural[d] as number;
      const productionId = w[tree + PRODUCTION_ID] as number;
      alias = aliasAt(lang, productionId, s);
      field = fieldFor(lang, productionId, s);
      if (field === 0) {
        const inherited = hiddenField[d] as number;
        if (inherited > 0) field = inherited;
      }
      structural[d] = s + 1;
    }
    const hasChildren = (w[child + CHILD_COUNT] as number) > 0;
    if ((childFlags & VISIBLE) !== 0 || alias !== 0) {
      const symbol = alias !== 0 ? alias : (w[child + SYMBOL] as number);
      const named =
        alias !== 0
          ? (sym.named[alias] as boolean)
          : (childFlags & NAMED) !== 0;
      const error = symbol === SYM_ERROR;
      if (error && errors === 0) errorChars += w[child + SIZE] as number;
      if (hasChildren) {
        if (error) errors++;
        trees[depth] = child;
        index[depth] = 0;
        structural[depth] = 0;
        position[depth] = start;
        hiddenField[depth] = -1;
        openSymbol[depth] = symbol;
        openNamed[depth] = named;
        openField[depth] = field;
        openStart[depth] = start;
        openMark[depth] = b.mark();
        depth++;
      } else
        leave(
          b,
          lang,
          sym,
          source,
          w,
          child,
          symbol,
          named,
          field,
          start,
          b.mark(),
        );
    } else if (hasChildren) {
      trees[depth] = child;
      index[depth] = 0;
      structural[depth] = 0;
      position[depth] = start;
      hiddenField[depth] = field;
      depth++;
    }
  }
  return b.finish(errorChars);
}

const DIRECT = 0;
const DEFERRED = 1;
const FAILED = 2;

/**
 * Builds `buildTree`'s tree while the parser runs, so an error-free parse skips the second walk. Postorder
 * puts a node's descendants right before it, so each subtree is appended when the parser makes it: a token
 * when shifted, a node when reduced, a hidden one not at all, its visible descendants staying on the
 * builder's stack of unparented nodes for the visible parent to take. `MARK`/`KIDS` in a subtree's record
 * say which entries of that stack are its. A subtree learns its alias and field only when its parent is
 * reduced, so the reduction patches them onto its children's entries, and a hidden child's field onto those
 * of its entries that have none (the inheritance `buildTree` does top-down).
 *
 * That holds while the parse is linear: one stack version, no stack node with two links. While GLR keeps
 * alternatives nothing is appended (DEFERRED); once one linear version is left, `sync` walks the subtrees it
 * pushed since into the builder `buildTree`'s way, taking the entries of subtrees appended before as they
 * are. Error recovery, a nonterminal extra, and a hidden child aliased where nodes after it are already
 * appended (its node would have to go before them) give up (FAILED): the caller runs `buildTree` instead.
 */
export class DirectTree {
  private readonly lang: Language;
  private readonly sym: Symbols;
  private readonly b: TreeBuilder;
  private mode = DIRECT;
  /** A sync met a stack node with two links; none can succeed until a pop that may remove it. */
  private blocked = false;
  /**
   * Extras shifted since the last token, as (subtree, start) pairs. A reduction leaves trailing extras out
   * of its node, which goes before them, so they are appended only when the next token is shifted.
   */
  private readonly pending: number[] = [];
  /** During a walk: the unparented nodes taken off the builder from index `qBase`, `qAt` of them put back. */
  private q: number[] = [];
  private qBase = 0;
  private qAt = 0;
  private tree: Tree | null = null;
  private accepted: Subtree = NONE;
  /** The records of extras, which a hidden ancestor's field never reaches. */
  private readonly extras = new Set<number>();

  constructor(
    private readonly subtrees: Subtrees,
    private readonly source: string,
  ) {
    this.lang = subtrees.lang;
    this.sym = symbols(this.lang);
    this.b = new TreeBuilder(this.lang, source);
  }

  fail(): void {
    this.mode = FAILED;
  }

  /** The parser popped through a fork or keeps more than one version. */
  defer(): void {
    if (this.mode === DIRECT) {
      this.mode = DEFERRED;
      this.pending.length = 0;
    }
    this.blocked = false;
  }

  /** Whether `sync` is worth trying once one version is left. */
  get deferred(): boolean {
    return this.mode === DEFERRED && !this.blocked;
  }

  /** Token `t` is pushed onto a stack whose content ends at `position`. */
  shift(t: Subtree, position: number, versionCount: number): void {
    if (this.mode !== DIRECT) return;
    if (versionCount > 1) {
      this.defer();
      return;
    }
    const w = this.subtrees.words;
    if ((w[t + CHILD_COUNT] as number) > 0 || w[t + SYMBOL] === SYM_ERROR) {
      this.fail();
      return;
    }
    const start = position + (w[t + PADDING] as number);
    if (((w[t + FLAGS] as number) & EXTRA) !== 0) {
      this.pending.push(t, start);
      return;
    }
    if (this.pending.length > 0) this.flush();
    this.emitLeaf(t, start);
  }

  /**
   * `parent` was made of `children` (trailing extras removed) popped linearly off the only version, whose
   * stack content now ends at `position`.
   */
  reduce(
    parent: Subtree,
    children: readonly Subtree[],
    position: number,
  ): void {
    if (this.mode !== DIRECT) return;
    const w = this.subtrees.words;
    const b = this.b;
    const lang = this.lang;
    const n = children.length;
    if (n === 0 && this.pending.length > 0) this.flush();
    const pf = w[parent + FLAGS] as number;
    if ((pf & EXTRA) !== 0) {
      this.fail();
      return;
    }
    const productionId = w[parent + PRODUCTION_ID] as number;
    const start = position + (w[parent + PADDING] as number);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const c = children[i] as Subtree;
      if ((w[c + KIDS] as number) < 0) {
        this.fail();
        return;
      }
      const cf = w[c + FLAGS] as number;
      if ((cf & EXTRA) !== 0) continue;
      const alias = aliasAt(lang, productionId, s);
      const field = fieldFor(lang, productionId, s);
      s++;
      if (alias === 0 && field === 0) continue;
      const from = w[c + MARK] as number;
      const to =
        i + 1 < n
          ? (w[(children[i + 1] as Subtree) + MARK] as number)
          : b.mark();
      if (
        !this.patch(c, cf, alias, field, from, to, () =>
          childStart(w, children, i, start),
        )
      ) {
        this.fail();
        return;
      }
    }
    const mark =
      n > 0 ? (w[(children[0] as Subtree) + MARK] as number) : b.mark();
    if ((pf & VISIBLE) !== 0)
      leave(
        b,
        lang,
        this.sym,
        this.source,
        w,
        parent,
        w[parent + SYMBOL] as number,
        (pf & NAMED) !== 0,
        0,
        start,
        mark,
      );
    w[parent + MARK] = mark;
    w[parent + KIDS] = b.mark() - mark;
  }

  /** The parser accepted `root`, rebuilt from `tree`, the last node reduced, with the extras around it. */
  accept(tree: Subtree, root: Subtree): void {
    if (this.mode !== DIRECT) return;
    const w = this.subtrees.words;
    const b = this.b;
    if (
      ((w[tree + FLAGS] as number) & VISIBLE) !== 0 &&
      (w[tree + KIDS] !== 1 ||
        w[tree + MARK] !== b.mark() - 1 ||
        !b.unwrapLast())
    ) {
      this.fail();
      return;
    }
    if (this.pending.length > 0) this.flush();
    leave(
      b,
      this.lang,
      this.sym,
      this.source,
      w,
      root,
      w[root + SYMBOL] as number,
      ((w[root + FLAGS] as number) & NAMED) !== 0,
      0,
      w[root + PADDING] as number,
      0,
    );
    this.tree = b.finish(0);
    this.accepted = root;
  }

  /** The tree under the parse's final `root`, or null when the caller has to run `buildTree`. */
  finish(root: Subtree): Tree | null {
    if (this.mode === DIRECT) return this.accepted === root ? this.tree : null;
    if (this.mode !== DEFERRED) return null;
    this.q = this.b.detach(0);
    this.qBase = 0;
    this.qAt = 0;
    if (
      !this.walk(root, this.subtrees.words[root + PADDING] as number) ||
      this.qAt !== this.q.length
    )
      return null;
    return this.b.finish(0);
  }

  /**
   * With one version left, appends the subtrees pushed since the last one appended (walking down from
   * `head`) and goes back to appending as the parser goes; stays deferred while a node on the way down has
   * two links.
   */
  sync(head: StackNode): void {
    const w = this.subtrees.words;
    const list: number[] = [];
    let node = head;
    let frontier = 0;
    while (node.linkCount > 0) {
      if (node.linkCount !== 1) {
        this.blocked = true;
        return;
      }
      const s = node.subtree0;
      if (s === NONE) {
        this.fail();
        return;
      }
      if ((w[s + KIDS] as number) >= 0) {
        frontier = (w[s + MARK] as number) + (w[s + KIDS] as number);
        break;
      }
      const below = node.node0 as StackNode;
      list.push(s, below.position + (w[s + PADDING] as number));
      node = below;
    }
    // Extras on top stay pending, as they would have while appending.
    let top = 0;
    while (
      top < list.length &&
      ((w[(list[top] as number) + FLAGS] as number) & EXTRA) !== 0
    )
      top += 2;
    this.q = this.b.detach(frontier);
    this.qBase = frontier;
    this.qAt = 0;
    for (let i = list.length - 2; i >= top; i -= 2) {
      if (!this.walk(list[i] as number, list[i + 1] as number)) {
        this.fail();
        return;
      }
    }
    if (this.qAt !== this.q.length) {
      this.fail();
      return;
    }
    for (let i = top - 2; i >= 0; i -= 2)
      this.pending.push(list[i] as number, list[i + 1] as number);
    this.q = [];
    this.qAt = 0;
    this.mode = DIRECT;
  }

  private flush(): void {
    const pending = this.pending;
    for (let i = 0; i < pending.length; i += 2)
      this.emitLeaf(pending[i] as Subtree, pending[i + 1] as number);
    pending.length = 0;
  }

  /** A token as the stack holds it: no alias or field yet. */
  private emitLeaf(t: Subtree, start: number): void {
    const w = this.subtrees.words;
    const b = this.b;
    const mark = b.mark();
    const flags = w[t + FLAGS] as number;
    if ((flags & VISIBLE) !== 0)
      leave(
        b,
        this.lang,
        this.sym,
        this.source,
        w,
        t,
        w[t + SYMBOL] as number,
        (flags & NAMED) !== 0,
        0,
        start,
        mark,
      );
    w[t + MARK] = mark;
    w[t + KIDS] = b.mark() - mark;
    if ((flags & EXTRA) !== 0 && b.mark() > mark) this.extras.add(b.kid(mark));
  }

  /**
   * Gives child `c`, whose entries run from `from` to `to`, the alias and field its parent's production
   * names. False where the result would differ from `buildTree`'s.
   */
  private patch(
    c: Subtree,
    cf: number,
    alias: number,
    field: number,
    from: number,
    to: number,
    start: () => number,
  ): boolean {
    const b = this.b;
    const sym = this.sym;
    const w = this.subtrees.words;
    if ((cf & VISIBLE) !== 0) {
      if (alias === 0) {
        if (from < to) b.setField(b.kid(from), field);
        return true;
      }
      const own = w[c + SYMBOL] as number;
      // Whether layout-only JSX text is dropped depends on the kind, which the alias changes.
      if (
        from === to ||
        sym.label[alias] === LABEL_JSX_TEXT ||
        sym.label[own] === LABEL_JSX_TEXT
      )
        return false;
      const h = b.kid(from);
      const kind = publicSymbol(this.lang, alias);
      let flags = sym.named[alias] ? NAMED_NODE : 0;
      if (flags === 0 && !b.isInner(h)) {
        const hs = b.startOf(h);
        const he = b.endOf(h);
        const length = alias === own ? (sym.fixedLength[alias] ?? -1) : -1;
        if (
          length >= 0
            ? he - hs === length
            : isFixed(this.lang, kind, this.source, hs, he)
        )
          flags = FIXED;
      }
      b.retag(h, kind, field, flags);
      return true;
    }
    if (alias !== 0) {
      // The aliased node goes after its descendants, so nothing may be appended after them yet.
      if (to !== b.mark() || this.qAt !== this.q.length) return false;
      leave(
        b,
        this.lang,
        sym,
        this.source,
        w,
        c,
        alias,
        sym.named[alias] as boolean,
        field,
        start(),
        from,
      );
      return true;
    }
    for (let k = from; k < to; k++) {
      const h = b.kid(k);
      if (b.fieldOf(h) === 0 && !this.extras.has(h)) b.setField(h, field);
    }
    return true;
  }

  /**
   * `buildTree`'s walk of `root`, a subtree the stack holds, starting at `rootStart`, that puts back the
   * entries of a subtree appended before from `q` instead of walking into it. False where the result would
   * differ from `buildTree`'s.
   */
  private walk(root: number, rootStart: number): boolean {
    const lang = this.lang;
    const sym = this.sym;
    const source = this.source;
    const b = this.b;
    const w = this.subtrees.words;
    const q = this.q;
    const rootMark = b.mark();
    const rootFlags = w[root + FLAGS] as number;
    const trees: number[] = [root];
    const index: number[] = [0];
    const structural: number[] = [0];
    const position: number[] = [rootStart];
    const hiddenField: number[] = [(rootFlags & VISIBLE) !== 0 ? -1 : 0];
    const openSymbol: number[] = [w[root + SYMBOL] as number];
    const openNamed: boolean[] = [(rootFlags & NAMED) !== 0];
    const openField: number[] = [0];
    const openStart: number[] = [rootStart];
    const openMark: number[] = [rootMark];
    let depth = 1;
    while (depth > 0) {
      const d = depth - 1;
      const tree = trees[d] as number;
      const i = index[d] as number;
      if (i === w[tree + CHILD_COUNT]) {
        depth = d;
        if (hiddenField[d] === -1) {
          if (this.qAt !== q.length) return false;
          leave(
            b,
            lang,
            sym,
            source,
            w,
            tree,
            openSymbol[d] as number,
            openNamed[d] as boolean,
            openField[d] as number,
            openStart[d] as number,
            openMark[d] as number,
          );
        }
        continue;
      }
      const child = w[tree + CHILDREN + i] as number;
      const childFlags = w[child + FLAGS] as number;
      const start =
        i === 0
          ? (position[d] as number)
          : (position[d] as number) + (w[child + PADDING] as number);
      position[d] = start + (w[child + SIZE] as number);
      index[d] = i + 1;
      let alias = 0;
      let field = 0;
      if ((childFlags & EXTRA) === 0) {
        const s = structural[d] as number;
        const productionId = w[tree + PRODUCTION_ID] as number;
        alias = aliasAt(lang, productionId, s);
        field = fieldFor(lang, productionId, s);
        if (field === 0) {
          const inherited = hiddenField[d] as number;
          if (inherited > 0) field = inherited;
        }
        structural[d] = s + 1;
      }
      const kids = w[child + KIDS] as number;
      if (kids >= 0) {
        // Appended before: put its entries back, then patch them as its parent's reduction would have.
        if (
          w[child + MARK] !== this.qBase + this.qAt ||
          this.qAt + kids > q.length
        )
          return false;
        for (let k = 0; k < kids; k++) b.attach(q[this.qAt++] as number);
        const to = b.mark();
        if (
          (alias !== 0 || field !== 0) &&
          !this.patch(
            child as Subtree,
            childFlags,
            alias,
            field,
            to - kids,
            to,
            () => start,
          )
        )
          return false;
        continue;
      }
      const hasChildren = (w[child + CHILD_COUNT] as number) > 0;
      const extra = (childFlags & EXTRA) !== 0;
      if (extra && hasChildren) return false;
      if ((childFlags & VISIBLE) !== 0 || alias !== 0) {
        const symbol = alias !== 0 ? alias : (w[child + SYMBOL] as number);
        const named =
          alias !== 0
            ? (sym.named[alias] as boolean)
            : (childFlags & NAMED) !== 0;
        if (hasChildren) {
          trees[depth] = child;
          index[depth] = 0;
          structural[depth] = 0;
          position[depth] = start;
          hiddenField[depth] = -1;
          openSymbol[depth] = symbol;
          openNamed[depth] = named;
          openField[depth] = field;
          openStart[depth] = start;
          openMark[depth] = b.mark();
          depth++;
        } else {
          if (this.qAt !== q.length) return false;
          const mark = b.mark();
          leave(
            b,
            lang,
            sym,
            source,
            w,
            child,
            symbol,
            named,
            field,
            start,
            mark,
          );
          if (extra && b.mark() > mark) this.extras.add(b.kid(mark));
        }
      } else if (hasChildren) {
        trees[depth] = child;
        index[depth] = 0;
        structural[depth] = 0;
        position[depth] = start;
        hiddenField[depth] = field;
        depth++;
      }
    }
    w[root + MARK] = rootMark;
    w[root + KIDS] = b.mark() - rootMark;
    return true;
  }
}

/** Where `children[i]` starts, in a node starting at `start`. */
function childStart(
  w: Int32Array,
  children: readonly Subtree[],
  i: number,
  start: number,
): number {
  let p = start;
  for (let j = 0; j < i; j++) {
    const c = children[j] as Subtree;
    p += (j === 0 ? 0 : (w[c + PADDING] as number)) + (w[c + SIZE] as number);
  }
  return i === 0 ? p : p + (w[(children[i] as Subtree) + PADDING] as number);
}
