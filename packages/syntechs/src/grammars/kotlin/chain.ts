// A member chain (`a.b(1)[2]!!.c { }`) as ktfmt 0.64 lays it out: its KotlinInputAstVisitor's
// visitQualifiedExpression, emitQualifiedExpression and computeGroupingInfo, carried from google-java-format's
// levels into the stream's prettier-style groups.
import { close, GROUP, INDENT, open, openIndentIfBreak, SOFT, sHardline, sLine } from "../../fmt/stream.js";
import {
  printLeadingComments,
  printTrailingComments,
  type StreamCtx,
  type StreamRule,
} from "../../fmt/stream-format.js";
import { type FormatTree, firstLeaf } from "../../fmt/tree.js";

/** ktfmt's continuation indent: a receiver shorter than it keeps the first selector on its line. */
const CONTINUATION = 4;

const kid = (t: FormatTree, n: number, kind: string): number => {
  for (let i = 0; i < t.count(n); i++) if (t.kindName(t.child(n, i)) === kind) return t.child(n, i);
  return -1;
};

/** Whether `n` is PSI's KtQualifiedExpression: a `.` or `?.` member access, or a call of one. */
function qualified(t: FormatTree, n: number): boolean {
  const kind = t.kindName(n);
  if (kind === "call_expression") {
    const callee = t.child(n, 0);
    return t.kindName(callee) === "navigation_expression" && qualified(t, callee);
  }
  if (kind !== "navigation_expression") return false;
  const suffix = kid(t, n, "navigation_suffix");
  if (suffix === -1) return false;
  const op = t.text(t.child(suffix, 0));
  return op === "." || op === "?.";
}

/** The parent of `n` when it takes the chain on past `n` (`n` is its receiver), else -1. */
function continuation(t: FormatTree, n: number): number {
  if (n === t.root) return -1;
  const p = t.parent(n);
  if (t.child(p, 0) !== n) return -1;
  switch (t.kindName(p)) {
    case "navigation_expression":
      return qualified(t, p) ? p : -1;
    case "call_expression":
      return qualified(t, p) ? p : -1;
    case "indexing_expression":
    case "postfix_expression":
      return p;
    default:
      return -1;
  }
}

/** Whether ktfmt formats the chain from `n`: the node its `visit` reaches that is, or indexes, a qualified one. */
function chainRoot(t: FormatTree, n: number): boolean {
  let top = n;
  for (let p = continuation(t, top); p !== -1; p = continuation(t, top)) top = p;
  for (;;) {
    if (qualified(t, top)) return top === n;
    const kind = t.kindName(top);
    if (kind === "indexing_expression" && qualified(t, t.child(top, 0))) return top === n;
    if (kind !== "indexing_expression" && kind !== "postfix_expression") return false;
    top = t.child(top, 0);
  }
}

interface Part {
  readonly node: number;
  /** A member access (`.b`, `?.b()`), an index (`[2]`) or a postfix operator (`!!`). */
  readonly kind: "member" | "index" | "postfix";
  /** The member access (for a call, its callee); `node` otherwise. */
  readonly nav: number;
  /** `navigation_suffix`, `indexing_suffix` or the operator token. */
  readonly suffix: number;
  /** A call's `call_suffix`, else -1. */
  readonly call: number;
}

/** PSI's breakIntoParts: the innermost receiver, then each step applied to it. */
function breakIntoParts(t: FormatTree, root: number): { head: number; parts: Part[] } {
  const parts: Part[] = [];
  let n = root;
  for (;;) {
    const kind = t.kindName(n);
    if (qualified(t, n)) {
      const call = kind === "call_expression" ? kid(t, n, "call_suffix") : -1;
      const nav = call === -1 ? n : t.child(n, 0);
      parts.push({ node: n, kind: "member", nav, suffix: kid(t, nav, "navigation_suffix"), call });
      n = t.child(nav, 0);
    } else if (kind === "indexing_expression") {
      parts.push({ node: n, kind: "index", nav: n, suffix: kid(t, n, "indexing_suffix"), call: -1 });
      n = t.child(n, 0);
    } else if (kind === "postfix_expression") {
      parts.push({ node: n, kind: "postfix", nav: n, suffix: t.child(n, t.count(n) - 1), call: -1 });
      n = t.child(n, 0);
    } else break;
  }
  return { head: n, parts: parts.reverse() };
}

const nameOf = (t: FormatTree, p: Part) => t.child(p.suffix, t.count(p.suffix) - 1);
const opOf = (t: FormatTree, p: Part) => t.text(t.child(p.suffix, 0));

