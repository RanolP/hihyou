// The DSL's meaning, as two independent passes over one node at a time; the generated code fuses them, and a test
// holds it to this. Test-only: nothing in the production path imports it.
//
//   flatten  structure -> the node's token sequence: tokens, children, spaces, hard lines, and frames around a
//            bracket idiom and a list, whose separators are slots and whose pad and trailing separator are
//            mode-conditional entries (`ifFlat`, `ifBroken`). No line breaks but hard ones: nothing here depends
//            on the width.
//   wrap     sequence + the kind's wrapping rule -> stream calls: groups, indents, lines and fills.
//
// A child is an opaque `child` entry that the core prints by its own kind's rules; its comments are entries of
// their own around it, which flatten puts there and wrap reads its comment-driven breaks from.
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
  sHardline,
  sLine,
  sText,
  sToken,
} from "../stream.js";
import {
  type CommentFacts,
  commentFacts,
  endsLine,
  printLeadingComment,
  printTrailingComment,
  type StreamCtx,
  type StreamRule,
  type StreamRules,
  type Trailed,
} from "../stream-format.js";
import type { Cond, DslGrammar, FormatIR, Tree, Wrap } from "./dsl.js";
import { fieldChild, listItems, separators, tokenChild } from "./runtime.js";

export type Entry =
  | { readonly e: "tok"; readonly node: number; readonly text: string; readonly synthetic: boolean }
  | { readonly e: "space" }
  | { readonly e: "hardline" }
  | { readonly e: "child"; readonly node: number; readonly kind: string }
  /**
   * A comment attached before (`leading`) or after (`trailing`) the `child` entry next to it, or one of the
   * node's comments next to no child (`dangling`); `endsLine`: a trailing line comment on its child's first line.
   */
  | ({
      readonly e: "comment";
      readonly at: "leading" | "trailing" | "dangling";
      readonly endsLine: boolean;
    } & CommentFacts)
  | { readonly e: "custom"; readonly name: string }
  /** Opens a frame: brackets (its first and last entries are the bracket tokens), or a list of `items`. */
  | { readonly e: "brackets" }
  | { readonly e: "list"; readonly items: readonly number[] }
  | { readonly e: "end" }
  /** After each item but the last: its separator token (-1: none in the source). */
  | { readonly e: "sep"; readonly tok: number }
  /** After an item's separator, or an item of `lines`: the source keeps a blank line there. */
  | { readonly e: "blank" }
  /** Only while the enclosing frame stays flat: a space, inserted beside a padded bracket. */
  | { readonly e: "ifFlat"; readonly text: string }
  /** After the last item, only while the list breaks: a separator the source has no trailing copy of. */
  | { readonly e: "ifBroken"; readonly after: number; readonly text: string };

export const evalCond = (c: Cond, options: unknown): boolean => {
  if (typeof c === "boolean") return c;
  const v = (options as Record<string, unknown>)[c.key];
  return c.op === "truthy" ? Boolean(v) : c.op === "is" ? v === c.value : v !== c.value;
};

