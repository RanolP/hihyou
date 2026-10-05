// The grammar packages syntechs builds a language from, by bundle name: compile.node.ts writes each bundle.js,
// and src/highlight/generate.node.ts each highlight.gen.ts.

/** Per bundle: the grammar's generated src/ directory, and which of its extras are comments. */
export const GRAMMARS: Record<string, { src: string; comments: string[] }> = {
  json: { src: "tree-sitter-json/src", comments: ["comment"] },
  css: { src: "tree-sitter-css/src", comments: ["comment"] },
  html: { src: "tree-sitter-html/src", comments: ["comment"] },
  // `html_comment` is Annex B's `<!--` and a line-leading `-->`, each a comment to the end of its line.
  javascript: {
    src: "tree-sitter-javascript/src",
    comments: ["comment", "html_comment"],
  },
  typescript: {
    src: "tree-sitter-typescript/typescript/src",
    comments: ["comment", "html_comment"],
  },
  tsx: {
    src: "tree-sitter-typescript/tsx/src",
    comments: ["comment", "html_comment"],
  },
  python: { src: "tree-sitter-python/src", comments: ["comment"] },
  kotlin: {
    src: "tree-sitter-kotlin/src",
    comments: ["line_comment", "multiline_comment"],
  },
  swift: {
    src: "tree-sitter-swift/src",
    comments: ["comment", "multiline_comment"],
  },
  yaml: { src: "tree-sitter-yaml/src", comments: ["comment"] },
  // Injected into JavaScript and TypeScript comments and regex literals by their injections.scm.
  jsdoc: { src: "tree-sitter-jsdoc/src", comments: [] },
  regex: { src: "tree-sitter-regex/src", comments: [] },
};