/** PSI's isLambda: a call (the part's selector, or the head itself) with a trailing lambda. */
function hasLambda(t: FormatTree, node: number, p?: Part): boolean {
  const suffix = p ? p.call : t.kindName(node) === "call_expression" ? kid(t, node, "call_suffix") : -1;
  return suffix !== -1 && kid(t, suffix, "annotated_lambda") !== -1;
}

/** What shouldGroupPartWithPrevious reads of an expression. */
interface Shape {
  readonly text: string;
  readonly call: boolean;
  readonly name: boolean;
  readonly self: boolean;
}

function shapeOf(t: FormatTree, head: number, parts: readonly Part[], i: number): Shape {
  // Part `i`'s receiver: the head, or the step before; a member access stands for its selector.
  if (i > 0 && parts[i - 1]?.kind === "member") {
    const p = parts[i - 1] as Part;
    const name = nameOf(t, p);
    return { text: t.text(name), call: p.call !== -1, name: p.call === -1, self: false };
  }
  const n = i === 0 ? head : (parts[i - 1] as Part).node;
  const kind = t.kindName(n);
  return {
    text: t.text(n),
    call: kind === "call_expression",
    name: kind === "simple_identifier",
    self: kind === "this_expression" || kind === "super_expression",
  };
}

const upper = (s: string) => {
  const c = s.charAt(0);
  return c !== "" && c === c.toUpperCase() && c !== c.toLowerCase();
};

/** ktfmt's shouldGroupPartWithPrevious, for member access `i` (its index in ktfmt's parts, `i + 1`). */
function groupsWithPrevious(t: FormatTree, head: number, parts: readonly Part[], i: number): boolean {
  const part = parts[i] as Part;
  const previous = shapeOf(t, head, parts, i);
  const name = t.text(nameOf(t, part));
  const call = part.call !== -1;
  const dot = opOf(t, part) === ".";
  if (i === 0 && previous.text.length < CONTINUATION) return true;
  if (previous.self) return true;
  if (previous.name && !call && dot) return true;
  if (!call && dot && upper(name)) return true;
  if (call && !previous.call && upper(previous.text)) return true;
  return call && !previous.call && i === parts.length - 1;
}

/** Whether the source breaks a line directly inside the lambda of `call` (hasSourceNewlineInLambdaBody). */
function multilineLambda(t: FormatTree, call: number): boolean {
  const suffix = kid(t, call, "call_suffix");
  const annotated = suffix === -1 ? -1 : kid(t, suffix, "annotated_lambda");
  const lambda = annotated === -1 ? -1 : kid(t, annotated, "lambda_literal");
  if (lambda === -1) return false;
  for (let i = 1; i < t.count(lambda); i++) if (t.lf(firstLeaf(t, t.child(lambda, i))) > 0) return true;
  return false;
}

/** A call of a trailing lambda alone (`run { }`): isLambdaOrScopingFunction of a chain's innermost receiver. */
function scoping(t: FormatTree, n: number): boolean {
  if (t.kindName(n) !== "call_expression") return false;
  const suffix = kid(t, n, "call_suffix");
  return suffix !== -1 && t.count(suffix) === 1 && t.kindName(t.child(suffix, 0)) === "annotated_lambda";
}

const noValueArguments = (t: FormatTree, parts: readonly Part[]) =>
  parts.every((p) => {
    if (p.call === -1) return true;
    const args = kid(t, p.call, "value_arguments");
    return args === -1 || kid(t, args, "value_argument") === -1;
  });

/** A member access and its call's arguments (`.b<T>(1) { }`), with the comments of the nodes they close. */
function printSelector(ctx: StreamCtx<unknown>, p: Part, afterName?: () => void): void {
  ctx.print(p.suffix);
  if (p.call !== -1 && p.nav !== p.node) printTrailingComments(ctx, p.nav);
  afterName?.();
  if (p.call !== -1) ctx.print(p.call);
}

