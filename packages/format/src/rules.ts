import type { Comments } from "./comments.js";
import {
  breakParent,
  type Doc,
  fill,
  group,
  hardline,
  ifBreak,
  indent,
  join,
  line,
  lineSuffix,
  softline,
  text,
  token,
} from "./doc.js";
import type { Settings } from "./settings.js";
import {
  hasNewline,
  hasNewlineInRange,
  isNextLineEmpty,
  isPreviousLineEmpty,
} from "./text.js";
import type { FormatNode } from "./tree.js";

/** A grammar's vocabulary, generated from its `node-types.json` so that rules naming anything else fail to typecheck. */
export interface Grammar {
  /** Named node kinds that can appear in a tree. */
  readonly kinds: readonly string[];
  /** Anonymous tokens: punctuation and keywords. */
  readonly tokens: readonly string[];
  readonly fields: readonly string[];
  /** Named kinds the parser may place anywhere (tree-sitter's extras); for these grammars, comments. */
  readonly comments: readonly string[];
}
type KindOf<G extends Grammar> = G["kinds"][number];
type TokenOf<G extends Grammar> = G["tokens"][number];
type FieldOf<G extends Grammar> = G["fields"][number];

export interface Ctx {
  readonly source: string;
  readonly settings: Settings;
  /** `node` as its rule prints it, with the comments attached to it. */
  print(node: FormatNode): Doc;
  /** The children that carry meaning: named, and not comments. */
  items(node: FormatNode): FormatNode[];
  /** Comments inside `node` next to none of its items, printed one per line. */
  dangling(node: FormatNode): Doc[];
  /** Whether a line comment is among the dangling comments of `node`. */
  hasDanglingLineComment(node: FormatNode): boolean;
  /** Whether `node` has a leading line comment (`leading`) or a trailing line comment on its own line. */
  hasComment(
    node: FormatNode,
    where: "leadingLine" | "trailingSameLine",
  ): boolean;
  /** Whether `node`'s kind is printed by a `list` rule. */
  isList(node: FormatNode): boolean;
}

/** Prints one node. Rules are plain functions; the helpers below build the common shapes. */
export type Rule = (node: FormatNode, ctx: Ctx) => Doc;

export interface Language {
  readonly rules: ReadonlyMap<string, Rule>;
  readonly lists: ReadonlySet<Rule>;
  readonly comments: ReadonlySet<string>;
  readonly lineComment: string;
}

export interface ListOptions<G extends Grammar> {
  open: TokenOf<G>;
  close: TokenOf<G>;
  sep: TokenOf<G>;
  /** A space inside the brackets on one line when the reviewer wants `bracketSpacing`. */
  pad?: boolean;
  /** Honour the reviewer's `keepExpanded`: stay broken when the input broke after the opening bracket. */
  keepExpanded?: boolean;
  /** Pack items several to a line when every item is one of these kinds (prettier's number arrays). */
  fillIfAll?: readonly KindOf<G>[];
  /** Break when 2+ items are all lists of one kind with 2+ items each (prettier's matrix rule). */
  breakNestedLists?: boolean;
  /** Wrap each item in its own group, so each fits or breaks on its own. */
  groupItems?: boolean;
  /** A kept blank line either forces the list to break or shows only when it breaks anyway. */
  blankLines: "force" | "ifBroken";
  /** "always" breaks every non-empty list, one item per line (prettier's json-stringify). */
  expand?: "fit" | "always";
  /** A separator after the last item when the list breaks (prettier's `trailingComma` in JSONC). */
  trailingSep?: boolean;
}

export type SeqPart<G extends Grammar> =
  | TokenOf<G>
  | { readonly field: FieldOf<G> }
  | { readonly space: true };

export interface Helpers<G extends Grammar> {
  list(options: ListOptions<G>): Rule;
  /** The named tokens and fields in this order, as one group. */
  seq(...parts: SeqPart<G>[]): Rule;
  /** Each item on its own line. */
  block(): Rule;
  /** The source text unchanged. */
  verbatim(): Rule;
  field(name: FieldOf<G>): { readonly field: FieldOf<G> };
  readonly space: { readonly space: true };
}

