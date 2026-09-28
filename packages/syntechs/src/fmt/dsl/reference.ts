// The DSL's meaning, as two independent passes over the whole document; the generated code fuses them into one
// per node, and a test holds it to this. Test-only: nothing in the production path imports it.
//
//   flatten  structure -> one token sequence for the whole tree: tokens, spaces, hard lines, comments, and
//            frames around a bracket idiom and a list, whose separators are slots and whose pad and trailing
//            separator are mode-conditional entries (`ifFlat`, `ifBroken`). Each node is a range of it, opened by
//            its `child` entry and closed by an `exit`. No line breaks but hard ones: nothing here depends on the
//            width.
//   wrap     sequence -> stream calls, node range by node range, each under its kind's wrapping rule: groups,
//            indents, lines and fills. A `custom` kind's range is empty: its rule prints the node itself, and
//            each child it prints is flattened as it reaches it.
import { newlineBetween, nextLineEmpty } from "../text.js";
import { type FormatTree, firstLeaf } from "../tree.js";
import {
  BROKEN,
  close,
  FILL,
  FILL_ITEM,
  GROUP,
  IF_BROKEN,
  INDENT,
  open,
  SOFT,
  sBreakParent,
  sHardline,
  sLine,
  sText,
  sToken,
} from "../stream.js";
import {
  printLeadingComment,
  printTrailingComment,
  type StreamCtx,
  type StreamRule,
  type StreamRules,
  type Trailed,
} from "../stream-format.js";
import {
  type Cond,
  type DslGrammar,
  type FormatIR,
  type FrameWrap,
  frameWrap,
  type Pairs,
  type Ref,
  type Tree,
  type Wrap,
} from "./dsl.js";
import {
  Bail,
  commentEntry,
  type CustomRule,
  type FrameRule,
  type Entry,
  fieldChild,
  hasChild,
  listItems,
  parentIs,
  type PredicateRule,
  separators,
  splitChild,
  type SplitRun,
  splitRun,
  someEntry,
  breaksBetween,
  tokenChild,
  type TokenRule,
} from "./runtime.js";
import { normalizers } from "./normalizers.js";

export type { Entry } from "./runtime.js";

type Customs<O> = { readonly [name: string]: CustomRule<O> | TokenRule<O> | FrameRule<O> | PredicateRule<O> };

/**
 * Whether `c` holds for `node`, whose `when` conditions ask `custom`'s predicates; `kindHasFields`: whether
 * the node's kind has fields, which decides the children `has("children")` reads.
 */
export const evalCond = <O>(
  c: Cond,
  ctx: StreamCtx<O>,
  node: number,
  custom: Customs<O>,
  kindHasFields: boolean,
  run?: SplitRun,
): boolean => {
  if (typeof c === "boolean") return c;
  const split = () => {
    if (run === undefined) throw new Error(`a ${c.t} condition outside a splitOn`);
    return run;
  };
  switch (c.t) {
    case "entryCount":
      return split().entries.length === c.n;
    case "anyEntry":
      return someEntry(ctx.tree, split().entries, c.many, c.startsWith);
    case "parent":
      return parentIs(ctx.tree, node, c.kind);
    case "rule": {
      const rule = custom[c.name] as PredicateRule<O> | undefined;
      if (!rule) throw new Error(`no custom rule ${c.name}`);
      return rule(node, ctx);
    }
    case "field":
      return ctx.tree.fieldName(node) === c.name;
    case "has":
      return hasChild(ctx, node, c.name, c.kind, kindHasFields);
    case "not":
      return !evalCond(c.c, ctx, node, custom, kindHasFields, run);
    case "all":
      return c.cs.every((x) => evalCond(x, ctx, node, custom, kindHasFields, run));
    case "any":
      return c.cs.some((x) => evalCond(x, ctx, node, custom, kindHasFields, run));
    case "option": {
      const v = (ctx.options as Record<string, unknown>)[c.key];
      return c.op === "truthy" ? Boolean(v) : c.op === "is" ? v === c.value : v !== c.value;
    }
  }
};

