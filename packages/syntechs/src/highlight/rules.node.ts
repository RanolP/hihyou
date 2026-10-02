// The sitter-to-tm ruleset: which TextMate scope each tree-sitter highlight capture paints, per language.
// highlight/generate.node.ts compiles each language's highlight queries against it into
// src/grammars/<name>/highlight.gen.ts. The scopes are the ones VS Code's TextMate grammar for the language
// assigns to the same token, so a TextMate theme colours a node the way it colours that token in VS Code.
//
// A capture's scope may be refined by the captured node's kind (`byKind`), its whole text (`byText`), or the
// start of its text (`byPrefix`). `""` captures the node so no earlier pattern paints it, and paints nothing.
// What the upstream queries do not capture at all is added as patterns in the language's highlights.tm.scm,
// which the generator appends after the upstream files so it wins on a node both capture.

import type { CaptureScope } from "./match.js";

export type Rule = string | CaptureScope;

export interface LanguageRules {
  /** The grammar package under packages/syntechs/grammars whose queries come first. */
  grammar: string;
  /** The tree-sitter.json `scope` whose `highlights` list names the upstream query files, in order. */
  scope?: string;
  /** The upstream query files, for a grammar package with no tree-sitter.json. */
  queries?: string[];
  /** Query files under src/grammars appended after the upstream ones. */
  extend?: string[];
  /**
   * The upstream injection query, for a grammar whose tree-sitter.json names none: tree-sitter then reads
   * queries/injections.scm, which is the default here too.
   */
  injections?: string;
  /**
   * Per injected language, a regular expression the injection's content must match. tree-sitter injects JSDoc
   * into every comment; VS Code's grammar reads it only in a `/**` comment, so a `// @ts-ignore` stays a comment.
   */
  injectionMatch?: Record<string, string>;
  /** `null` drops a capture that is not a highlight, as a `_`-prefixed one is. */
  captures: Record<string, Rule | null>;
}

/** The captures every language's queries share, as the generic TextMate scope suffixed with the language. */
function shared(lang: string): Record<string, Rule> {
  return {
    variable: "",
    "variable.parameter": `variable.parameter.${lang}`,
    parameter: `variable.parameter.${lang}`,
    property: "",
    constant: `variable.other.constant.${lang}`,
    "constant.builtin": `constant.language.${lang}`,
    boolean: `constant.language.boolean.${lang}`,
    number: `constant.numeric.${lang}`,
    float: `constant.numeric.${lang}`,
    string: `string.quoted.double.${lang}`,
    "string.escape": `constant.character.escape.${lang}`,
    character: `string.quoted.single.${lang}`,
    comment: `comment.block.${lang}`,
    function: `entity.name.function.${lang}`,
    "function.method": `entity.name.function.${lang}`,
    "function.builtin": `entity.name.function.${lang}`,
    type: `entity.name.type.${lang}`,
    "type.builtin": `entity.name.type.${lang}`,
    label: `entity.name.label.${lang}`,
    attribute: `entity.other.attribute-name.${lang}`,
    keyword: `keyword.control.${lang}`,
    conditional: `keyword.control.${lang}`,
    repeat: `keyword.control.${lang}`,
    exception: `keyword.control.${lang}`,
    operator: `keyword.operator.${lang}`,
    "punctuation.bracket": "",
    "punctuation.delimiter": "",
    "punctuation.special": `punctuation.definition.template-expression.begin.${lang}`,
  };
}

const COMMENT_JS: Rule = {
  scope: "comment.block.js",
  byPrefix: [
    ["/**/", "comment.block.js"],
    ["/**", "comment.block.documentation.js"],
    ["//", "comment.line.double-slash.js"],
    ["#!", "comment.line.shebang.js"],
  ],
};

