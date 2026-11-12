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

const GO: Record<string, Rule> = {
  ...shared("go"),
  escape: "constant.character.escape.go",
  comment: {
    scope: "comment.block.go",
    byPrefix: [["//", "comment.line.double-slash.go"]],
  },
};

const RUST: Record<string, Rule> = {
  ...shared("rust"),
  "variable.builtin": "variable.language.self.rust",
  constructor: "entity.name.type.rust",
  escape: "constant.character.escape.rust",
  "function.macro": "entity.name.function.macro.rust",
  "comment.documentation": "comment.block.documentation.rust",
  comment: {
    scope: "comment.block.rust",
    byKind: { line_comment: "comment.line.double-slash.rust" },
  },
};

const RUBY: Record<string, Rule> = {
  ...shared("ruby"),
  constructor: "entity.name.type.class.ruby",
  escape: "constant.character.escape.ruby",
  embedded: "meta.embedded.line.ruby",
  "function.method.builtin": "support.function.kernel.ruby",
  "string.special.symbol": "constant.other.symbol.ruby",
  "string.special.regex": "string.regexp.classic.ruby",
  "variable.builtin": "variable.language.ruby",
  property: {
    scope: "variable.other.readwrite.instance.ruby",
    byKind: { class_variable: "variable.other.readwrite.class.ruby" },
  },
  comment: {
    scope: "comment.line.number-sign.ruby",
  },
};

// VS Code's shellscript grammar suffixes its scopes `.shell`.
const BASH: Record<string, Rule> = {
  ...shared("shell"),
  // A command's name, or a function definition's.
  function: {
    scope: "entity.name.function.call.shell",
    byKind: { word: "entity.name.function.shell" },
  },
  property: "variable.other.normal.shell",
  // A command argument starting with `-`.
  constant: "constant.other.option.shell",
  embedded: {
    scope: "meta.embedded.subshell.shell",
    byKind: { expansion: "variable.other.bracket.shell" },
  },
  comment: "comment.line.number-sign.shell",
};

// VS Code's Dockerfile grammar scopes an instruction keyword `keyword.other.special-method`.
const DOCKERFILE: Record<string, Rule | null> = {
  ...shared("dockerfile"),
  keyword: {
    scope: "keyword.other.special-method.dockerfile",
    byKind: {
      heredoc_marker: "keyword.operator.heredoc.dockerfile",
      heredoc_end: "keyword.operator.heredoc.dockerfile",
    },
  },
  string: {
    scope: "string.quoted.double.dockerfile",
    byKind: {
      single_quoted_string: "string.quoted.single.dockerfile",
      heredoc_line: "string.unquoted.heredoc.dockerfile",
    },
  },
  // An image's `:tag` and `@digest` separators, or an expansion's `$`, `{` and `}`.
  "punctuation.special": {
    scope: "punctuation.definition.variable.dockerfile",
    byText: { ":": "punctuation.separator.dockerfile", "@": "punctuation.separator.dockerfile" },
  },
  // An upper-case variable in an expansion.
  constant: "variable.other.dockerfile",
  comment: "comment.line.number-sign.dockerfile",
  // tree-sitter-dockerfile's `@none` marks an expansion as not highlighted.
  none: null,
};