/** The flattened document: its entries, and where each node's range opens and closes. */
export interface Flattened {
  readonly entries: Entry[];
  /** Node -> the index of its `child` entry. */
  readonly start: Map<number, number>;
  /** The index of a `child` entry -> the index of the `exit` closing its range. */
  readonly exit: Map<number, number>;
}

/** Whether a node of `kind` prints by its structure, rather than as its source text. */
const ruled = <O>(ir: FormatIR, ctx: StreamCtx<O>, node: number) =>
  !ctx.isBroken(node) && ctx.tree.kindName(node) in ir.structure;

/** The first list idiom of `tree`, which prints the node's dangling comments. */
export function danglingOwner(tree: Tree): Tree | undefined {
  switch (tree.t) {
    case "sepBy":
    case "lines":
      return tree;
    case "seq":
      for (const p of tree.parts) {
        const o = danglingOwner(p);
        if (o) return o;
      }
      return undefined;
    case "brackets":
      return danglingOwner(tree.body);
    case "opt":
    case "tokIf":
      return danglingOwner(tree.then);
    case "either":
      return danglingOwner(tree.then) ?? danglingOwner(tree.else);
    default:
      return undefined;
  }
}

/** Pass 1: appends `node`'s subtree to `flat` as its structure lays it out. */
export function flatten<O>(
  ir: FormatIR,
  grammar: DslGrammar,
  node: number,
  ctx: StreamCtx<O>,
  custom: Customs<O>,
  flat: Flattened = { entries: [], start: new Map(), exit: new Map() },
): Flattened {
  const t = ctx.tree;
  const out = flat.entries;

  const range = (n: number, body: () => void, via?: string) => {
    const at = out.length;
    flat.start.set(n, at);
    out.push(
      via === undefined
        ? { e: "child", node: n, kind: t.kindName(n) }
        : { e: "child", node: n, kind: t.kindName(n), via },
    );
    body();
    flat.exit.set(at, out.length);
    out.push({ e: "exit" });
  };

  const walkNode = (n: number, via?: string): void =>
    range(n, () => {
      if (via === undefined ? !ruled(ir, ctx, n) : ctx.isBroken(n)) {
        out.push({ e: "tok", node: n, text: t.text(n), synthetic: false });
        return;
      }
      const kind = t.kindName(n);
      const tree: Tree = via === undefined ? (ir.structure[kind] as Tree) : { t: "custom", name: via };
      // A custom rule prints its children itself, and `wrap` flattens each as the rule reaches it.
      if (tree.t === "custom") return;
      structure(n, tree, kind in grammar.fieldTypes);
    }, via);

  const structure = (n: number, tree: Tree, kindHasFields: boolean) => {
    const bound = new Map<string, number>();
    const token = (text: string) => {
      const nth = bound.get(text) ?? 0;
      bound.set(text, nth + 1);
      return tokenChild(t, n, text, nth);
    };
    const owner = danglingOwner(tree);
    const refChild = ({ name, at, split }: Ref) =>
      split !== undefined
        ? splitChild(ctx, n, name, split, at ?? 0, kindHasFields)
        : at !== undefined || name === "children"
          ? (listItems(ctx, n, name, kindHasFields)[at ?? 0] ?? -1)
          : fieldChild(t, n, name);
    const dangling = () => {
      const cs = ctx.danglingComments(n);
      return cs;
    };
    const child = (c: number, via?: string) => {
      const comments = !ctx.ownsComments(c);
      if (comments) for (const x of ctx.leadingComments(c)) out.push(commentEntry(ctx, x, "leading"));
      walkNode(c, via);
      if (comments) for (const x of ctx.trailingComments(c)) out.push(commentEntry(ctx, x, "trailing", c));
    };
    /** The entry of the innermost `tokIf` being walked (its `self`). */
    let self: Entry | undefined;
    const walk = (x: Tree): void => {
      switch (x.t) {
        case "tok": {
          const c = token(x.text);
          if (x.via !== undefined)
            out.push({ e: "tokVia", token: c === -1 ? undefined : c, node: n, via: x.via });
          else if (c !== -1) out.push({ e: "tok", node: c, text: t.text(c), synthetic: false });
          return;
        }
        case "tokIf": {
          const c = token(x.text);
          const present = c !== -1 && (x.synth === undefined || t.text(c) !== "");
          const shows = x.synth === undefined ? present : evalCond(x.synth, ctx, n, custom, kindHasFields);
          if (!shows) {
            if (present) out.push({ e: "tok", node: c, text: "", synthetic: false });
            return;
          }
          const outer = self;
          self = present
            ? { e: "tok", node: c, text: t.text(c), synthetic: false }
            : { e: "tok", node: n, text: x.text, synthetic: true };
          walk(x.then);
          self = outer;
          return;
        }
        case "self":
          if (!self) throw new Error("reference: `self` outside a token's `andThen`");
          out.push(self);
          return;
        case "bail":
          if (evalCond(x.when, ctx, n, custom, kindHasFields)) throw new Bail(t, n, x.reason);
          return;
        case "ref": {
          const c = refChild(x);
          if (c !== -1) child(c, x.via);
          return;
        }
        case "opt":
          if (refChild(x.ref) !== -1) walk(x.then);
          return;
        case "space":
          out.push({ e: "space" });
          return;
        case "seq":
          for (const p of x.parts) walk(p);
          return;
        case "brackets": {
          const bracket = (text: string) => {
            const c = token(text);
            out.push(
              c === -1
                ? { e: "tok", node: n, text, synthetic: true }
                : { e: "tok", node: c, text: t.text(c), synthetic: false },
            );
          };
          const pad = evalCond(x.pad, ctx, n, custom, kindHasFields);
          out.push(
            x.via === undefined
              ? { e: "brackets", label: x.label }
              : { e: "brackets", label: x.label, via: x.via },
          );
          bracket(x.open);
          if (pad) out.push({ e: "ifFlat", text: " " });
          walk(x.body);
          if (pad) out.push({ e: "ifFlat", text: " " });
          bracket(x.close);
          out.push({ e: "end" });
          return;
        }
        case "sepBy": {
          const items = listItems(ctx, n, x.list.name, kindHasFields);
          const seps = separators(t, n, items, x.sep);
          out.push({ e: "list", items, label: x.list.name });
          items.forEach((item, i) => {
            child(item);
            if (i < seps.length) {
              out.push({ e: "sep", tok: seps[i] as number });
              if (nextLineEmpty(t, item)) out.push({ e: "blank" });
            } else if (evalCond(x.trailing, ctx, n, custom, kindHasFields))
              out.push({ e: "ifBroken", after: item, text: x.sep });
          });
          if (owner === x)
            for (const c of dangling()) out.push(commentEntry(ctx, c, "dangling"));
          out.push({ e: "end" });
          return;
        }
        case "lines": {
          const items = listItems(ctx, n, x.list.name, kindHasFields);
          // Nothing to lay out leaves no frame, so a bracket body of only this is empty.
          if (items.length === 0 && (owner !== x || dangling().length === 0)) return;
          out.push({ e: "lines", label: x.list.name });
          items.forEach((item, i) => {
            if (i > 0) out.push({ e: "hardline" });
            child(item);
            if (i < items.length - 1 && nextLineEmpty(t, item)) out.push({ e: "blank" });
          });
          if (owner === x)
            dangling().forEach((c, i) => {
              if (i > 0) out.push({ e: "hardline" });
              out.push(commentEntry(ctx, c, "dangling"));
            });
          out.push({ e: "end" });
          return;
        }
        case "inOrder": {
          const items = new Set(ctx.items(n));
          const matcher = (p: Pairs | undefined) => {
            if (p === undefined) return () => false;
            const all = p.when !== undefined && evalCond(p.when, ctx, n, custom, kindHasFields);
            return (a: number, b: number) =>
              all || (p.after?.includes(t.kindName(a)) ?? false) || (p.before?.includes(t.kindName(b)) ?? false);
          };
          const tight = matcher(x.tight);
          const spaced = matcher(x.spaceWhen);
          let prev = -1;
          for (let i = 0, count = t.count(n); i < count; i++) {
            const c = t.child(n, i);
            const named = t.named(c);
            if (named && !items.has(c)) continue;
            if (prev !== -1 && !tight(prev, c)) {
              if (spaced(prev, c) || x.join === "space") out.push({ e: "space" });
              else if (x.join === "gap") {
                if (!t.adjoins(prev, c)) out.push({ e: "space" });
              } else if (x.join === "line") out.push({ e: "line" });
            }
            prev = c;
            if (!named) out.push({ e: "tok", node: c, text: t.text(c), synthetic: false });
            else if (x.verbatim === undefined || x.verbatim.except.includes(t.kindName(c))) child(c);
            else {
              const comments = !ctx.ownsComments(c);
              if (comments) for (const y of ctx.leadingComments(c)) out.push(commentEntry(ctx, y, "leading"));
              out.push({ e: "tok", node: c, text: t.text(c), synthetic: false });
              if (comments) for (const y of ctx.trailingComments(c)) out.push(commentEntry(ctx, y, "trailing", c));
            }
          }
          return;
        }
        case "verbatim":
          out.push({ e: "tok", node: n, text: t.text(n), synthetic: false });
          return;
        case "text": {
          const raw = t.text(n);
          const text = evalCond(x.when, ctx, n, custom, kindHasFields)
            ? (normalizers[x.fn] as (s: string, o: unknown) => string)(raw, ctx.options)
            : raw;
          out.push({ e: "tok", node: n, text, synthetic: false });
          return;
        }
        case "custom":
          throw new Error("flatten: `custom` is a whole rule, never part of one");
        case "either":
          walk(evalCond(x.when, ctx, n, custom, kindHasFields) ? x.then : x.else);
          return;
        case "spell": {
          const c = token(x.text);
          if (c === -1) return;
          const fn = normalizers[x.fn] as (s: string, o: unknown) => string;
          out.push({ e: "tok", node: c, text: fn(t.text(c), ctx.options), synthetic: false });
          return;
        }
        case "splitOn": {
          const run = splitRun(ctx, n, x.sep, x.except, x.trail);
          const holds = (c: Cond) => evalCond(c, ctx, n, custom, kindHasFields, run);
          if (run.entries.length > 0) {
            let layout = x.layout;
            while ("when" in layout) layout = holds(layout.when) ? layout.then : layout.else;
            out.push({
              e: "split",
              group: layout.group === true,
              indent: layout.indent === true,
              first: layout.first,
              between: layout.between,
              fill: layout.fill === true,
            });
            const keepLines = x.item.t === "words" && holds(x.item.keepLines);
            for (const { items, sep } of run.entries) {
              const breaks = items.map((c, i) => i > 0 && breaksBetween(t, items[i - 1] as number, c));
              out.push({ e: "entry", item: x.item.t, count: items.length, grid: keepLines && breaks.includes(true) });
              items.forEach((c, i) => {
                if (i > 0)
                  out.push({ e: "joint", apart: !t.adjoins(items[i - 1] as number, c), breaks: breaks[i] === true });
                if (!t.named(c)) {
                  out.push({ e: "tok", node: c, text: t.text(c), synthetic: false });
                  return;
                }
                const wrapped = evalCond(x.wrapItem, ctx, c, custom, t.kindName(c) in grammar.fieldTypes);
                if (wrapped) out.push({ e: "wrap" });
                child(c);
                if (wrapped) out.push({ e: "end" });
              });
              out.push({ e: "sep", tok: sep });
              out.push({ e: "end" });
            }
            out.push({ e: "end" });
          }
          for (const c of run.trail) {
            out.push({ e: "space" });
            child(c);
          }
          return;
        }
      }
    };
    walk(tree);
  };

  walkNode(node);
  return flat;
}

