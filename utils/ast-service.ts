/**
 * Tree-sitter analysis core. Pure functions over a parsed tree — the same
 * code runs in the extension service worker (WASM is CSP-blocked on
 * github.com pages) and in node self-checks.
 */

import type { Node } from 'web-tree-sitter';

/** 1-based, inclusive. */
export interface LineRange {
  start: number;
  end: number;
}

export interface ScopeRange extends LineRange {
  kind: string;
  name: string;
}

export interface InjectionRange extends LineRange {
  lang: string;
}

export interface FileAnalysis {
  scopeRanges: ScopeRange[];
  importRanges: LineRange[];
  injectionRanges: InjectionRange[];
  docCommentRanges: LineRange[];
}

export interface SemanticHunk {
  name: string;
  kind: string;
  change: 'added' | 'removed' | 'modified';
  oldRange?: LineRange;
  newRange?: LineRange;
}

const GRAMMAR_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  css: 'css',
};

export function grammarForPath(path: string): string | null {
  const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : '';
  return GRAMMAR_BY_EXT[ext] ?? null;
}

const SCOPE_KINDS: Record<string, string> = {
  function_declaration: 'function',
  generator_function_declaration: 'function',
  class_declaration: 'class',
  abstract_class_declaration: 'class',
  method_definition: 'method',
  interface_declaration: 'interface',
  enum_declaration: 'enum',
  type_alias_declaration: 'type',
  internal_module: 'namespace',
};

const INJECTION_TAGS: Record<string, string> = {
  css: 'css',
  html: 'html',
  sql: 'sql',
  gql: 'graphql',
  graphql: 'graphql',
};

function lineRange(node: Node): LineRange {
  return { start: node.startPosition.row + 1, end: node.endPosition.row + 1 };
}

function nodeName(node: Node): string {
  return node.childForFieldName('name')?.text ?? '';
}

export function analyzeTree(root: Node): FileAnalysis {
  const analysis: FileAnalysis = {
    scopeRanges: [],
    importRanges: [],
    injectionRanges: [],
    docCommentRanges: [],
  };
  const visit = (node: Node) => {
    const { type } = node;
    if (type === 'import_statement') {
      analysis.importRanges.push(lineRange(node));
    } else if (type === 'comment' && node.text.startsWith('/**')) {
      analysis.docCommentRanges.push(lineRange(node));
    } else if (SCOPE_KINDS[type]) {
      analysis.scopeRanges.push({
        ...lineRange(node),
        kind: SCOPE_KINDS[type],
        name: nodeName(node),
      });
    } else if (type === 'variable_declarator') {
      const value = node.childForFieldName('value');
      if (
        value &&
        (value.type === 'arrow_function' || value.type === 'function_expression')
      ) {
        analysis.scopeRanges.push({
          ...lineRange(node),
          kind: 'function',
          name: nodeName(node),
        });
      }
    } else if (type === 'call_expression') {
      const fn = node.childForFieldName('function');
      const args = node.childForFieldName('arguments');
      const tag = fn && INJECTION_TAGS[fn.text];
      if (tag && args?.type === 'template_string') {
        analysis.injectionRanges.push({ ...lineRange(args), lang: tag });
      }
    }
    for (const child of node.namedChildren) {
      if (child) visit(child);
    }
  };
  visit(root);
  return analysis;
}

/**
 * Token stream with comments and whitespace stripped — equal normalized
 * text means "same code", which powers both the structural diff and
 * moved-code matching.
 */
export function normalizedText(node: Node): string {
  let out = '';
  const visit = (n: Node) => {
    if (n.type === 'comment') return;
    if (n.childCount === 0) {
      out += n.text + '\x1f';
      return;
    }
    for (const child of n.children) {
      if (child) visit(child);
    }
  };
  visit(node);
  return out;
}

interface TopDecl {
  name: string;
  kind: string;
  range: LineRange;
  norm: string;
}

function topLevelDecls(root: Node): TopDecl[] {
  const out: TopDecl[] = [];
  for (const child of root.namedChildren) {
    if (!child) continue;
    let n: Node = child;
    if (n.type === 'export_statement') {
      const inner = n.namedChildren.find(
        (c) =>
          c &&
          (SCOPE_KINDS[c.type] ||
            c.type === 'lexical_declaration' ||
            c.type === 'variable_declaration'),
      );
      if (inner) n = inner;
    }
    if (SCOPE_KINDS[n.type]) {
      out.push({
        name: nodeName(n),
        kind: SCOPE_KINDS[n.type],
        range: lineRange(child),
        norm: normalizedText(n),
      });
    } else if (
      n.type === 'lexical_declaration' ||
      n.type === 'variable_declaration'
    ) {
      for (const decl of n.namedChildren) {
        if (decl?.type !== 'variable_declarator') continue;
        out.push({
          name: nodeName(decl),
          kind: 'variable',
          range: lineRange(child),
          norm: normalizedText(decl),
        });
      }
    }
  }
  return out;
}

export function structuralDiffTrees(
  oldRoot: Node,
  newRoot: Node,
): SemanticHunk[] {
  const olds = topLevelDecls(oldRoot);
  const news = topLevelDecls(newRoot);
  const key = (d: TopDecl) => `${d.kind}:${d.name}`;
  const oldMap = new Map(olds.map((d) => [key(d), d]));
  const newMap = new Map(news.map((d) => [key(d), d]));
  const hunks: SemanticHunk[] = [];
  for (const d of olds) {
    if (!newMap.has(key(d))) {
      hunks.push({
        name: d.name,
        kind: d.kind,
        change: 'removed',
        oldRange: d.range,
      });
    }
  }
  for (const d of news) {
    const old = oldMap.get(key(d));
    if (!old) {
      hunks.push({
        name: d.name,
        kind: d.kind,
        change: 'added',
        newRange: d.range,
      });
    } else if (old.norm !== d.norm) {
      hunks.push({
        name: d.name,
        kind: d.kind,
        change: 'modified',
        oldRange: old.range,
        newRange: d.range,
      });
    }
  }
  return hunks;
}

export interface DeclHashInfo {
  name: string;
  kind: string;
  start: number;
  end: number;
  hash: string;
  size: number;
}

/** Normalized-token hashes of top-level declarations (moved-code input). */
export function declHashes(root: Node): DeclHashInfo[] {
  return topLevelDecls(root).map((d) => {
    let h = 5381;
    for (let i = 0; i < d.norm.length; i++) {
      h = ((h << 5) + h + d.norm.charCodeAt(i)) | 0;
    }
    return {
      name: d.name,
      kind: d.kind,
      start: d.range.start,
      end: d.range.end,
      hash: (h >>> 0).toString(36),
      size: d.norm.length,
    };
  });
}

/** Smallest scope containing the line, or the chain outside-in. */
export function scopeChainAt(
  scopes: ScopeRange[],
  line: number,
): ScopeRange[] {
  return scopes
    .filter((s) => s.start <= line && line <= s.end)
    .sort((a, b) => a.start - b.start || b.end - a.end);
}