/** Pass 1: `node`'s token sequence as `tree` lays it out. */
export function flatten<O>(
  tree: Tree,
  node: number,
  ctx: StreamCtx<O>,
  kindHasFields: boolean,
): Entry[] {
  const t = ctx.tree;
  const out: Entry[] = [];
  const bound = new Map<string, number>();
  const token = (text: string) => {
    const nth = bound.get(text) ?? 0;
    bound.set(text, nth + 1);
    return tokenChild(t, node, text, nth);
  };
  const comment = (c: number, at: "leading" | "trailing" | "dangling", ends = false): Entry => ({
    e: "comment",
    at,
    endsLine: ends,
    ...commentFacts(ctx, c),
  });
  const child = (c: number) => {
    for (const x of ctx.leadingComments(c)) out.push(comment(x, "leading"));
    out.push({ e: "child", node: c, kind: t.kindName(c) });
    for (const x of ctx.trailingComments(c)) out.push(comment(x, "trailing", endsLine(ctx, c, x)));
  };
  const walk = (x: Tree): void => {
    switch (x.t) {
      case "tok": {
        const c = token(x.text);
        if (c !== -1) out.push({ e: "tok", node: c, text: t.text(c), synthetic: false });
        return;
      }
      case "ref": {
        const c = fieldChild(t, node, x.name);
        if (c !== -1) child(c);
        return;
      }
      case "opt":
        if (fieldChild(t, node, x.ref.name) !== -1) walk(x.then);
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
              ? { e: "tok", node, text, synthetic: true }
              : { e: "tok", node: c, text: t.text(c), synthetic: false },
          );
        };
        const pad = evalCond(x.pad, ctx.options);
        out.push({ e: "brackets" });
        bracket(x.open);
        if (pad) out.push({ e: "ifFlat", text: " " });
        walk(x.body);
        if (pad) out.push({ e: "ifFlat", text: " " });
        bracket(x.close);
        out.push({ e: "end" });
        return;
      }
      case "sepBy": {
        const items = listItems(ctx, node, x.list.name, kindHasFields);
        const seps = separators(t, node, items, x.sep);
        out.push({ e: "list", items });
        items.forEach((item, i) => {
          child(item);
          if (i < seps.length) {
            out.push({ e: "sep", tok: seps[i] as number });
            if (nextLineEmpty(t, item)) out.push({ e: "blank" });
          } else if (evalCond(x.trailing, ctx.options))
            out.push({ e: "ifBroken", after: item, text: x.sep });
        });
        if (items.length === 0)
          for (const c of ctx.danglingComments(node)) out.push(comment(c, "dangling"));
        out.push({ e: "end" });
        return;
      }
      case "lines": {
        const items = listItems(ctx, node, x.list.name, kindHasFields);
        items.forEach((item, i) => {
          if (i > 0) out.push({ e: "hardline" });
          child(item);
          if (i < items.length - 1 && nextLineEmpty(t, item)) out.push({ e: "blank" });
        });
        ctx.danglingComments(node).forEach((c, i) => {
          if (i > 0) out.push({ e: "hardline" });
          out.push(comment(c, "dangling"));
        });
        return;
      }
      case "inOrder": {
        const items = new Set(ctx.items(node));
        let first = true;
        for (let i = 0, count = t.count(node); i < count; i++) {
          const c = t.child(node, i);
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
        out.push({ e: "tok", node, text: t.text(node), synthetic: false });
        return;
      case "custom":
        out.push({ e: "custom", name: x.name });
        return;
    }
  };
  walk(tree);
  return out;
}

