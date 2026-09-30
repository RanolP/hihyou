// A property's `name: Type = value` as ktfmt 0.64 `--kotlinlang-style` breaks it. ktfmt puts the type in a level
// of its own inside the declaration's: when the type does not fit after the `:` (or breaks), the line breaks
// after the `:`, the type goes on the next line indented, and the `=` then hangs its initializer on a line of its
// own too, even one that would fit or a lambda it would otherwise hug:
//
//   val complicated:
//       com.example.SomeType<
//           Int,
//       > =
//       DUMMY
import { printHugged } from "../../fmt/dsl/runtime.js";
import {
  close,
  closeChoice,
  closeDead,
  closeSpan,
  closeState,
  GROUP,
  HARD,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  open,
  openChoice,
  openDead,
  openSpan,
  openState,
  sHardline,
  sJump,
  sLine,
  sText,
  sToken,
} from "../../fmt/stream.js";
import type { StreamCtx } from "../../fmt/stream-format.js";

/** The group after each property name's `:`, by its variable_declaration, for the property's `=` to follow. */
const typeGroups = new Map<number, number>();

// No space touching these, as format.ts's `property` lays one out.
const tightBefore = new Set([
  ",",
  ")",
  "]",
  ".",
  "?.",
  "::",
  ":",
  "value_arguments",
  "call_suffix",
  "navigation_suffix",
  "indexing_suffix",
  "type_arguments",
  "function_value_parameters",
]);
const tightAfter = new Set(["(", "[", ".", "?.", "::", "modifiers"]);

/**
 * A variable's `name: Type`. A property's type hangs after the `:` in a group of its own (see `typeGroups`);
 * elsewhere (a `for` loop's, a lambda's) it follows a space.
 */
export function typedName<O>(node: number, ctx: StreamCtx<O>): void {
  const t = ctx.tree;
  const items = new Set(ctx.items(node));
  const property = t.kindName(t.parent(node)) === "property_declaration";
  // After the `:`: the type and its modifiers (`suspend`, annotations), which the grammar makes its siblings.
  let typed = false;
  let prev = -1;
  for (let i = 0, count = t.count(node); i < count; i++) {
    const c = t.child(node, i);
    const named = t.named(c);
    if (named && !items.has(c)) continue;
    if (prev !== -1 && t.kindName(prev) === ":") {
      typed = property;
      if (typed) {
        typeGroups.set(node, open(GROUP));
        open(INDENT);
        sLine(0);
      } else sText(" ");
    } else if (prev !== -1 && !tightBefore.has(t.kindName(c))) sText(" ");
    prev = c;
    if (named) ctx.print(c);
    else sToken(c, t.text(c));
  }
  if (typed) {
    close();
    close();
  }
}

/**
 * The initializer `c` after a property's `=`: on a line of its own when the type group `g` broke, else as
 * format.ts's `hangAfter` and `hug` print it (after a space when `hug` holds and its first line fits).
 */
function initializer<O>(ctx: StreamCtx<O>, c: number, g: number, hug: boolean): void {
  const d = openDead();
  let span: number;
  try {
    span = openSpan();
    ctx.print(c);
    closeSpan();
  } finally {
    closeDead(d);
  }
  open(IF_BROKEN, g);
  open(INDENT);
  sLine(HARD);
  sJump(span);
  close();
  close();
  open(IF_FLAT, g);
  if (hug) {
    openChoice(false);
    openState();
    sText(" ");
    sJump(span);
    closeState();
    openState();
  }
  open(GROUP);
  open(INDENT);
  sLine(0);
  sJump(span);
  close();
  close();
  if (hug) {
    closeState();
    closeChoice();
  }
  close();
}

type Cond<O> = (node: number, ctx: StreamCtx<O>) => boolean;

/**
 * A property: one group, its children spaced but around punctuation, the initializer hanging after `=` or hugged
 * where `hug` holds (format.ts's `huggedChain`) and following its type's group (see `initializer`), and each
 * accessor on a line of its own, indented. An explicit backing field the grammar recovers as a property
 * (`backingField`) prints without the `val` it lacks.
 */
export const property =
  <O>(hug: Cond<O>, backingField: Cond<O>) =>
  (node: number, ctx: StreamCtx<O>): void => {
    const t = ctx.tree;
    const items = new Set(ctx.items(node));
    const field = backingField(node, ctx);
    open(GROUP);
    let prev = -1;
    let g = -1;
    for (let i = 0, count = t.count(node); i < count; i++) {
      const c = t.child(node, i);
      const named = t.named(c);
      if (named && !items.has(c)) continue;
      if (field && t.kindName(c) === "binding_pattern_kind") continue;
      if (prev !== -1) {
        const kind = t.kindName(c);
        if (kind === "getter" || kind === "setter") {
          open(INDENT);
          sHardline();
          ctx.print(c);
          close();
          prev = c;
          continue;
        }
        if (t.kindName(prev) === "=" && named) {
          prev = c;
          if (g !== -1) initializer(ctx, c, g, hug(c, ctx));
          else if (hug(c, ctx)) printHugged(ctx, c);
          else {
            open(GROUP);
            open(INDENT);
            sLine(0);
            ctx.print(c);
            close();
            close();
          }
          continue;
        }
        if (!tightAfter.has(t.kindName(prev)) && !tightBefore.has(kind)) sText(" ");
      }
      prev = c;
      if (named) ctx.print(c);
      else sToken(c, t.text(c));
      if (t.kindName(c) === "variable_declaration") g = typeGroups.get(c) ?? -1;
    }
    close();
  };