/** Pass 2: the range of the node whose `child` entry is at `at` in `flat`, as stream calls, rule by rule. */
export function wrap<O>(
  ir: FormatIR,
  flat: Flattened,
  at: number,
  ctx: StreamCtx<O>,
  custom: Customs<O>,
  grammar: DslGrammar,
): void {
  const seq = flat.entries;
  const { tree } = ctx;
  const exitOf = (i: number) => flat.exit.get(i) as number;
  /** The index after the entry at `i`: past its whole range for a `child`. */
  const next = (i: number) => ((seq[i] as Entry).e === "child" ? exitOf(i) + 1 : i + 1);
  /** The index of the `end` closing the frame opened at `i`. */
  const endOf = (i: number) => {
    for (let depth = 0; ; i = next(i)) {
      const e = (seq[i] as Entry).e;
      if (e === "brackets" || e === "list" || e === "lines" || e === "split" || e === "entry" || e === "wrap")
        depth++;
      else if (e === "end" && --depth === 0) return i;
    }
  };
  const tok = (x: Entry) => {
    if (x.e === "tok") sToken(x.node, x.text, x.synthetic);
  };

  /** Prints `node` from its range, flattening it first when a custom rule reaches it. */
  const printNode = (node: number) => {
    let i = flat.start.get(node);
    if (i === undefined) {
      flatten(ir, grammar, node, ctx, custom, flat);
      i = flat.start.get(node) as number;
    }
    wrapNode(i);
  };
  const inner: StreamCtx<O> = {
    ...ctx,
    printNode,
    print(node) {
      if (ctx.ownsComments(node)) {
        printNode(node);
        return;
      }
      for (const c of ctx.leadingComments(node))
        printLeadingComment(inner, commentEntry(inner, c, "leading"));
      printNode(node);
      let trailed: Trailed | undefined;
      for (const c of ctx.trailingComments(node))
        trailed = printTrailingComment(inner, commentEntry(inner, c, "trailing", node), trailed);
    },
  };

  function wrapNode(i: number): void {
    const x = seq[i] as Extract<Entry, { e: "child" }>;
    const end = exitOf(i);
    if (x.via === undefined ? !ruled(ir, ctx, x.node) : ctx.isBroken(x.node))
      return render(i + 1, end, {}, x.node);
    const t: Tree = x.via === undefined ? (ir.structure[x.kind] as Tree) : { t: "custom", name: x.via };
    const w = x.via === undefined ? (ir.wrapping[x.kind] ?? {}) : {};
    if (w.group) open(GROUP);
    if (t.t === "custom") {
      const rule = custom[t.name] as CustomRule<O> | undefined;
      if (!rule) throw new Error(`no custom rule ${t.name}`);
      rule(x.node, inner);
    } else render(i + 1, end, w, x.node);
    if (w.group) close();
  }

  /** How the previous trailing comment of the child printing now printed. */
  let trailed: Trailed | undefined;
  /** Prints a child or comment entry at `i`; false for any other entry. */
  const childOrComment = (i: number): boolean => {
    const x = seq[i] as Entry;
    if (x.e === "child") {
      wrapNode(i);
      // The child's own children leave theirs behind; its trailing comments start afresh.
      trailed = undefined;
    } else if (x.e !== "comment") return false;
    else if (x.at === "leading") printLeadingComment(inner, x);
    else if (x.at === "trailing") trailed = printTrailingComment(inner, x, trailed);
    else ctx.comment(x.c);
    return true;
  };

  const list = (
    from: number,
    to: number,
    bracketOpen: Entry,
    bracketClose: Entry,
    pad: boolean,
    w: FrameWrap,
    node: number,
  ) => {
    const frame = seq[from] as Extract<Entry, { e: "list" }>;
    const { items } = frame;
    const first = items[0];
    if (first === undefined) {
      open(GROUP);
      tok(bracketOpen);
      const dangling: number[] = [];
      for (let i = from + 1; i < to; i = next(i)) dangling.push(i);
      if (dangling.length > 0) {
        open(INDENT);
        sLine(SOFT);
        dangling.forEach((x, i) => {
          if (i > 0) sHardline();
          childOrComment(x);
        });
        close();
        if (dangling.some((x) => { const y = seq[x] as Entry; return y.e === "comment" && y.line; })) sHardline();
        else sLine(SOFT);
      }
      tok(bracketClose);
      close();
      return;
    }
    const always = w.expand === "always";
    // Per item: its entries [from, to) (leading comments, the child, trailing comments), the slot after it, the
    // comment facts the breaks read, and whether a kept blank line follows (an always-expanded list drops them).
    const parts: {
      from: number;
      to: number;
      after: Entry;
      blank: boolean;
      leadingLine: boolean;
      endsLine: boolean;
    }[] = [];
    const dangling: Extract<Entry, { e: "comment" }>[] = [];
    let start = from + 1;
    for (let i = from + 1; i < to; i = next(i)) {
      const x = seq[i] as Entry;
      const part = parts[parts.length - 1];
      if (x.e === "sep" || x.e === "ifBroken") {
        if (part) part.after = x;
        start = i + 1;
      } else if (x.e === "blank") {
        if (part) part.blank = !always;
        start = i + 1;
      } else if (x.e === "child") {
        let leadingLine = false;
        for (let j = start; j < i; j++) {
          const y = seq[j] as Entry;
          if (y.e === "comment" && y.line) leadingLine = true;
        }
        parts.push({
          from: start,
          to: next(i),
          after: { e: "end" },
          blank: false,
          leadingLine,
          endsLine: false,
        });
      } else if (x.e === "comment" && x.at === "trailing" && part) {
        part.to = i + 1;
        if (x.endsLine) part.endsLine = true;
      } else if (x.e === "comment" && x.at === "dangling") dangling.push(x);
    }
    const item = (i: number) => {
      const part = parts[i] as (typeof parts)[number];
      for (let j = part.from; j < part.to; j = next(j)) childOrComment(j);
    };
    const fillKinds = new Set(w.packWhenAllOf);
    const shouldBreak =
      always ||
      (w.keepExpanded !== undefined &&
        evalCond(w.keepExpanded, ctx, node, custom, ctx.tree.kindName(node) in grammar.fieldTypes) &&
        newlineBetween(tree, firstLeaf(tree, node), firstLeaf(tree, first))) ||
      (w.breakMatrix === true &&
        items.length > 1 &&
        items.every((item, i) => {
          const nx = items[i + 1];
          return (
            ctx.isList(item) &&
            (nx === undefined || tree.kindName(nx) === tree.kindName(item)) &&
            ctx.items(item).length > 1
          );
        }));
    const concise =
      !always &&
      items.length > 1 &&
      items.every((item, i) => fillKinds.has(tree.kindName(item)) && !parts[i]?.endsLine);
    const listGroup = open(GROUP, -1, shouldBreak ? BROKEN : 0);
    const slot = (x: Entry | undefined) => {
      if (x?.e === "sep") {
        if (x.tok !== -1) sToken(x.tok, tree.text(x.tok));
      } else if (x?.e === "ifBroken") {
        open(IF_BROKEN, concise ? listGroup : -1);
        sToken(x.after, x.text, true);
        close();
      }
    };
    const line = pad ? 0 : SOFT;
    tok(bracketOpen);
    open(INDENT);
    sLine(line);
    if (concise) {
      open(FILL);
      parts.forEach((part, i) => {
        const nx = parts[i + 1];
        open(FILL_ITEM);
        item(i);
        slot(part.after);
        close();
        if (nx === undefined) return;
        if (part.blank) {
          sHardline();
          sHardline();
        } else if (nx.leadingLine) sHardline();
        else sLine(0);
      });
      close();
    } else {
      parts.forEach((part, i) => {
        if (w.itemsAsGroups) open(GROUP);
        item(i);
        if (w.itemsAsGroups) close();
        slot(part.after);
        if (i === parts.length - 1) return;
        sLine(0);
        if (part.blank) {
          if (w.blankLines === "force") sHardline();
          else sLine(SOFT);
        }
      });
    }
    // Dangling comments after the items, each on a line of its own once the list breaks; a line comment breaks it.
    for (const c of dangling) {
      sLine(0);
      ctx.comment(c.c);
      if (c.line) sBreakParent();
    }
    close();
    sLine(line);
    tok(bracketClose);
    close();
  };

  /** A `splitOn` run's entries, at `from` to its `end` at `to`, under the layout its `split` entry chose. */
  const split = (from: number, to: number, node: number) => {
    const x = seq[from] as Extract<Entry, { e: "split" }>;
    if (x.group) open(GROUP);
    if (x.indent) open(INDENT);
    if (x.first === "soft") sLine(SOFT);
    else if (x.first === "hard") sHardline();
    if (x.fill) open(FILL);
    for (let i = from + 1, k = 0; i < to; i = endOf(i) + 1, k++) {
      if (k > 0) {
        if (x.between === "line") sLine(0);
        else if (x.between === "hardline") sHardline();
      }
      if (x.fill) open(FILL_ITEM);
      entry(i, endOf(i), node);
      if (x.fill) close();
    }
    if (x.fill) close();
    if (x.indent) close();
    if (x.group) close();
  };
  /** A `splitOn` entry at `from` to its `end` at `to`: its items as its `item` mode prints them, then its separator. */
  const entry = (from: number, to: number, node: number) => {
    const x = seq[from] as Extract<Entry, { e: "entry" }>;
    // Each item's entries [from, to), and the joint before each but the first.
    const spans: [number, number][] = [];
    const joints: Extract<Entry, { e: "joint" }>[] = [];
    let start = from + 1;
    let sep = -1;
    for (let i = from + 1; i < to; i = next(i)) {
      const y = seq[i] as Entry;
      if (y.e === "joint" || y.e === "sep") {
        spans.push([start, i]);
        start = i + 1;
        if (y.e === "joint") joints.push(y);
        else sep = y.tok;
      }
    }
    const item = (k: number) => {
      const [a, b] = spans[k] as [number, number];
      render(a, b, {}, node);
    };
    if (x.item !== "words" || x.count === 1)
      for (let k = 0; k < x.count; k++) {
        if (k > 0 && x.item === "space") sText(" ");
        item(k);
      }
    else if (x.count > 1) {
      open(GROUP);
      open(INDENT);
      open(FILL);
      if (x.grid) {
        open(FILL_ITEM);
        close();
        sHardline();
      }
      open(FILL_ITEM);
      item(0);
      for (let k = 1; k < x.count; k++) {
        const j = joints[k - 1] as Extract<Entry, { e: "joint" }>;
        if (!j.apart) item(k);
        else if (x.grid && !j.breaks) {
          sText(" ");
          item(k);
        } else {
          close();
          if (x.grid) sHardline();
          else sLine(0);
          open(FILL_ITEM);
          item(k);
        }
      }
      close();
      close();
      close();
      close();
    }
    if (sep !== -1) sToken(sep, tree.text(sep));
  };

  const render = (from: number, to: number, w: Wrap, node: number): void => {
    for (let i = from; i < to; i = next(i)) {
      const x = seq[i] as Entry;
      switch (x.e) {
        case "tok":
          tok(x);
          // A verbatim child's trailing comments follow its token, and start afresh as a child's do.
          trailed = undefined;
          break;
        case "tokVia": {
          const rule = custom[x.via] as TokenRule<O> | undefined;
          if (!rule) throw new Error(`no custom rule ${x.via}`);
          rule(x.token, x.node, inner);
          break;
        }
        case "space":
          sText(" ");
          break;
        case "line":
          sLine(0);
          break;
        case "hardline":
          sHardline();
          break;
        case "child":
        case "comment":
          childOrComment(i);
          break;
        case "lines": {
          const end = endOf(i);
          const fw = frameWrap(w, x.label);
          for (let j = i + 1; j < end; j = next(j)) {
            const y = seq[j] as Entry;
            if (y.e === "blank") {
              if (fw.blankLines !== undefined) sHardline();
            } else if (y.e === "hardline") sHardline();
            else childOrComment(j);
          }
          i = end;
          break;
        }
        case "brackets": {
          const end = endOf(i);
          const fw = frameWrap(w, x.label);
          const openTok = seq[i + 1] as Entry;
          const closeTok = seq[end - 1] as Entry;
          const pad = (seq[i + 2] as Entry).e === "ifFlat";
          const body = i + 2 + (pad ? 1 : 0);
          const bodyEnd = end - 1 - (pad ? 1 : 0);
          if (x.via !== undefined) {
            const rule = custom[x.via] as FrameRule<O> | undefined;
            if (!rule) throw new Error(`no custom rule ${x.via}`);
            rule(node, inner, {
              open: () => tok(openTok),
              body: () => render(body, bodyEnd, w, node),
              close: () => tok(closeTok),
            });
          } else if ((seq[body] as Entry).e === "list" && endOf(body) === bodyEnd - 1)
            list(body, bodyEnd - 1, openTok, closeTok, pad, fw, node);
          else {
            open(GROUP, -1, fw.expand === "always" ? BROKEN : 0);
            tok(openTok);
            // An empty body leaves only the line before the closing bracket: `{}` flat, `{` and `}` on two lines broken.
            if (body < bodyEnd) {
              open(INDENT);
              sLine(pad ? 0 : SOFT);
              render(body, bodyEnd, w, node);
              close();
            }
            sLine(pad ? 0 : SOFT);
            tok(closeTok);
            close();
          }
          i = end;
          break;
        }
        case "split": {
          const end = endOf(i);
          split(i, end, node);
          i = end;
          break;
        }
        case "wrap": {
          const end = endOf(i);
          open(GROUP);
          open(INDENT);
          render(i + 1, end, {}, node);
          close();
          close();
          i = end;
          break;
        }
        case "list": {
          // A list outside brackets: its items, each separator followed by a line, then its dangling comments.
          const end = endOf(i);
          for (let j = i + 1; j < end; j = next(j)) {
            const y = seq[j] as Entry;
            if (childOrComment(j)) continue;
            if (y.e === "sep") {
              if (y.tok !== -1) sToken(y.tok, tree.text(y.tok));
              sLine(0);
            }
          }
          i = end;
          break;
        }
        default:
          break;
      }
    }
  };

  wrapNode(at);
}

