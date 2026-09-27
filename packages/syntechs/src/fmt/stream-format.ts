import type { Tree } from "../core/arena.js";
import { attachComments } from "./comments.js";
import {
  type Anchor,
  brokenNodes,
  endOfLine,
  type Formatted,
  shiftForEndOfLine,
} from "./format.js";
import {
  type ByOptions,
  defineLanguage,
  type Grammar,
  type Language,
  type LanguageSpec,
  type ListOptions,
  type SeqPart,
} from "./rules.js";
import {
  BROKEN,
  close,
  FILL,
  FILL_ITEM,
  GROUP,
  IF_BROKEN,
  INDENT,
  LINE_SUFFIX,
  open,
  printStream,
  resetStream,
  SOFT,
  sBreakParent,
  sHardline,
  sLine,
  sText,
  sToken,
} from "./stream.js";
import { lfAfter, newlineBetween, nextLineEmpty } from "./text.js";
import { type FormatTree, firstLeaf } from "./tree.js";

/**
 * The stream path (see `stream.ts`) for the rule helpers JSON uses: a rule appends to the stream instead of
 * returning a Doc, and `format` hands a language defined by `defineStream` to `formatStream`.
 */
export interface StreamCtx<O = unknown> {
  readonly tree: FormatTree;
  readonly options: O;
  /** Appends `node` as its rule prints it, with its comments. */
  print(node: number): void;
  items(node: number): number[];
  danglingComments(node: number): readonly number[];
  /** Appends comment `c`. */
  comment(c: number): void;
  hasDanglingLineComment(node: number): boolean;
  hasComment(node: number, where: "leadingLine" | "trailingSameLine"): boolean;
  isList(node: number): boolean;
}

export type StreamRule<O = unknown> = (node: number, ctx: StreamCtx<O>) => void;

export interface StreamRules<O = unknown> {
  readonly rules: ReadonlyMap<string, StreamRule<O>>;
  readonly lists: ReadonlySet<StreamRule<O>>;
}

type FieldOf<G extends Grammar> = G["fields"][keyof G["fields"]][number];
type KindOf<G extends Grammar> = G["kinds"][number];

export interface StreamHelpers<G extends Grammar, O> {
  list(options: ListOptions<G, O>): StreamRule<O>;
  seq(...parts: readonly SeqPart<G>[]): StreamRule<O>;
  block(): StreamRule<O>;
  verbatim(): StreamRule<O>;
  field<F extends FieldOf<G>>(name: F): { readonly field: F };
  readonly space: { readonly space: true };
}

/** `defineLanguage`, with rules that append to the stream: `format` prints the language through `formatStream`. */
export function defineStream<const G extends Grammar, O>(
  grammar: G,
  spec: LanguageSpec<G, O>,
  define: (
    h: StreamHelpers<G, O>,
  ) => { [K in KindOf<G>]?: StreamRule<O> },
): Language<O> {
  const lists = new Set<StreamRule<O>>();
  const h: StreamHelpers<G, O> = {
    list(o) {
      const rule = listRule(o as ListOptions<Grammar, O>);
      lists.add(rule);
      return rule;
    },
    seq: (...parts) => seqRule(parts as readonly SeqPart<Grammar>[]),
    block: () => blockRule,
    verbatim: () => verbatimRule,
    field: (field) => ({ field }),
    space: { space: true },
  };
  const rules = new Map<string, StreamRule<O>>();
  for (const [kind, rule] of Object.entries(define(h)))
    if (rule) rules.set(kind, rule as StreamRule<O>);
  return { ...defineLanguage(grammar, spec, () => ({})), stream: { rules, lists } };
}

const verbatimRule: StreamRule = (node, ctx) =>
  sToken(node, ctx.tree.text(node));

const blockRule: StreamRule = (node, ctx) => {
  const items = ctx.items(node);
  for (let i = 0; i < items.length; i++) {
    if (i > 0) sHardline();
    ctx.print(items[i] as number);
  }
  for (const c of ctx.danglingComments(node)) ctx.comment(c);
};

function seqRule(parts: readonly SeqPart<Grammar>[]): StreamRule {
  type Is = (tree: FormatTree, c: number, items: readonly number[]) => boolean;
  const matchers = parts.map(
    (part): { space: true } | { space: false; literal: boolean; is: Is } => {
      if (typeof part === "string")
        return {
          space: false,
          literal: true,
          is: (tree, c) => !tree.named(c) && tree.kindName(c) === part,
        };
      if ("space" in part) return { space: true };
      if ("field" in part)
        return {
          space: false,
          literal: false,
          is: (tree, c) => tree.fieldName(c) === part.field,
        };
      if ("kind" in part)
        return {
          space: false,
          literal: false,
          is: (tree, c) => tree.named(c) && tree.kindName(c) === part.kind,
        };
      return {
        space: false,
        literal: false,
        is: (_, c, items) => c === items[part.nth],
      };
    },
  );
  const needsItems = parts.some((p) => typeof p === "object" && "nth" in p);
  return (node, ctx) => {
    const { tree } = ctx;
    const items = needsItems ? ctx.items(node) : [];
    const count = tree.count(node);
    const used: number[] = [];
    open(GROUP);
    for (const mt of matchers) {
      if (mt.space) {
        sText(" ");
        continue;
      }
      let at = 0;
      while (
        at < count &&
        (!mt.is(tree, tree.child(node, at), items) || used.includes(at))
      )
        at++;
      if (at === count) continue;
      used.push(at);
      const child = tree.child(node, at);
      if (mt.literal) sToken(child, tree.text(child));
      else ctx.print(child);
    }
    close();
  };
}