/** Pass 2: `seq`, the sequence of `node`, as stream calls under the kind's wrapping rule `w`. */
export function wrap<O>(
  seq: readonly Entry[],
  w: Wrap,
  node: number,
  ctx: StreamCtx<O>,
  custom: { readonly [name: string]: StreamRule<O> },
): void {
  const { tree } = ctx;
  /** The index of the `end` closing the frame opened at `i`. */
  const endOf = (i: number) => {
    for (let depth = 0; ; i++) {
      const e = (seq[i] as Entry).e;
      if (e === "brackets" || e === "list") depth++;
      else if (e === "end" && --depth === 0) return i;
    }
  };
  const tok = (x: Entry) => {
    if (x.e === "tok") sToken(x.node, x.text, x.synthetic);
  };
  /** How the previous trailing comment of the child printing now printed. */
  let trailed: Trailed | undefined;
  /** Prints a child or comment entry; false for any other entry. */
  const childOrComment = (x: Entry): boolean => {
    if (x.e === "child") {
      trailed = undefined;
      ctx.printNode(x.node);
    } else if (x.e !== "comment") return false;
    else if (x.at === "leading") printLeadingComment(ctx, x);
    else if (x.at === "trailing") trailed = printTrailingComment(ctx, x, trailed);
    else ctx.comment(x.c);
    return true;
  };

  const list = (from: number, to: number, bracketOpen: Entry, bracketClose: Entry, pad: boolean) => {
    const frame = seq[from] as Extract<Entry, { e: "list" }>;
    const { items } = frame;
    const first = items[0];
    if (first === undefined) {
      open(GROUP);
      tok(bracketOpen);
      const dangling = seq.slice(from + 1, to);
      if (dangling.length > 0) {
        open(INDENT);
        sLine(SOFT);
        dangling.forEach((x, i) => {
          if (i > 0) sHardline();
          childOrComment(x);
        });
        close();
        if (dangling.some((x) => x.e === "comment" && x.line)) sHardline();
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
    let start = from + 1;
    for (let i = from + 1; i < to; i++) {
      const x = seq[i] as Entry;
      const part = parts[parts.length - 1];
      if (x.e === "sep" || x.e === "ifBroken") {
        if (part) part.after = x;
        start = i + 1;
      } else if (x.e === "blank") {
        if (part) part.blank = !always;
        start = i + 1;
      } else if (x.e === "child") {
        const leading = seq.slice(start, i);
        parts.push({
          from: start,
          to: i + 1,
          after: { e: "end" },
          blank: false,
          leadingLine: leading.some((y) => y.e === "comment" && y.line),
          endsLine: false,
        });
      } else if (x.e === "comment" && x.at === "trailing" && part) {
        part.to = i + 1;
        if (x.endsLine) part.endsLine = true;
      }
    }
    const item = (i: number) => {
      const part = parts[i] as (typeof parts)[number];
      for (let j = part.from; j < part.to; j++) childOrComment(seq[j] as Entry);
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
          const next = items[i + 1];
          return (
            ctx.isList(item) &&
            (next === undefined || tree.kindName(next) === tree.kindName(item)) &&
            ctx.items(item).length > 1
          );
        }));
    const concise =
      !always &&
      items.length > 1 &&
      items.every(
        (item, i) => fillKinds.has(tree.kindName(item)) && !parts[i]?.endsLine,
      );
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
        const next = parts[i + 1];
        open(FILL_ITEM);
        item(i);
        slot(part.after);
        close();
        if (next === undefined) return;
        if (part.blank) {
          sHardline();
          sHardline();
        } else if (next.leadingLine) sHardline();
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
    close();
    sLine(line);
    tok(bracketClose);
    close();
  };

  const render = (from: number, to: number): void => {
    for (let i = from; i < to; i++) {
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
        case "blank":
          // Only `lines` leave a blank entry outside a list frame.
          if (w.blankLines !== undefined) sHardline();
          break;
        case "child":
        case "comment":
          childOrComment(x);
          break;
        case "custom": {
          const rule = custom[x.name];
          if (!rule) throw new Error(`no custom rule ${x.name}`);
          rule(node, ctx);
          break;
        }
        case "brackets": {
          const end = endOf(i);
          const openTok = seq[i + 1] as Entry;
          const closeTok = seq[end - 1] as Entry;
          const pad = (seq[i + 2] as Entry).e === "ifFlat";
          const body = i + 2 + (pad ? 1 : 0);
          const bodyEnd = end - 1 - (pad ? 1 : 0);
          if ((seq[body] as Entry).e === "list" && endOf(body) === bodyEnd - 1)
            list(body, bodyEnd - 1, openTok, closeTok, pad);
          else {
            open(GROUP, -1, w.expand === "always" ? BROKEN : 0);
            tok(openTok);
            // An empty body leaves only the line before the closing bracket: `{}` flat, `{` and `}` on two lines broken.
            if (body < bodyEnd) {
              open(INDENT);
              sLine(pad ? 0 : SOFT);
              render(body, bodyEnd);
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
          // A list outside brackets: its items, each separator followed by a line.
          const end = endOf(i);
          for (let j = i + 1; j < end; j++) {
            const y = seq[j] as Entry;
            if (childOrComment(y)) continue;
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

  if (w.group) open(GROUP);
  render(0, seq.length);
  if (w.group) close();
}

/** The stream rules of `ir` run as the two passes, for the equivalence test against the generated rules. */
export function referenceRules<O>(
  ir: FormatIR,
  grammar: DslGrammar,
  custom: { readonly [name: string]: StreamRule<O> },
): StreamRules<O> {
  const rules = new Map<string, StreamRule<O>>();
  const lists = new Set<StreamRule<O>>();
  for (const [kind, tree] of Object.entries(ir.structure)) {
    const w = ir.wrapping[kind] ?? {};
    const hasFields = kind in grammar.fieldTypes;
    const rule: StreamRule<O> = (node, ctx) =>
      wrap(flatten(tree, node, ctx, hasFields), w, node, ctx, custom);
    rules.set(kind, rule);
    if (holdsList(tree)) lists.add(rule);
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