// The scopes of HashiCorp's Terraform TextMate grammar (hashicorp/syntax, terraform.tmGrammar.json), which VS
// Code's Terraform extension ships. nvim-treesitter's queries name the captures.
const HCL: Record<string, Rule | null> = {
  ...shared("hcl"),
  // A top-level block's type (`resource`, `variable`); for/in/if/else in a template or a `for` expression.
  keyword: { scope: "keyword.control.hcl", byKind: { identifier: "entity.name.type.terraform" } },
  "keyword.repeat": "keyword.control.hcl",
  "keyword.conditional": "keyword.control.hcl",
  // A nested block's type (`ingress`, `lifecycle`).
  type: "entity.name.type.hcl",
  // `string`, `list` in a type constraint; `path` and `terraform` before `.root` and `.workspace`.
  "type.builtin": {
    scope: "storage.type.hcl",
    byText: { path: "variable.other.readwrite.terraform", terraform: "variable.other.readwrite.terraform" },
  },
  variable: "variable.other.readwrite.hcl",
  // `var`, `local`, `data`, `module` before an attribute access; `root`, `cwd`, `workspace` after one.
  "variable.builtin": {
    scope: "variable.other.readwrite.terraform",
    byText: {
      root: "variable.other.member.hcl",
      cwd: "variable.other.member.hcl",
      workspace: "variable.other.member.hcl",
    },
  },
  "variable.member": "variable.other.member.hcl",
  // An attribute's name, or an object key written as a bare word: highlights.tm.scm.
  "variable.declaration": "variable.other.readwrite.hcl",
  // A block's labels: highlights.tm.scm.
  label: "variable.other.enummember.hcl",
  function: "support.function.builtin.terraform",
  string: "string.quoted.double.hcl",
  "string.heredoc": "string.unquoted.heredoc.hcl",
  number: "constant.numeric.integer.hcl",
  boolean: "constant.language.hcl",
  // `null`.
  constant: "constant.language.hcl",
  comment: {
    scope: "comment.line.number-sign.hcl",
    byPrefix: [
      ["//", "comment.line.double-slash.hcl"],
      ["/*", "comment.block.hcl"],
    ],
  },
  operator: {
    scope: "keyword.operator.hcl",
    byText: {
      "!": "keyword.operator.logical.hcl",
      "&&": "keyword.operator.logical.hcl",
      "||": "keyword.operator.logical.hcl",
      "+": "keyword.operator.arithmetic.hcl",
      "-": "keyword.operator.arithmetic.hcl",
      "*": "keyword.operator.arithmetic.hcl",
      "/": "keyword.operator.arithmetic.hcl",
      "%": "keyword.operator.arithmetic.hcl",
    },
  },
  "punctuation.delimiter": {
    scope: "",
    byKind: {
      heredoc_start: "keyword.operator.heredoc.hcl",
      heredoc_identifier: "keyword.control.heredoc.hcl",
    },
    byText: {
      ".": "keyword.operator.accessor.hcl",
      ",": "punctuation.separator.hcl",
      ".*": "keyword.operator.splat.hcl",
      "[*]": "keyword.operator.splat.hcl",
    },
  },
  // `${` `%{` and their `}`, a `~` strip marker, `...`, `?`, `=>`.
  "punctuation.special": {
    scope: "keyword.operator.hcl",
    byKind: {
      template_interpolation_start: "keyword.other.interpolation.begin.hcl",
      template_directive_start: "keyword.other.interpolation.begin.hcl",
      template_interpolation_end: "keyword.other.interpolation.end.hcl",
      template_directive_end: "keyword.other.interpolation.end.hcl",
      strip_marker: "keyword.operator.template.left.trim.hcl",
    },
    byText: { "=>": "storage.type.function.hcl" },
  },
  spell: null,
  none: null,
};

// VS Code's SQL grammar scopes most keywords `keyword.other.sql` and sorts a few into their own groups. Each
// tree-sitter-sql keyword is its own node kind, so the groups go by kind across every keyword capture.
const SQL_KEYWORD_GROUPS: Record<string, string[]> = {
  "keyword.other.DML.sql": [
    "select", "insert", "into", "update", "delete", "from", "set", "where", "group", "order", "by", "or", "and",
    "like", "union", "distinct", "having", "limit", "join", "cross", "inner", "left", "right", "full", "outer",
    "natural", "ignore",
  ],
  "keyword.other.DML.II.sql": ["values"],
  "keyword.other.create.sql": ["create", "drop", "alter", "replace"],
  "keyword.other.DDL.create.II.sql": ["null", "on", "off"],
  "keyword.other.LUW.sql": ["begin", "commit", "rollback"],
  "keyword.other.authorization.sql": ["grant", "revoke"],
  "keyword.other.data-integrity.sql": ["in"],
  "keyword.other.alias.sql": ["as"],
  "keyword.other.order.sql": ["asc", "desc"],
  "storage.modifier.sql": [
    "primary", "foreign", "key", "references", "check", "constraint", "collate", "default", "cascade",
  ],
};
const SQL_KEYWORD: Rule = {
  scope: "keyword.other.sql",
  byKind: Object.fromEntries(
    Object.entries(SQL_KEYWORD_GROUPS).flatMap(([scope, words]) =>
      words.map((word): [string, string] => [`keyword_${word}`, scope]),
    ),
  ),
};