const JS: Record<string, Rule> = {
  ...shared("js"),
  variable: "variable.other.readwrite.js",
  property: "variable.other.property.js",
  // `^[A-Z]` identifiers: VS Code's grammar colours a capitalised value like any other; highlights.tm.scm
  // recaptures the places it treats one as a class or a call.
  constructor: "variable.other.readwrite.js",
  "variable.builtin": {
    scope: "variable.other.readwrite.js",
    byText: {
      this: "variable.language.this.js",
      super: "variable.language.super.js",
      module: "support.type.object.module.js",
    },
  },
  comment: COMMENT_JS,
  string: {
    scope: "string.quoted.single.js",
    byKind: { template_string: "string.template.js" },
    byPrefix: [['"', "string.quoted.double.js"]],
  },
  "string.special": "string.regexp.js",
  "string.regexp.flags": "keyword.other.js",
  "string.regexp.delimiter": "punctuation.definition.string.regexp.js",
  embedded: "meta.template.expression.js",
  "punctuation.special": {
    scope: "punctuation.definition.template-expression.begin.js",
    byText: { "}": "punctuation.definition.template-expression.end.js" },
  },
  "punctuation.delimiter": { scope: "", byKind: { optional_chain: "punctuation.accessor.optional.js" } },
  "punctuation.decorator": "punctuation.decorator.js",
  operator: {
    scope: "keyword.operator.js",
    byText: { "=>": "storage.type.function.arrow.js", "...": "keyword.operator.spread.js" },
  },
  "constant.property": "variable.other.constant.property.js",
  "constant.enum": "variable.other.enummember.js",
  "constant.import-export-all": "constant.language.import-export-all.js",
  "support.property": "support.variable.property.js",
  "support.class": { scope: "support.class.js", byText: { Promise: "support.class.promise.js" } },
  "support.module": "support.type.object.module.js",
  "property.key": "meta.object-literal.key.js",
  "property.declaration": "variable.object.property.js",
  "function.decorator": "entity.name.function.decorator.js",
  "keyword.storage": "storage.type.js",
  "type.class": "entity.name.type.class.js",
  "type.inherited": "entity.other.inherited-class.js",
  "type.module": "entity.name.type.module.js",
  "type.builtin": "support.type.primitive.ts",
  "variable.this": "variable.language.this.js",
  "variable.alias": "variable.other.readwrite.alias.js",
  tag: "entity.name.tag.js",
  "tag.component": "support.class.component.js",
};

const KOTLIN_MODIFIERS = [
  "public", "private", "protected", "internal", "open", "abstract", "final", "override", "data", "sealed",
  "enum", "inner", "companion", "lateinit", "const", "suspend", "inline", "noinline", "crossinline", "reified",
  "vararg", "tailrec", "operator", "infix", "external", "annotation", "expect", "actual", "value", "fun",
  "in", "out",
];

const KOTLIN: Record<string, Rule> = {
  ...shared("kotlin"),
  property: "",
  constant: "",
  parameter: "",
  // `it` and `field`: VS Code's grammar scopes `this` and `super` alone.
  "variable.builtin": { scope: "variable.language.this.kotlin", byKind: { simple_identifier: "" } },
  "type.builtin": "entity.name.type.kotlin",
  namespace: "entity.name.package.kotlin",
  include: "keyword.soft.kotlin",
  attribute: "entity.name.type.annotation.kotlin",
  "function.builtin": "entity.name.function.kotlin",
  // Upstream captures the whole primary constructor and the `constructor`/`init` keywords: only the keywords
  // are painted, and the type a constructor invocation names. `constructor(` reads as a call to VS Code's grammar.
  constructor: {
    scope: "",
    tokens: true,
    byKind: { type_identifier: "entity.name.type.kotlin" },
    byText: { constructor: "entity.name.function.kotlin", init: "keyword.soft.kotlin" },
  },
  keyword: {
    scope: "keyword.hard.kotlin",
    byText: Object.fromEntries(KOTLIN_MODIFIERS.map((m) => [m, "storage.modifier.other.kotlin"])),
  },
  "keyword.function": "keyword.hard.fun.kotlin",
  "keyword.return": { scope: "keyword.control.kotlin", tokens: true },
  comment: {
    scope: "comment.block.kotlin",
    byKind: { line_comment: "comment.line.double-slash.kotlin" },
    byPrefix: [["/**", "comment.block.javadoc.kotlin"]],
  },
  boolean: "constant.language.kotlin",
  "string.regex": "string.quoted.double.kotlin",
  "string.template": "variable.string-escape.kotlin",
  "punctuation.special": "punctuation.definition.template-expression.begin.kotlin",
  "variable.wildcard": "variable.language.wildcard.kotlin",
  "keyword.soft": "keyword.soft.kotlin",
  "operator.arrow": "storage.type.function.arrow.kotlin",
};

/** A `/**` comment, not the empty `/**\/`. */
const JS_INJECTIONS = { jsdoc: "^\\/\\*\\*(?!\\/)" };

// Injected into a JavaScript or TypeScript `/**` comment; the comment's own scope stays beneath these.
const JSDOC: Record<string, Rule> = {
  keyword: "storage.type.class.jsdoc",
  type: "entity.name.type.instance.jsdoc",
  variable: "variable.other.jsdoc",
  "variable.description": "variable.other.description.jsdoc",
  link: "variable.other.link.underline.jsdoc",
};

const CHARACTER_CLASS = "punctuation.definition.character-class.regexp";
const QUANTIFIER = "keyword.operator.quantifier.regexp";
const ANCHOR = "keyword.control.anchor.regexp";

