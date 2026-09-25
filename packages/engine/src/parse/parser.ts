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
  let errorChars = 0;
  const open = (parent: SyntaxNode | undefined): SyntaxNode => {
    const node: SyntaxNode = {
      id: nodes.length,
      kind: cursor.nodeType,
      named: cursor.nodeIsNamed,
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
      // A comment is the one token whose inner whitespace is layout, not content (re-indenting a doc block).
      // Whitespace inside strings stays significant.
      node.label = node.kind.includes("comment")
        ? token.replace(/\s+/g, " ")
        : token;
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
          return syntaxTree(nodes, errorChars);
        node = node.parent;
      }
    }
  } finally {
    cursor.delete();
  }
}

function insideError(node: SyntaxNode | undefined): boolean {
  for (let n = node; n; n = n.parent) if (n.kind === "ERROR") return true;
  return false;
}
