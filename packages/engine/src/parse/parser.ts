import { Language, Parser } from "web-tree-sitter";
import { grammarWasm, type LanguageId } from "./languages.js";
import {
  type SyntaxNode,
  type SyntaxParser,
  type SyntaxTree,
  syntaxTree,
} from "./tree.js";

/** Returns the grammar's WASM bytes, or a URL/path web-tree-sitter can fetch. `wasm` is from the registry. */
export type GrammarLocator = (
  lang: LanguageId,
  wasm: string,
) => Promise<Uint8Array | string>;

export interface SyntaxParserOptions {
  locateGrammar: GrammarLocator;
  /** Passed to `Parser.init`, e.g. `locateFile` for where a browser bundle serves `web-tree-sitter.wasm`. */
  runtime?: Parameters<typeof Parser.init>[0];
}

let runtimeReady: Promise<void> | undefined;

export function createSyntaxParser({
  locateGrammar,
  runtime,
}: SyntaxParserOptions): SyntaxParser {
  const languages = new Map<LanguageId, Promise<Language>>();
  const language = (lang: LanguageId) => {
    let l = languages.get(lang);
    if (!l) {
      l = (async () => {
        runtimeReady ??= Parser.init(runtime);
        await runtimeReady;
        return Language.load(await locateGrammar(lang, grammarWasm(lang)));
      })();
      languages.set(lang, l);
    }
    return l;
  };

  return {
    async parse(lang, text) {
      const grammar = await language(lang);
      const parser = new Parser();
      try {
        parser.setLanguage(grammar);
        const tree = parser.parse(text);
        if (!tree) throw new Error(`tree-sitter returned no tree for ${lang}`);
        try {
          return toSyntaxTree(tree.walk(), text);
        } finally {
          tree.delete();
        }
      } finally {
        parser.delete();
      }
    },
  };
}

type Cursor = ReturnType<NonNullable<ReturnType<Parser["parse"]>>["walk"]>;

function toSyntaxTree(cursor: Cursor, text: string): SyntaxTree {
  const nodes: SyntaxNode[] = [];
  const layout = new Set<SyntaxNode>();
  let errorChars = 0;
  const open = (parent: SyntaxNode | undefined): SyntaxNode => {
    const node: SyntaxNode = {
      id: nodes.length,
      kind: cursor.nodeType,
      named: cursor.nodeIsNamed,
      field: cursor.currentFieldName ?? undefined,
      missing: cursor.nodeIsMissing,
      label: "",
      start: cursor.startIndex,
      end: cursor.endIndex,
      parent,
      children: [],
      height: 1,
      size: 1,
    };
    nodes.push(node);
    parent?.children.push(node);
    if (node.kind === "ERROR" && !insideError(parent))
      errorChars += node.end - node.start;
    return node;
  };
  const close = (node: SyntaxNode) => {
    if (node.children.length === 0) {
      const token = text.slice(node.start, node.end);
      // Comments and JSX text are the tokens whose inner whitespace is layout, not content (re-indenting a
      // doc block, re-wrapping a paragraph). Whitespace inside strings stays significant.
      if (node.kind.includes("comment"))
        node.label = token.replace(/\s+/g, " ");
      else if (node.kind === "jsx_text") {
        node.label = jsxText(token);
        if (node.label === "") layout.add(node);
      } else node.label = token;
    }
    for (const c of node.children) {
      node.height = Math.max(node.height, c.height + 1);
      node.size += c.size;
    }
  };

  // Iterative walk: deep trees must not overflow the JS stack.
  let node = open(undefined);
  try {
    for (;;) {
      if (cursor.gotoFirstChild()) {
        node = open(node);
        continue;
      }
      for (;;) {
        close(node);
        if (cursor.gotoNextSibling()) {
          node = open(node.parent);
          break;
        }
        if (!cursor.gotoParent() || !node.parent)
          return syntaxTree(withoutLeaves(nodes, layout), errorChars);
        node = node.parent;
      }
    }
  } finally {
    cursor.delete();
  }
}

/**
 * JSX text as JSX evaluates it (lines trimmed where they meet a line break, blank lines dropped, the rest
 * joined by one space), with the remaining whitespace runs collapsed as HTML renders them. "" means the text
 * is only layout between elements.
 */
function jsxText(token: string): string {
  const lines = token.split(/\r\n|\n|\r/);
  return lines
    .map((line, i) => {
      let t = line;
      if (i > 0) t = t.trimStart();
      if (i < lines.length - 1) t = t.trimEnd();
      return t;
    })
    .filter((t) => t !== "")
    .join(" ")
    .replace(/\s+/g, " ");
}

/** The tree without the given leaves, re-numbered in preorder with sizes and heights recomputed. */
function withoutLeaves(
  nodes: SyntaxNode[],
  drop: Set<SyntaxNode>,
): SyntaxNode[] {
  if (drop.size === 0) return nodes;
  const kept = nodes.filter((n) => !drop.has(n));
  for (const [id, n] of kept.entries()) {
    n.id = id;
    n.children = n.children.filter((c) => !drop.has(c));
    n.height = 1;
    n.size = 1;
  }
  for (const n of kept.toReversed())
    for (const c of n.children) {
      n.height = Math.max(n.height, c.height + 1);
      n.size += c.size;
    }
  return kept;
}

function insideError(node: SyntaxNode | undefined): boolean {
  for (let n = node; n; n = n.parent) if (n.kind === "ERROR") return true;
  return false;
}