const SQL: Record<string, Rule | null> = {
  ...shared("sql"),
  keyword: SQL_KEYWORD,
  conditional: SQL_KEYWORD,
  attribute: SQL_KEYWORD,
  storageclass: SQL_KEYWORD,
  "type.qualifier": SQL_KEYWORD,
  "keyword.operator": SQL_KEYWORD,
  // A built-in type, and `NULL`, which the upstream query lists with them.
  "type.builtin": { scope: "storage.type.sql", byKind: { keyword_null: "keyword.other.DDL.create.II.sql" } },
  // VS Code's grammar leaves `TRUE` and `FALSE` unscoped.
  boolean: "",
  // A table, view or other object a statement names. VS Code's grammar scopes the table of a `schema.table`.
  type: "constant.other.table-name.sql",
  // VS Code's grammar scopes a built-in function `support.function.<category>.sql`.
  "function.call": "support.function.sql",
  string: "string.quoted.single.sql",
  number: "constant.numeric.sql",
  float: "constant.numeric.sql",
  comment: { scope: "comment.line.double-dash.sql", byKind: { marginalia: "comment.block" } },
  spell: null,
  // A column, and a table or column alias: VS Code's grammar leaves an unqualified name unscoped.
  field: "",
  operator: {
    scope: "keyword.operator.sql",
    byText: {
      "*": "keyword.operator.star.sql",
      "=": "keyword.operator.comparison.sql",
      "!=": "keyword.operator.comparison.sql",
      "<>": "keyword.operator.comparison.sql",
      "<": "keyword.operator.comparison.sql",
      "<=": "keyword.operator.comparison.sql",
      ">": "keyword.operator.comparison.sql",
      ">=": "keyword.operator.comparison.sql",
      "+": "keyword.operator.math.sql",
      "-": "keyword.operator.math.sql",
      "/": "keyword.operator.math.sql",
      "||": "keyword.operator.concatenator.sql",
    },
  },
};

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

// tree-sitter-graphql's highlights.scm captures. VS Code ships no GraphQL grammar to match, so they are the shared
// generic scopes, a field or variable painted as one and a comment as a line comment.
const GRAPHQL: Record<string, Rule> = {
  ...shared("graphql"),
  variable: "variable.other.graphql",
  property: "variable.other.property.graphql",
  comment: { scope: "comment.line.number-sign.graphql", byKind: { description: "string.quoted.double.graphql" } },
};

// tree-sitter-json's captures, as the scopes VS Code's JSON grammar gives the same tokens.
const JSON_CAPTURES: Record<string, Rule> = {
  "string.special.key": "support.type.property-name.json",
  string: "string.quoted.double.json",
  number: "constant.numeric.json",
  "constant.builtin": "constant.language.json",
  escape: "constant.character.escape.json",
  comment: { scope: "comment.block.json", byPrefix: [["//", "comment.line.double-slash.json"]] },
};

// tree-sitter-css's captures, as the scopes VS Code's CSS grammar gives the same tokens.
const CSS: Record<string, Rule> = {
  comment: "comment.block.css",
  tag: {
    scope: "entity.name.tag.css",
    byKind: { nesting_selector: "entity.name.tag.nesting.css", universal_selector: "entity.name.tag.wildcard.css" },
  },
  operator: {
    scope: "keyword.operator.css",
    byText: {
      ">": "keyword.operator.combinator.css",
      "~": "keyword.operator.combinator.css",
      and: "keyword.operator.logical.and.media.css",
      or: "keyword.operator.logical.or.media.css",
      not: "keyword.operator.logical.not.media.css",
      only: "keyword.operator.logical.only.media.css",
    },
  },
  string: {
    scope: "string.quoted.double.css",
    byKind: { plain_value: "string.unquoted.attribute-value.css" },
    byPrefix: [["'", "string.quoted.single.css"]],
  },
  variable: "variable.css",
  property: {
    scope: "support.type.property-name.css",
    byKind: {
      class_name: "entity.other.attribute-name.class.css",
      id_name: "entity.other.attribute-name.id.css",
      namespace_name: "entity.other.namespace-prefix.css",
      feature_name: "support.type.property-name.media.css",
    },
  },
  attribute: {
    scope: "entity.other.attribute-name.css",
    byKind: {
      tag_name: "entity.other.attribute-name.pseudo-element.css",
      class_name: "entity.other.attribute-name.pseudo-class.css",
    },
  },
  function: "support.function.misc.css",
  keyword: {
    scope: "keyword.control.at-rule.css",
    byKind: {
      to: "entity.other.keyframe-offset.css",
      from: "entity.other.keyframe-offset.css",
      important: "keyword.other.important.css",
    },
  },
  "string.special": "constant.other.color.rgb-value.hex.css",
  number: "constant.numeric.css",
  type: "keyword.other.unit.css",
  "punctuation.delimiter": {
    scope: "punctuation.separator.css",
    byText: {
      "#": "punctuation.definition.entity.css",
      ".": "punctuation.definition.entity.css",
      "::": "punctuation.definition.entity.css",
      ",": "punctuation.separator.list.comma.css",
      ":": "punctuation.separator.key-value.css",
      ";": "punctuation.terminator.rule.css",
    },
  },
  "punctuation.bracket": {
    scope: "punctuation.section.css",
    byText: {
      "{": "punctuation.section.property-list.begin.bracket.curly.css",
      "}": "punctuation.section.property-list.end.bracket.curly.css",
      "(": "punctuation.section.function.begin.bracket.round.css",
      ")": "punctuation.section.function.end.bracket.round.css",
    },
  },
};