// Injected into a regex literal's pattern, under the host's string.regexp scope.
const REGEX: Record<string, Rule> = {
  "punctuation.bracket": {
    scope: "punctuation.definition.group.regexp",
    byText: { "[": CHARACTER_CLASS, "]": CHARACTER_CLASS, "[:": CHARACTER_CLASS, ":]": CHARACTER_CLASS, "{": QUANTIFIER, "}": QUANTIFIER },
  },
  "punctuation.delimiter": QUANTIFIER,
  property: "variable.other.regexp",
  escape: {
    scope: "constant.character.escape.backslash.regexp",
    byKind: {
      character_class_escape: "constant.other.character-class.regexp",
      start_assertion: ANCHOR,
      end_assertion: ANCHOR,
      boundary_assertion: ANCHOR,
      non_boundary_assertion: ANCHOR,
      control_letter_escape: "constant.character.control.regexp",
    },
    // tree-sitter's control_escape covers `\t` and `\x41` alike; VS Code reads the letters as classes.
    byPrefix: [
      ["\\x", "constant.character.numeric.regexp"],
      ...["\\t", "\\n", "\\r", "\\f", "\\v"].map((p): [string, string] => [p, "constant.other.character-class.regexp"]),
    ],
  },
  operator: {
    scope: QUANTIFIER,
    byText: {
      "|": "keyword.operator.or.regexp",
      "^": "keyword.operator.negation.regexp",
      "-": "constant.other.character-class.range.regexp",
      "=": "keyword.operator.lookahead.regexp",
      "!": "keyword.operator.lookahead.negative.regexp",
    },
  },
  number: QUANTIFIER,
  "character.special": "keyword.other.regexp",
  // A class's members take the set's scope, which highlights.tm.scm paints over the whole class.
  "constant.character": "",
  "character.set": "constant.other.character-class.set.regexp",
  "character.class": "constant.other.character-class.regexp",
  "character.range": "constant.other.character-class.range.regexp",
  backreference: "keyword.other.back-reference.regexp",
  string: "",
};

// nvim-treesitter's capture names, which tree-sitter-swift's highlights.scm uses, as generic TextMate scopes.
// `null` marks a capture that is not a highlight (`@spell`).
const SWIFT: Record<string, Rule | null> = Object.fromEntries(
  Object.entries({
    attribute: "storage.modifier.attribute",
    boolean: "constant.language.boolean",
    "character.special": "variable.language.wildcard",
    comment: "comment",
    "comment.documentation": "comment.block.documentation",
    "constant.builtin": "constant.language",
    "constant.macro": "constant.language",
    constructor: "entity.name.function.constructor",
    "function.call": "entity.name.function",
    "function.macro": "entity.name.function.preprocessor",
    "function.method": "entity.name.function",
    keyword: "keyword.other",
    "keyword.conditional": "keyword.control.conditional",
    "keyword.conditional.ternary": "keyword.operator.ternary",
    "keyword.coroutine": "keyword.control.async",
    "keyword.directive": "keyword.control.directive",
    "keyword.exception": "keyword.control.exception",
    "keyword.function": "storage.type.function",
    "keyword.import": "keyword.control.import",
    "keyword.modifier": "storage.modifier",
    "keyword.operator": "keyword.operator",
    "keyword.repeat": "keyword.control.loop",
    "keyword.return": "keyword.control.return",
    "keyword.type": "storage.type",
    label: "entity.name.label",
    nospell: null,
    number: "constant.numeric.integer",
    "number.float": "constant.numeric.float",
    operator: "keyword.operator",
    "punctuation.bracket": "punctuation.section.brackets",
    "punctuation.delimiter": "punctuation.separator",
    "punctuation.special": "punctuation.section.embedded",
    spell: null,
    string: "string.quoted",
    "string.escape": "constant.character.escape",
    "string.regexp": "string.regexp",
    type: "entity.name.type",
    variable: "variable.other",
    "variable.builtin": "variable.language",
    "variable.member": "variable.other.member",
    "variable.parameter": "variable.parameter",
  }).map(([capture, scope]) => [capture, scope === null ? null : `${scope}.swift`]),
);

// tree-sitter-html's highlights.scm captures, as the scopes VS Code's HTML grammar gives the same tokens.
const TAG_BEGIN = "punctuation.definition.tag.begin.html";
const TAG_END = "punctuation.definition.tag.end.html";

const HTML: Record<string, Rule> = {
  tag: "entity.name.tag.html",
  "tag.error": "invalid.illegal.unrecognized-tag.html",
  constant: "meta.tag.metadata.doctype.html",
  attribute: "entity.other.attribute-name.html",
  string: "string.quoted.html",
  comment: "comment.block.html",
  "punctuation.bracket": { scope: TAG_BEGIN, byText: { ">": TAG_END, "/>": TAG_END } },
};

