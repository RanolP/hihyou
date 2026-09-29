// An enum class body as ktfmt 0.64 `--kotlinlang-style` lays it out: its KotlinInputAstVisitor's visitEnumBody and
// visitEnumEntries, after the pre-passes that manage the entries' trailing comma and drop redundant semicolons.
import { close, INDENT, open, sHardline, sToken } from "../../fmt/stream.js";
import type { StreamCtx } from "../../fmt/stream-format.js";
import { tokenChild } from "../../fmt/dsl/runtime.js";
import { nextLineEmpty } from "../../fmt/text.js";
import { nextLeaf } from "../../fmt/tree.js";
import { NO_NODE } from "../../core/arena.js";

const isProperty = (ctx: StreamCtx<unknown>, n: number) => ctx.tree.kindName(n) === "property_declaration";

// Whether a line holding only `;`s follows dangling comment `c`. ktfmt deletes a redundant `;` but not its line,
// which then prints as a blank one: `// a\n;\n// b` prints `// a`, a blank line, `// b`.
function semicolonLineAfter(ctx: StreamCtx<unknown>, c: number): boolean {
  const t = ctx.tree;
  let l = nextLeaf(t, c);
  if (l === NO_NODE || t.lf(l) === 0 || t.text(l) !== ";") return false;
  for (let next = nextLeaf(t, l); next !== NO_NODE && t.lf(next) === 0 && t.text(next) === ";"; next = nextLeaf(t, l))
    l = next;
  const next = nextLeaf(t, l);
  return next === NO_NODE || t.lf(next) > 0;
}

/**
 * One entry per line, the source's blank lines between them dropped. Two or more entries end in a trailing comma,
 * and a lone entry in none; where members follow, the last entry ends in `;` instead (a `;` alone opens a body
 * with no entries). Then the members as a class body prints them, after a blank line. A body holding neither
 * entries, members nor comments prints `{}`, whatever `;`s it has.
 */
export function enumBody(node: number, ctx: StreamCtx<unknown>): void {
  const t = ctx.tree;
  const items = ctx.items(node);
  const entries = items.filter((n) => t.kindName(n) === "enum_entry");
  const members = items.filter((n) => t.kindName(n) !== "enum_entry");
  const dangling = ctx.danglingComments(node);
  const token = (text: string, source: number) => {
    if (source === -1) sToken(node, text, true);
    else sToken(source, t.text(source));
  };
  // The source token right after `n` among the body's children, if it is `text`.
  const after = (n: number, text: string) => {
    for (let i = 0; i < t.count(node) - 1; i++) {
      if (t.child(node, i) !== n) continue;
      const next = t.child(node, i + 1);
      return !t.named(next) && t.kindName(next) === text ? next : -1;
    }
    return -1;
  };
  const semicolon = tokenChild(t, node, ";", 0);

  token("{", tokenChild(t, node, "{", 0));
  if (items.length === 0 && dangling.length === 0) {
    token("}", tokenChild(t, node, "}", 0));
    return;
  }
  open(INDENT);
  sHardline();
  for (const [i, entry] of entries.entries()) {
    if (i > 0) sHardline();
    ctx.print(entry);
    if (i < entries.length - 1) token(",", after(entry, ","));
    else if (members.length > 0) token(";", semicolon);
    else if (entries.length > 1) token(",", after(entry, ","));
  }
  if (entries.length === 0 && members.length > 0) token(";", semicolon);
  for (const [i, member] of members.entries()) {
    const kind = t.kindName(member);
    // The grammar makes a property's accessors its siblings; they continue it.
    if (i > 0 && (kind === "getter" || kind === "setter")) {
      open(INDENT);
      sHardline();
      ctx.print(member);
      close();
      continue;
    }
    sHardline();
    const prev = members[i - 1];
    if (prev === undefined || nextLineEmpty(t, prev) || !(isProperty(ctx, member) && isProperty(ctx, prev)))
      sHardline();
    ctx.print(member);
  }
  for (const c of dangling) {
    if (items.length > 0 || c !== dangling[0]) sHardline();
    ctx.comment(c);
    if (semicolonLineAfter(ctx, c)) sHardline();
  }
  close();
  sHardline();
  token("}", tokenChild(t, node, "}", 0));
}