/** The stream rules of `ir` run as the two passes, for the equivalence test against the generated rules. */
export function referenceRules<O>(
  ir: FormatIR,
  grammar: DslGrammar,
  custom: Customs<O>,
): StreamRules<O> {
  const rules = new Map<string, StreamRule<O>>();
  const lists = new Set<StreamRule<O>>();
  // The core prints only the root through a rule: the reference flattens its whole subtree, then wraps it.
  const rule: StreamRule<O> = (node, ctx) =>
    wrap(ir, flatten(ir, grammar, node, ctx, custom), 0, ctx, custom, grammar);
  for (const [kind, tree] of Object.entries(ir.structure)) {
    const own: StreamRule<O> = (node, ctx) => rule(node, ctx);
    rules.set(kind, own);
    if (holdsList(tree)) lists.add(own);
  }
  return { rules, lists };
}

/** Whether `tree` lays out a separated list, which makes its kind a list to `breakMatrix`. */
export function holdsList(tree: Tree): boolean {
  switch (tree.t) {
    case "sepBy":
      return true;
    case "seq":
      return tree.parts.some(holdsList);
    case "brackets":
      return holdsList(tree.body);
    case "opt":
    case "tokIf":
      return holdsList(tree.then);
    case "either":
      return holdsList(tree.then) || holdsList(tree.else);
    default:
      return false;
  }
}