// tree-sitter-yaml's highlights.scm captures, as the scopes VS Code's YAML grammar gives the same tokens.
const YAML: Record<string, Rule> = {
  boolean: "constant.language.boolean.yaml",
  "constant.builtin": "constant.language.null.yaml",
  string: {
    scope: "string.unquoted.plain.out.yaml",
    byKind: {
      double_quote_scalar: "string.quoted.double.yaml",
      single_quote_scalar: "string.quoted.single.yaml",
      block_scalar: "string.unquoted.block.yaml",
    },
  },
  number: { scope: "constant.numeric.integer.yaml", byKind: { float_scalar: "constant.numeric.float.yaml" } },
  comment: "comment.line.number-sign.yaml",
  label: { scope: "entity.name.type.anchor.yaml", byKind: { alias_name: "variable.other.alias.yaml" } },
  type: "storage.type.tag-handle.yaml",
  attribute: "keyword.other.directive.yaml",
  property: "entity.name.tag.yaml",
  "punctuation.delimiter": {
    scope: "punctuation.separator.yaml",
    byText: {
      ":": "punctuation.separator.key-value.mapping.yaml",
      "-": "punctuation.definition.block.sequence.item.yaml",
      ",": "punctuation.separator.sequence.yaml",
      "?": "punctuation.definition.key-value.begin.yaml",
      "|": "keyword.control.flow.block-scalar.literal.yaml",
      ">": "keyword.control.flow.block-scalar.folded.yaml",
    },
  },
  "punctuation.bracket": {
    scope: "punctuation.definition.sequence.begin.yaml",
    byText: {
      "]": "punctuation.definition.sequence.end.yaml",
      "{": "punctuation.definition.mapping.begin.yaml",
      "}": "punctuation.definition.mapping.end.yaml",
    },
  },
  "punctuation.special": {
    scope: "punctuation.definition.alias.yaml",
    byText: {
      "&": "punctuation.definition.anchor.yaml",
      "---": "entity.other.document.begin.yaml",
      "...": "entity.other.document.end.yaml",
    },
  },
};

export const LANGUAGES: Record<string, LanguageRules> = {
  jsdoc: {
    grammar: "tree-sitter-jsdoc",
    scope: "text.jsdoc",
    extend: ["jsdoc/highlights.tm.scm"],
    captures: JSDOC,
  },
  regex: {
    grammar: "tree-sitter-regex",
    scope: "source.regex",
    extend: ["regex/highlights.tm.scm"],
    captures: REGEX,
  },
  javascript: {
    grammar: "tree-sitter-javascript",
    scope: "source.js",
    extend: ["javascript/highlights.tm.scm", "javascript/highlights-js.tm.scm", "javascript/highlights-jsx.tm.scm"],
    injectionMatch: JS_INJECTIONS,
    captures: JS,
  },
  typescript: {
    grammar: "tree-sitter-typescript",
    scope: "source.ts",
    extend: ["javascript/highlights.tm.scm", "typescript/highlights.tm.scm"],
    injectionMatch: JS_INJECTIONS,
    captures: JS,
  },
  tsx: {
    grammar: "tree-sitter-typescript",
    // tree-sitter.json lists the JSX query before JavaScript's, for the first pattern to win; the later one
    // wins now, so JavaScript's `(identifier)` and `"<"` would paint over every tag. JavaScript's own grammar
    // lists them the other way round.
    queries: [
      "queries/highlights.scm",
      "node_modules/tree-sitter-javascript/queries/highlights.scm",
      "node_modules/tree-sitter-javascript/queries/highlights-jsx.scm",
    ],
    extend: ["javascript/highlights.tm.scm", "typescript/highlights.tm.scm", "javascript/highlights-jsx.tm.scm"],
    injections: "node_modules/tree-sitter-javascript/queries/injections.scm",
    injectionMatch: JS_INJECTIONS,
    captures: JS,
  },
  kotlin: {
    grammar: "tree-sitter-kotlin",
    queries: ["queries/highlights.scm"],
    extend: ["kotlin/highlights.tm.scm"],
    captures: KOTLIN,
  },
  swift: {
    grammar: "tree-sitter-swift",
    queries: ["queries/highlights.scm"],
    captures: SWIFT,
  },
  html: {
    grammar: "tree-sitter-html",
    // tree-sitter.json's only highlights file; naming it skips the injections.scm it lists, which embeds CSS and JS.
    queries: ["queries/highlights.scm"],
    captures: HTML,
  },
  yaml: {
    grammar: "tree-sitter-yaml",
    queries: ["queries/highlights.scm"],
    captures: YAML,
  },
};