/** A string's prefix letters (`r`, `b`, `f`, `u` and their pairs), before its opening quote. */
const PY_STRING_PREFIXES = ["", ...["r", "b", "u", "f", "rb", "br", "fr", "rf"].flatMap((p) => [p, p.toUpperCase()])];
const PY_ASSIGNMENT = ["=", ":=", "+=", "-=", "*=", "/=", "//=", "%=", "**=", "@=", "&=", "|=", "^=", "<<=", ">>="];

// tree-sitter-python's own highlights.scm, as the scopes VS Code's Python grammar (MagicPython) gives the same
// tokens. It captures a function's name the same way at a definition, a call and a decorator.
const PYTHON: Record<string, Rule> = {
  variable: "",
  // `^[A-Z]` identifiers: MagicPython colours a capitalised name like any other; an all-caps one is a constant.
  constructor: "",
  constant: "constant.other.caps.python",
  "constant.builtin": "constant.language.python",
  function: { scope: "entity.name.function.python", byKind: { decorator: "entity.name.function.decorator.python" } },
  "function.method": "entity.name.function.python",
  "function.builtin": "support.function.builtin.python",
  property: "meta.attribute.python",
  type: "entity.name.type.python",
  number: {
    scope: "constant.numeric.dec.python",
    byKind: { float: "constant.numeric.float.python" },
    byPrefix: [
      ...["0x", "0X"].map((p): [string, string] => [p, "constant.numeric.hex.python"]),
      ...["0o", "0O"].map((p): [string, string] => [p, "constant.numeric.oct.python"]),
      ...["0b", "0B"].map((p): [string, string] => [p, "constant.numeric.bin.python"]),
    ],
  },
  comment: "comment.line.number-sign.python",
  string: {
    scope: "string.quoted.single.python",
    byPrefix: PY_STRING_PREFIXES.flatMap((p): [string, string][] => [
      [`${p}"""`, "string.quoted.multi.python"],
      [`${p}'''`, "string.quoted.multi.python"],
      [`${p}"`, "string.quoted.double.python"],
    ]),
  },
  escape: "constant.character.escape.python",
  "punctuation.special": "constant.character.format.placeholder.other.python",
  embedded: "meta.fstring.python",
  operator: {
    scope: "keyword.operator.arithmetic.python",
    byText: {
      ...Object.fromEntries(PY_ASSIGNMENT.map((o) => [o, "keyword.operator.assignment.python"])),
      ...Object.fromEntries(
        ["==", "!=", "<>", "<", ">", "<=", ">="].map((o) => [o, "keyword.operator.comparison.python"]),
      ),
      ...Object.fromEntries(["&", "|", "^", "~", "<<", ">>"].map((o) => [o, "keyword.operator.bitwise.python"])),
      ...Object.fromEntries(
        ["and", "or", "not", "in", "is", "is not", "not in"].map((o) => [o, "keyword.operator.logical.python"]),
      ),
      "->": "punctuation.separator.annotation.result.python",
    },
  },
  keyword: {
    scope: "keyword.control.flow.python",
    byText: {
      def: "storage.type.function.python",
      class: "storage.type.class.python",
      lambda: "storage.type.function.lambda.python",
      async: "storage.type.function.async.python",
      import: "keyword.control.import.python",
      from: "keyword.control.import.python",
      global: "storage.modifier.declaration.python",
      nonlocal: "storage.modifier.declaration.python",
    },
  },
};