/** Prints `node` when it is the root of a member chain and returns true; false leaves it to the generated rule. */
export function printChain(
  node: number,
  ctx: StreamCtx<unknown>,
  hugged: (node: number, ctx: StreamCtx<unknown>) => boolean,
): boolean {
  const t = ctx.tree;
  if (!chainRoot(t, node)) return false;
  const { head, parts } = breakIntoParts(t, node);
  const members = parts.every((p) => p.kind === "member");
  const inner = (p: Part) => {
    if (p.node !== node) printLeadingComments(ctx, p.node);
    if (p.nav !== p.node) printLeadingComments(ctx, p.nav);
  };
  const innerTrailing = (p: Part) => {
    if (p.node !== node) printTrailingComments(ctx, p.node);
  };
  // A declaration's `=` or `by` keeps a scoping function on its line (visitLambdaOrScopingFunction), and a chain
  // on one as visitChainedScopingFunction lays it out.
  const hug = hugged(node, ctx);
  if (hug && parts.length === 1 && scoping(t, node) && t.kindName(head) === "simple_identifier") return false;
  const scopingChain = members && scoping(t, head);
  if (scopingChain && (hug || (multilineLambda(t, head) && noValueArguments(t, parts)))) {
    // After a lambda the source breaks, each selector starts a line; else they break together.
    const forced = multilineLambda(t, head);
    for (let i = parts.length - 1; i >= 0; i--) inner(parts[i] as Part);
    ctx.print(head);
    open(GROUP);
    open(INDENT);
    for (const p of parts) {
      if (forced) sHardline();
      else sLine(SOFT);
      printSelector(ctx, p);
      innerTrailing(p);
    }
    close();
    close();
    return true;
  }

  const receiver = t.kindName(t.child(parts.at(-1)?.nav ?? node, 0));
  if (qualified(t, node) && receiver === "when_expression") return false;
  if (qualified(t, node) && receiver === "string_literal") {
    // visitQualifiedExpression of a string receiver: one break before the last selector.
    const last = parts.at(-1) as Part;
    if (last.nav !== last.node) printLeadingComments(ctx, last.nav);
    open(GROUP);
    ctx.print(t.child(last.nav, 0));
    open(INDENT);
    sLine(SOFT);
    printSelector(ctx, last);
    close();
    close();
    return true;
  }

  // computeGroupingInfo: levels to open before each part, and the member accesses that close one.
  const opens = Array.from({ length: parts.length + 1 }, () => 0);
  const closesAfterName = Array.from({ length: parts.length }, () => false);
  let lastToOpen = 0;
  let direct = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] as Part;
    if (p.kind !== "member") opens[lastToOpen] = (opens[lastToOpen] as number) + 1;
    else if (lastToOpen === 0 && groupsWithPrevious(t, head, parts, i)) {
      opens[0] = (opens[0] as number) + 1;
      closesAfterName[i] = true;
    } else {
      lastToOpen = i + 1;
      direct = true;
    }
  }
  const last = parts.at(-1) as Part;
  const lambdas = (hasLambda(t, head) ? 1 : 0) + parts.filter((p) => hasLambda(t, p.node, p)).length;
  // useBlockLikeLambdaStyle: a lone trailing lambda ends the chain, so it hangs off the chain's line as a block.
  const blockLike = last.kind === "member" && hasLambda(t, last.node, last) && lambdas === 1;

  // The group whose breaks are the chain's own: ktfmt's block around it, or the level block-like style adds.
  const chain = direct || blockLike ? open(GROUP) : -1;
  open(INDENT);
  let indented = true;
  for (let k = 0; k < (opens[0] as number); k++) open(GROUP);
  for (let i = parts.length - 1; i >= 0; i--) inner(parts[i] as Part);
  ctx.print(head);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] as Part;
    if (p.kind === "member") sLine(SOFT);
    for (let k = 0; k < (opens[i + 1] as number); k++) open(GROUP);
    if (p.kind !== "member") {
      ctx.print(p.suffix);
      close();
      innerTrailing(p);
      continue;
    }
    const isLast = i === parts.length - 1;
    printSelector(ctx, p, () => {
      if (closesAfterName[i]) close();
      if (!isLast) return;
      if (blockLike) {
        close();
        close();
        indented = false;
        openIndentIfBreak(chain);
      } else if (chain === -1) {
        close();
        indented = false;
      }
    });
    if (isLast && blockLike) close();
    innerTrailing(p);
  }
  if (indented) close();
  if (chain !== -1 && !blockLike) close();
  return true;
}

/**
 * `rule` for the kinds a chain can end at, printing a chain root as ktfmt does; `hugged` tells the right side of a
 * declaration's `=` that stays on its line.
 */
export const chained =
  <O>(rule: StreamRule<O> | undefined, hugged: (node: number, ctx: StreamCtx<unknown>) => boolean): StreamRule<O> =>
  (node, ctx) => {
    if (printChain(node, ctx as StreamCtx<unknown>, hugged)) return;
    rule?.(node, ctx);
  };