// `listRule` of rules.ts, appending what its Doc holds, in the same order.
function listRule<O>(o: ListOptions<Grammar, O>): StreamRule<O> {
  const fillKinds: ReadonlySet<string> = new Set(o.fillIfAll);
  const read = (v: ByOptions<O, boolean> | undefined, options: O) =>
    typeof v === "function" ? v(options) : v === true;
  return (node, ctx) => {
    const { tree } = ctx;
    const count = tree.count(node);
    const isToken = (c: number, kind: string) =>
      !tree.named(c) && tree.kindName(c) === kind;
    const tok = (kind: string) => {
      for (let i = 0; i < count; i++) {
        const c = tree.child(node, i);
        if (isToken(c, kind)) return sToken(c, tree.text(c));
      }
    };
    const items = ctx.items(node);
    const first = items[0];
    if (first === undefined) {
      const dangling = ctx.danglingComments(node);
      open(GROUP);
      tok(o.open);
      if (dangling.length > 0) {
        open(INDENT);
        sLine(SOFT);
        for (let i = 0; i < dangling.length; i++) {
          if (i > 0) sHardline();
          ctx.comment(dangling[i] as number);
        }
        close();
        if (ctx.hasDanglingLineComment(node)) sHardline();
        else sLine(SOFT);
      }
      tok(o.close);
      close();
      return;
    }

    const always = o.expand === "always";
    const shouldBreak =
      always ||
      (read(o.keepExpanded, ctx.options) &&
        newlineBetween(tree, firstLeaf(tree, node), firstLeaf(tree, first))) ||
      (o.breakNestedLists === true &&
        items.length > 1 &&
        items.every((item, i) => {
          const next = items[i + 1];
          return (
            ctx.isList(item) &&
            (next === undefined ||
              tree.kindName(next) === tree.kindName(item)) &&
            ctx.items(item).length > 1
          );
        })) ||
      ctx.hasDanglingLineComment(node);
    const blankAfter = (item: number) => !always && nextLineEmpty(tree, item);
    const seps: (number | undefined)[] = [];
    let seen = 0;
    for (let i = 0; i < count; i++) {
      const c = tree.child(node, i);
      if (c === items[seen]) seen++;
      else if (seen > 0 && isToken(c, o.sep)) seps[seen - 1] ??= c;
    }
    const sep = (i: number) => {
      const c = seps[i];
      if (c !== undefined) sToken(c, tree.text(c));
    };
    const concise =
      !always &&
      items.length > 1 &&
      items.every(
        (item) =>
          fillKinds.has(tree.kindName(item)) &&
          !ctx.hasComment(item, "trailingSameLine"),
      );

    const listGroup = open(GROUP, -1, shouldBreak ? BROKEN : 0);
    const last = items.at(-1) ?? first;
    const trailingSep = read(o.trailingSep, ctx.options);
    const trailing = () => {
      if (!trailingSep) return;
      open(IF_BROKEN, concise ? listGroup : -1);
      sToken(last, o.sep, true);
      close();
    };
    const pad = read(o.pad, ctx.options) ? 0 : SOFT;
    tok(o.open);
    open(INDENT);
    sLine(pad);
    if (concise) {
      open(FILL);
      for (let i = 0; i < items.length; i++) {
        const item = items[i] as number;
        const next = items[i + 1];
        open(FILL_ITEM);
        ctx.print(item);
        if (next === undefined) trailing();
        else sep(i);
        close();
        if (next === undefined) break;
        if (blankAfter(item)) {
          sHardline();
          sHardline();
        } else if (ctx.hasComment(next, "leadingLine")) sHardline();
        else sLine(0);
      }
      close();
    } else {
      for (let i = 0; i < items.length; i++) {
        const item = items[i] as number;
        if (o.groupItems) open(GROUP);
        ctx.print(item);
        if (o.groupItems) close();
        if (i === items.length - 1) {
          trailing();
          break;
        }
        sep(i);
        sLine(0);
        if (blankAfter(item)) {
          if (o.blankLines === "force") sHardline();
          else sLine(SOFT);
        }
      }
    }
    close();
    sLine(pad);
    tok(o.close);
    close();
  };
}