// The scopes of VS Code's markdown TextMate grammar (markdown-basics), on the joined block and inline tree.
const MARKDOWN: Record<string, Rule> = {
  "text.title": "markup.heading.markdown",
  "punctuation.special": {
    scope: "punctuation.definition.heading.markdown",
    byKind: {
      list_marker_plus: "punctuation.definition.list.begin.markdown",
      list_marker_minus: "punctuation.definition.list.begin.markdown",
      list_marker_star: "punctuation.definition.list.begin.markdown",
      list_marker_dot: "punctuation.definition.list.begin.markdown",
      list_marker_parenthesis: "punctuation.definition.list.begin.markdown",
      thematic_break: "meta.separator.markdown",
      block_quote_marker: "punctuation.definition.quote.begin.markdown",
      // A list item's indentation; highlights.tm.scm paints a continuation that holds `>`.
      block_continuation: "",
    },
  },
  "heading.1": "heading.1.markdown",
  "heading.2": "heading.2.markdown",
  "heading.3": "heading.3.markdown",
  "heading.4": "heading.4.markdown",
  "heading.5": "heading.5.markdown",
  "heading.6": "heading.6.markdown",
  quote: "markup.quote.markdown",
  "quote.marker": "punctuation.definition.quote.begin.markdown",
  table: "markup.table.markdown",
  "table.delimiter": "punctuation.definition.table.markdown",
  "fence.language": "fenced_code.block.language.markdown",
  "text.strike": "markup.strikethrough.markdown",
  comment: "comment.block.html.markdown",
  "text.literal": {
    scope: "markup.inline.raw.string.markdown",
    byKind: {
      fenced_code_block: "markup.fenced_code.block.markdown",
      indented_code_block: "markup.raw.block.markdown",
      link_title: "string.other.link.description.title.markdown",
    },
  },
  "punctuation.delimiter": "punctuation.definition.markdown",
  "text.uri": "markup.underline.link.markdown",
  "text.reference": {
    scope: "string.other.link.title.markdown",
    byKind: {
      link_label: "constant.other.reference.link.markdown",
      image_description: "string.other.link.description.markdown",
    },
  },
  "string.escape": "constant.character.escape.markdown",
  "text.emphasis": "markup.italic.markdown",
  "text.strong": "markup.bold.markdown",
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
  go: {
    grammar: "tree-sitter-go",
    queries: ["queries/highlights.scm"],
    captures: GO,
  },
  rust: {
    grammar: "tree-sitter-rust",
    queries: ["queries/highlights.scm"],
    captures: RUST,
  },
  ruby: {
    grammar: "tree-sitter-ruby",
    queries: ["queries/highlights.scm"],
    captures: RUBY,
  },
  bash: {
    grammar: "tree-sitter-bash",
    queries: ["queries/highlights.scm"],
    captures: BASH,
  },
  dockerfile: {
    grammar: "tree-sitter-dockerfile",
    queries: ["queries/highlights.scm"],
    captures: DOCKERFILE,
  },
  hcl: {
    grammar: "tree-sitter-hcl",
    // tree-sitter-hcl ships no queries; nvim-treesitter's Terraform query extends its HCL one.
    queries: ["runtime/queries/hcl/highlights.scm", "runtime/queries/terraform/highlights.scm"],
    extend: ["hcl/highlights.tm.scm"],
    captures: HCL,
  },
  sql: {
    grammar: "tree-sitter-sql",
    queries: ["queries/highlights.scm"],
    captures: SQL,
  },
  markdown: {
    grammar: "tree-sitter-markdown",
    // The block grammar's queries, then the inline grammar's: grammars/markdown parses both into one tree.
    // Neither injection query is read: the joined tree already holds the inline nodes.
    queries: [
      "tree-sitter-markdown/queries/highlights.scm",
      "tree-sitter-markdown-inline/queries/highlights.scm",
    ],
    extend: ["markdown/highlights.tm.scm"],
    captures: MARKDOWN,
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
  graphql: {
    grammar: "tree-sitter-graphql",
    queries: ["queries/graphql/highlights.scm"],
    captures: GRAPHQL,
  },
  json: {
    grammar: "tree-sitter-json",
    scope: "source.json",
    extend: ["json/highlights.tm.scm"],
    captures: JSON_CAPTURES,
  },
  css: {
    grammar: "tree-sitter-css",
    scope: "source.css",
    captures: CSS,
  },
  python: {
    grammar: "tree-sitter-python",
    scope: "source.python",
    captures: PYTHON,
  },
};
