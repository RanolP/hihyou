// The DSL's meaning, as two independent passes over one node at a time; the generated code fuses them, and a test
// holds it to this. Test-only: nothing in the production path imports it.
//
//   flatten  structure -> the node's token sequence: tokens, children, spaces, hard lines, and frames around a
//            bracket idiom and a list, whose separators are slots and whose pad and trailing separator are
//            mode-conditional entries (`ifFlat`, `ifBroken`). No line breaks but hard ones: nothing here depends
//            on the width.
//   wrap     sequence + the kind's wrapping rule -> stream calls: groups, indents, lines and fills.
//
// A child is an opaque `child` entry that the core prints with its comments by its own kind's rules.
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
import type { StreamCtx, StreamRule, StreamRules } from "../stream-format.js";
import type { Cond, DslGrammar, FormatIR, Tree, Wrap } from "./dsl.js";
import { fieldChild, listItems, separators, tokenChild } from "./runtime.js";

export type Entry =
  | { readonly e: "tok"; readonly node: number; readonly text: string; readonly synthetic: boolean }
  | { readonly e: "space" }
  | { readonly e: "hardline" }
  | { readonly e: "child"; readonly node: number; readonly kind: string }
  /** A dangling comment. */
  | { readonly e: "comment"; readonly c: number }
  | { readonly e: "custom"; readonly name: string }
  /** Opens a frame: brackets (its first and last entries are the bracket tokens), or a list of `items`. */
  | { readonly e: "brackets" }
  | { readonly e: "list"; readonly items: readonly number[] }
  | { readonly e: "end" }
  /** After each item but the last: its separator token (-1: none in the source), and a blank line after it. */
  | { readonly e: "sep"; readonly tok: number; readonly blank: boolean }
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
  const walk = (x: Tree): void => {
    switch (x.t) {
      case "tok": {
        const c = token(x.text);
        if (c !== -1) out.push({ e: "tok", node: c, text: t.text(c), synthetic: false });
        return;
      }
      case "ref": {
        const c = fieldChild(t, node, x.name);
        if (c !== -1) out.push({ e: "child", node: c, kind: t.kindName(c) });
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
          out.push({ e: "child", node: item, kind: t.kindName(item) });
          if (i < seps.length)
            out.push({ e: "sep", tok: seps[i] as number, blank: nextLineEmpty(t, item) });
          else if (evalCond(x.trailing, ctx.options))
            out.push({ e: "ifBroken", after: item, text: x.sep });
        });
        if (items.length === 0)
          for (const c of ctx.danglingComments(node)) out.push({ e: "comment", c });
        out.push({ e: "end" });
        return;
      }
      case "lines": {
        const items = listItems(ctx, node, x.list.name, kindHasFields);
        items.forEach((item, i) => {
          if (i > 0) out.push({ e: "hardline" });
          out.push({ e: "child", node: item, kind: t.kindName(item) });
        });
        for (const c of ctx.danglingComments(node)) out.push({ e: "comment", c });
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
          if (x.e === "comment") ctx.comment(x.c);
        });
        close();
        if (ctx.hasDanglingLineComment(node)) sHardline();
        else sLine(SOFT);
      }
      tok(bracketClose);
      close();
      return;
    }
    const after: Entry[] = [];
    for (let i = from + 1; i < to; i++) {
      const x = seq[i] as Entry;
      if (x.e === "sep" || x.e === "ifBroken") after[after.length - 1] = x;
      else if (x.e === "child") after.push({ e: "end" });
    }
    const always = w.expand === "always";
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
        })) ||
      ctx.hasDanglingLineComment(node);
    const concise =
      !always &&
      items.length > 1 &&
      items.every(
        (item) =>
          fillKinds.has(tree.kindName(item)) &&
          !ctx.hasComment(item, "trailingSameLine"),
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
    const blank = (x: Entry | undefined) => !always && x?.e === "sep" && x.blank;
    const line = pad ? 0 : SOFT;
    tok(bracketOpen);
    open(INDENT);
    sLine(line);
    if (concise) {
      open(FILL);
      items.forEach((item, i) => {
        const next = items[i + 1];
        open(FILL_ITEM);
        ctx.print(item);
        slot(after[i]);
        close();
        if (next === undefined) return;
        if (blank(after[i])) {
          sHardline();
          sHardline();
        } else if (ctx.hasComment(next, "leadingLine")) sHardline();
        else sLine(0);
      });
      close();
    } else {
      items.forEach((item, i) => {
        if (w.itemsAsGroups) open(GROUP);
        ctx.print(item);
        if (w.itemsAsGroups) close();
        slot(after[i]);
        if (i === items.length - 1) return;
        sLine(0);
        if (blank(after[i])) {
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
        case "child":
          ctx.print(x.node);
          break;
        case "comment":
          ctx.comment(x.c);
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
            open(GROUP);
            tok(openTok);
            open(INDENT);
            sLine(pad ? 0 : SOFT);
            render(body, bodyEnd);
            close();
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
            if (y.e === "child") ctx.print(y.node);
            else if (y.e === "sep") {
              if (y.tok !== -1) sToken(y.tok, tree.text(y.tok));
              sLine(0);
            } else if (y.e === "comment") ctx.comment(y.c);
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
