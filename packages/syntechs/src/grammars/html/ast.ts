// The kinds and fields of prettier's HTML AST as print.ts builds it, for the formatter DSL (format.ts). Prettier lays
// out its own AST, not tree-sitter-html's: a text is its words, an attribute its printed value, a script's content
// its language's. So print.ts builds this tree from the one it parses, and format.ts lays this one out.
import type { Language } from "../../core/language.js";
import type { DslGrammar } from "../../fmt/dsl/dsl.js";

/** Children in a flow: what prettier's printChildren lays out. */
const FLOW = [
  "element",
  "embedded_element",
  "preserved_element",
  "text",
  "comment",
  "ignored",
  "doc_type",
  "ie_conditional_marker",
] as const;
const ATTRIBUTES = [
  "plain_attribute",
  "quoted_attribute",
  "style_attribute",
  "event_handler_attribute",
  "srcset_attribute",
  "allow_attribute",
] as const;

const list = <const T extends readonly string[]>(types: T) => ({ required: false, multiple: true, types }) as const;
const one = <const T extends readonly string[]>(types: T) => ({ required: true, multiple: false, types }) as const;
const attrs = { attrs: list(ATTRIBUTES) } as const;

export const grammar = {
  kinds: [
    "root",
    "front_matter",
    "front_line",
    ...FLOW,
    "raw_text",
    "raw_line",
    "embedded_code",
    ...ATTRIBUTES,
    "declaration",
    "css_declaration",
    "js_program",
    "candidate",
    "directive",
  ],
  tokens: [],
  fields: {
    root: ["frontMatter"],
    element: ["attrs"],
    embedded_element: ["attrs", "content"],
    preserved_element: ["attrs"],
    declaration: ["code"],
    event_handler_attribute: ["code"],
  },
  comments: [],
  fieldTypes: {
    root: { frontMatter: { required: false, multiple: false, types: ["front_matter"] } },
    element: attrs,
    embedded_element: { ...attrs, content: one(["raw_text", "embedded_code"]) },
    preserved_element: attrs,
    declaration: { code: one(["css_declaration"]) },
    event_handler_attribute: { code: one(["js_program"]) },
  },
  childTypes: {
    root: list(FLOW),
    front_matter: list(["front_line"]),
    element: list(FLOW),
    raw_text: list(["raw_line"]),
    style_attribute: list(["declaration"]),
    srcset_attribute: list(["candidate"]),
    allow_attribute: list(["directive"]),
  },
} as const satisfies DslGrammar;

export type Kind = (typeof grammar.kinds)[number];
export type Field = "frontMatter" | "attrs" | "content" | "code";

const FIELDS: readonly Field[] = ["frontMatter", "attrs", "content", "code"];

/** The arena's view of the grammar: symbol 0 is the end symbol, field 0 none. */
export const language = {
  name: "html_ast",
  symbolNames: ["end", ...grammar.kinds],
  fieldNames: ["", ...FIELDS],
} as unknown as Language;

export const kindId = (k: Kind): number => grammar.kinds.indexOf(k) + 1;
export const fieldId = (f: Field | undefined): number => (f === undefined ? 0 : FIELDS.indexOf(f) + 1);
