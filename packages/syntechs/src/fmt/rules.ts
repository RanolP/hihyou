import type { Language as Parser } from "../core/language.js";
import { identity, type Normalize } from "./check.js";
import {
  attachComments,
  type CommentHandler,
  type PlaceComments,
} from "./comments.js";
import type { Settings } from "./options.js";
import type { StreamRules } from "./stream-format.js";

/** A grammar's vocabulary, generated from its `node-types.json` so that a spec naming anything else fails to typecheck. */
export interface Grammar {
  /** Named node kinds that can appear in a tree. */
  readonly kinds: readonly string[];
  /** Anonymous tokens: punctuation and keywords. */
  readonly tokens: readonly string[];
  /** Each kind's fields; a kind without fields is absent. */
  readonly fields: { readonly [kind: string]: readonly string[] };
  /** The extras that are comments, which the formatter places as prettier places comments. */
  readonly comments: readonly string[];
}
type KindOf<G extends Grammar> = G["kinds"][number];
type CommentOf<G extends Grammar> = G["comments"][number];

/** What a rule passes down to the rule of a child it prints, as prettier's `print(path, args)` does. */
export type PrintArgs = Readonly<Record<string, unknown>>;

export interface Language<O = unknown> {
  readonly comments: ReadonlySet<string>;
  /** Comment kinds that run to the end of the line, each with the prefix that marks it (see `LanguageSpec`). */
  readonly lineComments: ReadonlyMap<string, string>;
  readonly defaults: O;
  settings(options: O): Settings;
  /** The parser `check` reads both texts with; see `LanguageSpec`. */
  readonly parser: Parser;
  readonly atoms: ReadonlySet<string>;
  readonly dropped: ReadonlySet<string>;
  readonly normalize: Normalize;
  readonly layoutBlind: boolean;
  readonly hiddenTokens: boolean;
  readonly placeComments: PlaceComments<O>;
  /** How `check` spells a comment before comparing; see `LanguageSpec`. */
  readonly comment: ((text: string) => string | readonly string[]) | undefined;
  /** The rules that lay the tree out on the linear stream (`stream.ts`), which `format` prints by. */
  readonly stream: StreamRules<O>;
}

/**
 * What a language declares besides its rules. `O` is its options type, named as the tool its users configure
 * names them (prettier's `printWidth`, ruff's `line-length`), so resolved config passes through unchanged.
 */
export interface LanguageSpec<G extends Grammar, O> {
  /** Every option's value when the caller gives none: the tool's own defaults. */
  readonly defaults: O;
  /** The layout the core applies for `options`; `prettierSettings` and `ruffSettings` cover the two families. */
  readonly settings: (options: O) => Settings;
  /** The parser of this grammar, which `check` reads the input and the output with. */
  readonly parser: Parser;
  /**
   * Kinds `check` reads as one lexeme, whole, rather than leaf by leaf, so `normalize` sees the value a rule
   * respells in one piece (a string, whose quotes and escapes are separate leaves). A node that holds text of its
   * own besides its children (CSS's `1.5px`, whose only child is the unit) is read whole without being listed.
   */
  readonly atoms?: readonly KindOf<G>[];
  /**
   * Named extras, not comments, that the layout drops (Python's `\` line continuation): no node's items hold
   * them, so a rule never prints one.
   */
  readonly dropped?: readonly KindOf<G>[];
  /**
   * What `check` compares instead of raw token text, so that rules may respell, insert and drop tokens without
   * changing meaning. The default compares text as is, which rejects any respelling.
   */
  readonly normalize?: Normalize;
  /**
   * `normalize` reads only each lexeme's node and text, never `at` nor the side's whole text, so `check` passes
   * an output whose code tokens have the input's texts, in order, without normalizing. The default `normalize`
   * is.
   */
  readonly layoutBlind?: boolean;
  /**
   * The grammar keeps some tokens out of the tree (tree-sitter-kotlin's `;` and nullable `?`): `check` reads the
   * text a node holds outside its children as lexemes of their own, split at blanks, rather than reading the node
   * whole, so a layout that drops or moves such a token is compared token by token.
   */
  readonly hiddenTokens?: boolean;
  /**
   * A comment as the formatter respells it, which `check` applies to both sides before comparing (ruff writes
   * `#x` as `# x`). The default compares comments as written. Several strings compare as several comments:
   * ruff joins trailing comments onto one line, where `# a  # b` reads back as one.
   */
  readonly comment?: (text: string) => string | readonly string[];
  /**
   * The comment kinds that run to the end of the line, so code never follows one on its line. A kind maps to the
   * prefix its line comments start with, because one kind can hold both forms (tree-sitter-json's `comment` is
   * `// ...` and `/* ... *\/`); `""` makes every comment of the kind a line comment (Python's `#`).
   */
  readonly lineComments: { readonly [K in CommentOf<G>]?: string };
  /** Where a comment attaches when not where the core would put it (see `CommentHandler`). */
  readonly handleComment?: CommentHandler<O>;
  /**
   * The language's own comment placement, when its tool places comments by another algorithm than prettier's
   * (ruff's); it replaces `attachComments`, and `handleComment` with it.
   */
  readonly placeComments?: PlaceComments<O>;
}

/** A `Language` but for its `stream` rules, which the caller adds. */
export function defineLanguage<const G extends Grammar, O>(
  grammar: G,
  spec: LanguageSpec<G, O>,
): Omit<Language<O>, "stream"> {
  return {
    comments: new Set(grammar.comments),
    lineComments: new Map(
      grammar.comments.flatMap((kind: CommentOf<G>): [string, string][] => {
        const prefix = spec.lineComments[kind];
        return prefix === undefined ? [] : [[kind, prefix]];
      }),
    ),
    defaults: spec.defaults,
    settings: spec.settings,
    parser: spec.parser,
    atoms: new Set(spec.atoms),
    dropped: new Set(spec.dropped),
    normalize: spec.normalize ?? identity,
    layoutBlind: spec.layoutBlind ?? spec.normalize === undefined,
    hiddenTokens: spec.hiddenTokens ?? false,
    placeComments:
      spec.placeComments ??
      ((tree, isComment, options) =>
        attachComments(tree, isComment, spec.handleComment, options)),
    comment: spec.comment,
  };
}