/** A rule table whose every key is a kind of `G`: a returned object literal is not checked for excess keys. */
type RuleTable<G extends Grammar, T> = {
  [K in keyof T]: K extends KindOf<G> ? Rule : never;
};

export function defineLanguage<
  const G extends Grammar,
  T extends RuleTable<G, T>,
>(
  grammar: G,
  options: { lineComment: string },
  define: (h: Helpers<G>) => T & { [K in KindOf<G>]?: Rule },
): Language {
  const lists = new Set<Rule>();
  const helpers: Helpers<G> = {
    list(o) {
      const rule = listRule(o);
      lists.add(rule);
      return rule;
    },
    seq: (...parts) => seqRule(parts),
    block: () => blockRule,
    verbatim: () => verbatimRule,
    field: (field) => ({ field }),
    space: { space: true },
  };
  const table: Partial<Record<string, Rule>> = define(helpers);
  const rules = new Map<string, Rule>();
  for (const [kind, rule] of Object.entries(table))
    if (rule) rules.set(kind, rule);
  return {
    rules,
    lists,
    comments: new Set(grammar.comments),
    lineComment: options.lineComment,
  };
}

const slice = (node: FormatNode, ctx: Ctx) =>
  ctx.source.slice(node.start, node.end);

const verbatimRule: Rule = (node, ctx) => token(node, slice(node, ctx));

const blockRule: Rule = (node, ctx) => [
  join(
    hardline,
    ctx.items(node).map((n) => ctx.print(n)),
  ),
  ctx.dangling(node),
];

function seqRule(parts: readonly SeqPart<Grammar>[]): Rule {
  return (node, ctx) => {
    const used = new Set<FormatNode>();
    const docs = parts.map((part): Doc => {
      if (typeof part === "object" && "space" in part) return text(" ");
      const child = node.children.find(
        (c) =>
          !used.has(c) &&
          (typeof part === "string"
            ? !c.named && c.kind === part
            : c.field === part.field),
      );
      if (!child) return [];
      used.add(child);
      return typeof part === "string"
        ? token(child, slice(child, ctx))
        : ctx.print(child);
    });
    return group(docs);
  };
}

