// The DSL's meaning, as two independent passes over the whole document; the generated code fuses them into one
// per node, and a test holds it to this. Test-only: nothing in the production path imports it.
//
//   flatten  structure -> one token sequence for the whole tree: tokens, spaces, hard lines, comments, and
//            frames around a bracket idiom and a list, whose separators are slots and whose pad and trailing
//            separator are mode-conditional entries (`ifFlat`, `ifBroken`). Each node is a range of it, opened by
//            its `child` entry and closed by an `exit`. No line breaks but hard ones: nothing here depends on the
//            width.
//   wrap     sequence -> stream calls, node range by node range, each under its kind's wrapping rule: groups,
//            indents, lines and fills. A `custom` kind's rule lays out its range itself.
import { newlineBetween, nextLineEmpty } from "../text.js";
import { firstLeaf } from "../tree.js";
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
  type Tree,
  type Wrap,
} from "./dsl.js";
import {
  commentEntry,
  type CustomRule,
  type CustomSeq,
  customEntries,
  type Entry,
  fieldChild,
  listItems,
  separators,
  tokenChild,
} from "./runtime.js";

export type { Entry } from "./runtime.js";

export const evalCond = (c: Cond, options: unknown): boolean => {
  if (typeof c === "boolean") return c;
  const v = (options as Record<string, unknown>)[c.key];
  return c.op === "truthy" ? Boolean(v) : c.op === "is" ? v === c.value : v !== c.value;
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
      return danglingOwner(tree.then);
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
      if (tree.t === "custom") {
        for (const x of customEntries(ctx, n))
          if (x.e === "child") walkNode(x.node);
          else out.push(x);
        return;
      }
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
    const dangling = () => {
      const cs = ctx.danglingComments(n);
      return cs;
    };
    const child = (c: number, via?: string) => {
      for (const x of ctx.leadingComments(c)) out.push(commentEntry(ctx, x, "leading"));
      walkNode(c, via);
      for (const x of ctx.trailingComments(c)) out.push(commentEntry(ctx, x, "trailing", c));
    };
    const walk = (x: Tree): void => {
      switch (x.t) {
        case "tok": {
          const c = token(x.text);
          if (c !== -1) out.push({ e: "tok", node: c, text: t.text(c), synthetic: false });
          return;
        }
        case "ref": {
          const c = fieldChild(t, n, x.name);
          if (c !== -1) child(c, x.via);
          return;
        }
        case "opt":
          if (fieldChild(t, n, x.ref.name) !== -1) walk(x.then);
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
          const pad = evalCond(x.pad, ctx.options);
          out.push({ e: "brackets", label: x.label });
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
            } else if (evalCond(x.trailing, ctx.options))
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
          let first = true;
          for (let i = 0, count = t.count(n); i < count; i++) {
            const c = t.child(n, i);
            const named = t.named(c);
            if (named && !items.has(c)) continue;
            if (!first && x.space) out.push({ e: "space" });
            first = false;
            if (named) child(c);
            else out.push({ e: "tok", node: c, text: t.text(c), synthetic: false });
          }
          return;
        }
        case "verbatim":
          out.push({ e: "tok", node: n, text: t.text(n), synthetic: false });
          return;
        case "custom":
          throw new Error("flatten: `custom` is a whole rule, never part of one");
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
  custom: { readonly [name: string]: CustomRule<O> },
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
      if (e === "brackets" || e === "list" || e === "lines") depth++;
      else if (e === "end" && --depth === 0) return i;
    }
  };
  const tok = (x: Entry) => {
    if (x.e === "tok") sToken(x.node, x.text, x.synthetic);
  };

  /** Prints `node` from its range, flattening it on demand when a custom rule reaches past its own children. */
  const printNode = (node: number) => {
    let i = flat.start.get(node);
    if (i === undefined) {
      flatten(ir, grammar, node, ctx, flat);
      i = flat.start.get(node) as number;
    }
    wrapNode(i);
  };
  const inner: StreamCtx<O> = {
    ...ctx,
    printNode,
    print(node) {
      for (const c of ctx.leadingComments(node))
        printLeadingComment(inner, commentEntry(inner, c, "leading"));
      printNode(node);
      let trailed: Trailed | undefined;
      for (const c of ctx.trailingComments(node))
        trailed = printTrailingComment(inner, commentEntry(inner, c, "trailing", node), trailed);
    },
  };

  /** The `CustomSeq` of the custom node whose range is (`from`, `to`): its own entries, read off the sequence. */
  const view = (from: number, to: number): CustomSeq => {
    const own: number[] = [];
    for (let i = from; i < to; i = next(i)) own.push(i);
    const entries = own.map((i) => seq[i] as Entry);
    const kids = entries.flatMap((x) => (x.e === "child" || x.e === "tok" ? [x.node] : []));
    return {
      entries,
      kids,
      print(kid, body) {
        const k = entries.findIndex((x) => (x.e === "child" || x.e === "tok") && x.node === kid);
        if (k === -1) throw new Error(`custom: ${kid} is not a child of this node`);
        let j = k;
        while (j > 0 && entries[j - 1]?.e === "comment") j--;
        for (; j < k; j++) printLeadingComment(inner, entries[j] as Extract<Entry, { e: "comment" }>);
        const x = entries[k] as Entry;
        if (body) body();
        else if (x.e === "child") wrapNode(own[k] as number);
        else tok(x);
        let trailed: Trailed | undefined;
        for (let m = k + 1; m < entries.length; m++) {
          const y = entries[m] as Entry;
          if (y.e !== "comment" || y.at !== "trailing") break;
          trailed = printTrailingComment(inner, y, trailed);
        }
      },
    };
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
      const rule = custom[t.name];
      if (!rule) throw new Error(`no custom rule ${t.name}`);
      rule(x.node, inner, view(i + 1, end));
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
        evalCond(w.keepExpanded, ctx.options) &&
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

  const render = (from: number, to: number, w: Wrap, node: number): void => {
    for (let i = from; i < to; i = next(i)) {
      const x = seq[i] as Entry;
      switch (x.e) {
        case "tok":
          tok(x);
          break;
        case "space":
          sText(" ");
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
          if ((seq[body] as Entry).e === "list" && endOf(body) === bodyEnd - 1)
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
  custom: { readonly [name: string]: CustomRule<O> },
): StreamRules<O> {
  const rules = new Map<string, StreamRule<O>>();
  const lists = new Set<StreamRule<O>>();
  // The core prints only the root through a rule: the reference flattens its whole subtree, then wraps it.
  const rule: StreamRule<O> = (node, ctx) => wrap(ir, flatten(ir, grammar, node, ctx), 0, ctx, custom, grammar);
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
      return holdsList(tree.then);
    default:
      return false;
  }
}