/** `format`, over the stream rules of `base` (a `defineStream` language). */
export function formatStream<O>(
  tree: Tree,
  base: Language<O>,
  options: Partial<O> = {},
): Formatted {
  try {
    const language = base.stream;
    if (!language) throw new Error("formatStream: a language without stream rules");
    if (base.printComment || base.printsOwnComments)
      throw new Error("formatStream: a language that prints its own comments");
    resetStream();
    const resolved: O = { ...base.defaults, ...options };
    const settings = base.settings(resolved);
    const rules: (StreamRule<O> | null)[] = [];
    const ruleOf = (n: number) => {
      const k = tree.kind(n);
      let rule = rules[k];
      if (rule === undefined)
        rules[k] = rule = language.rules.get(tree.kindName(n)) ?? null;
      return rule;
    };
    const commentKinds: boolean[] = [];
    const isComment = (n: number) =>
      (commentKinds[tree.kind(n)] ??= base.comments.has(tree.kindName(n)));
    const isLine = (n: number) => {
      const prefix = base.lineComments.get(tree.kindName(n));
      return prefix !== undefined && tree.text(n).startsWith(prefix);
    };
    const comments = attachComments(
      tree,
      isComment,
      base.handleComment,
      resolved,
    );
    const comment = (c: number) => {
      const t = tree.text(c);
      sToken(c, isLine(c) ? t.trimEnd() : t);
    };
    const broken = brokenNodes(tree);
    const isBroken = (node: number) => broken !== undefined && broken.has(node);

    // `printWithComments` of rules.ts.
    const print = (node: number) => {
      const rule = (!isBroken(node) && ruleOf(node)) || null;
      const attached = comments.of(node);
      if (attached)
        for (const c of attached.leading) {
          comment(c);
          const lf = lfAfter(tree, c);
          if (isLine(c)) sHardline();
          else if (lf === 0) sText(" ");
          else if (tree.lf(c) > 0) sHardline();
          else sLine(0);
          if (lf >= 2) sHardline();
        }
      if (rule) rule(node, ctx);
      else sToken(node, tree.text(node));
      if (!attached) return;
      let previous: { line: boolean; suffix: boolean } | undefined;
      for (const c of attached.trailing) {
        const lineComment = isLine(c);
        let suffix: boolean;
        if ((previous?.suffix && !previous.line) || tree.lf(c) > 0) {
          open(LINE_SUFFIX);
          sHardline();
          if (tree.lf(c) >= 2) sHardline();
          comment(c);
          close();
          suffix = true;
        } else if (lineComment || previous?.suffix) {
          open(LINE_SUFFIX);
          sText(" ");
          comment(c);
          close();
          if (lineComment) sBreakParent();
          suffix = true;
        } else {
          sText(" ");
          comment(c);
          suffix = false;
        }
        previous = { line: lineComment, suffix };
      }
    };

    const ctx: StreamCtx<O> = {
      tree,
      options: resolved,
      print,
      items(node) {
        const items: number[] = [];
        for (let i = 0, count = tree.count(node); i < count; i++) {
          const c = tree.child(node, i);
          if (tree.named(c) && !isComment(c)) items.push(c);
        }
        return items;
      },
      danglingComments: (node) => comments.dangling(node),
      comment,
      hasDanglingLineComment: (node) => comments.dangling(node).some(isLine),
      hasComment(node, where) {
        const attached = comments.of(node);
        if (!attached) return false;
        if (where === "leadingLine") return attached.leading.some(isLine);
        return attached.trailing.some(
          (c) =>
            isLine(c) &&
            !newlineBetween(tree, firstLeaf(tree, node), c) &&
            !tree.text(c).includes("\n"),
        );
      },
      isList(node) {
        const rule = ruleOf(node);
        return rule !== null && language.lists.has(rule);
      },
    };

    print(tree.root);
    sHardline();
    const printed = printStream(settings);
    const { text } = printed;
    const eol = endOfLine(settings.endOfLine, tree);
    const rewrite = eol !== "\n" || text.includes("\r");
    let anchors: Anchor[] | undefined;
    return {
      ok: true,
      text: rewrite ? text.replace(/\r\n?|\n/g, eol) : text,
      get anchors() {
        if (anchors) return anchors;
        const moved = rewrite ? shiftForEndOfLine(text, eol) : undefined;
        anchors = [];
        for (let t = 0; t < printed.at.length; t++) {
          const nd = printed.nodes[t] as number;
          const start = printed.at[t] as number;
          const end = start + (printed.lengths[t] as number);
          const anchor: Anchor = {
            from: [tree.start(nd), tree.end(nd)],
            to: moved ? [moved(start), moved(end)] : [start, end],
          };
          if (printed.synthetic[t]) anchor.synthetic = true;
          anchors.push(anchor);
        }
        return anchors;
      },
    };
  } catch (e) {
    return {
      ok: false,
      reason: "formatter-error",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