// Prettier's array and object printers (language-js/print/array.js, object.js), as one parameterized helper.
function listRule(o: ListOptions<Grammar>): Rule {
  const fillKinds: ReadonlySet<string> = new Set(o.fillIfAll);
  return (node, ctx) => {
    const tok = (kind: string, from: number) => {
      const c = node.children.find(
        (c) => !c.named && c.kind === kind && c.start >= from,
      );
      return c ? token(c, slice(c, ctx)) : [];
    };
    const open = tok(o.open, node.start);
    const close = tok(o.close, node.start);
    const items = ctx.items(node);
    const first = items[0];
    if (!first) {
      const dangling = ctx.dangling(node);
      if (dangling.length === 0) return group([open, close]);
      return group([
        open,
        indent([softline, join(hardline, dangling)]),
        ctx.hasDanglingLineComment(node) ? hardline : softline,
        close,
      ]);
    }

    const always = o.expand === "always";
    const shouldBreak =
      always ||
      (o.keepExpanded === true &&
        ctx.settings.keepExpanded &&
        hasNewlineInRange(ctx.source, node.start, first.start)) ||
      (o.breakNestedLists === true &&
        items.length > 1 &&
        items.every(
          (item, i) =>
            ctx.isList(item) &&
            (items[i + 1] === undefined || items[i + 1]?.kind === item.kind) &&
            ctx.items(item).length > 1,
        )) ||
      ctx.hasDanglingLineComment(node);
    const blankAfter = (item: FormatNode) =>
      !always &&
      ctx.settings.maxBlankLines > 0 &&
      isNextLineEmpty(ctx.source, item.end);
    // Each item's separator, found in one pass: a lookup per item would be quadratic in a lockfile's objects.
    const seps = new Map<FormatNode, FormatNode>();
    const isItem = new Set(items);
    let previous: FormatNode | undefined;
    for (const c of node.children) {
      if (isItem.has(c)) previous = c;
      else if (previous && !c.named && c.kind === o.sep && !seps.has(previous))
        seps.set(previous, c);
    }
    const sep = (item: FormatNode) => {
      const c = seps.get(item);
      return c ? token(c, slice(c, ctx)) : [];
    };

    const concise =
      !always &&
      items.length > 1 &&
      items.every(
        (item) =>
          fillKinds.has(item.kind) && !ctx.hasComment(item, "trailingSameLine"),
      );

    const contents: Doc[] = [];
    const listGroup = group(contents, shouldBreak);
    // A fill prints its items flat even in a broken list, so its trailing separator asks the list itself.
    const trailing = o.trailingSep
      ? ifBreak(text(o.sep), [], concise ? listGroup : undefined)
      : [];

    let body: Doc;
    if (concise) {
      const parts: Doc[] = [];
      for (const [i, item] of items.entries()) {
        const next = items[i + 1];
        parts.push([ctx.print(item), next ? sep(item) : trailing]);
        if (next)
          parts.push(
            blankAfter(item)
              ? [hardline, hardline]
              : ctx.hasComment(next, "leadingLine")
                ? hardline
                : line,
          );
      }
      body = fill(parts);
    } else {
      body = items.map((item, i) => {
        const printed = o.groupItems ? group(ctx.print(item)) : ctx.print(item);
        if (i === items.length - 1) return [printed, trailing];
        const blank = blankAfter(item)
          ? o.blankLines === "force"
            ? hardline
            : softline
          : [];
        return [printed, sep(item), line, blank];
      });
    }
    const pad = o.pad && ctx.settings.bracketSpacing ? line : softline;
    contents.push(open, indent([pad, body]), pad, close);
    return listGroup;
  };
}

/** Prints `node` with its comments, placed as prettier's printComments places them (main/comments/print.js). */
export function printWithComments(
  node: FormatNode,
  printed: Doc,
  comments: Comments,
  ctx: Ctx,
  isLine: (c: FormatNode) => boolean,
): Doc {
  const attached = comments.of(node);
  if (!attached) return printed;
  const { source } = ctx;
  const comment = (c: FormatNode) => {
    const t = slice(c, ctx);
    return token(c, isLine(c) ? t.trimEnd() : t);
  };

  const leading = attached.leading.map((c): Doc => {
    let after: Doc = hardline;
    if (!isLine(c))
      after = hasNewline(source, c.end)
        ? hasNewline(source, c.start, true)
          ? hardline
          : line
        : text(" ");
    let i = c.end;
    while (source.charAt(i) === " " || source.charAt(i) === "\t") i++;
    const blank = /^\r?\n[ \t]*(\r?\n)/.test(source.slice(i));
    return [comment(c), after, blank ? hardline : []];
  });

  let previous: { line: boolean; suffix: boolean } | undefined;
  const trailing = attached.trailing.map((c): Doc => {
    const lineComment = isLine(c);
    let doc: Doc;
    let suffix = true;
    if (
      (previous?.suffix && !previous.line) ||
      hasNewline(source, c.start, true)
    ) {
      doc = lineSuffix([
        hardline,
        isPreviousLineEmpty(source, c.start) ? hardline : [],
        comment(c),
      ]);
    } else if (lineComment || previous?.suffix) {
      doc = [
        lineSuffix([text(" "), comment(c)]),
        lineComment ? breakParent : [],
      ];
    } else {
      doc = [text(" "), comment(c)];
      suffix = false;
    }
    previous = { line: lineComment, suffix };
    return doc;
  });
  return [leading, printed, trailing];
}
