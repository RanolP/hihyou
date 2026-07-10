// Self-check: node utils/ast-service.check.ts
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Language, Parser } from 'web-tree-sitter';
import {
  analyzeTree,
  grammarForPath,
  normalizedText,
  scopeChainAt,
  structuralDiffTrees,
} from './ast-service.ts';

const require = createRequire(import.meta.url);
const wasmDir = path.dirname(
  require.resolve('@vscode/tree-sitter-wasm/package.json'),
);

await Parser.init();
const ts = await Language.load(
  path.join(wasmDir, 'wasm/tree-sitter-typescript.wasm'),
);
const parser = new Parser();
parser.setLanguage(ts);

const sample = `import { a } from './a';
import type { B } from './b';

/**
 * Greets someone.
 */
export function greet(name: string): string {
  return \`hi \${name}\`;
}

export class Box {
  value = 1;
  read(): number {
    return this.value;
  }
}

const styles = css\`
  .x { color: red; }
\`;

export const shout = (s: string) => s.toUpperCase();
`;

const tree = parser.parse(sample)!;
const analysis = analyzeTree(tree.rootNode);

assert.equal(analysis.importRanges.length, 2);
assert.deepEqual(analysis.importRanges[0], { start: 1, end: 1 });
assert.equal(analysis.docCommentRanges.length, 1);
assert.deepEqual(analysis.docCommentRanges[0], { start: 4, end: 6 });

const scopeNames = analysis.scopeRanges.map((s) => `${s.kind}:${s.name}`);
assert.ok(scopeNames.includes('function:greet'));
assert.ok(scopeNames.includes('class:Box'));
assert.ok(scopeNames.includes('method:read'));
assert.ok(scopeNames.includes('function:shout'));

assert.equal(analysis.injectionRanges.length, 1);
assert.equal(analysis.injectionRanges[0].lang, 'css');

// Scope chain at a line inside Box.read: class then method.
const chain = scopeChainAt(analysis.scopeRanges, 14);
assert.deepEqual(
  chain.map((s) => s.name),
  ['Box', 'read'],
);

// Normalized text ignores comments and whitespace.
const t1 = parser.parse('function f() {\n  return 1; // x\n}')!;
const t2 = parser.parse('function f() { return 1; }')!;
assert.equal(
  normalizedText(t1.rootNode),
  normalizedText(t2.rootNode),
);

// Structural diff: modified declaration + added one.
const oldTree = parser.parse('export function a() { return 1; }\nconst k = 1;')!;
const newTree = parser.parse(
  'export function a() { return 2; }\nconst k = 1;\nfunction b() {}',
)!;
const hunks = structuralDiffTrees(oldTree.rootNode, newTree.rootNode);
assert.deepEqual(
  hunks.map((h) => `${h.change}:${h.kind}:${h.name}`).sort(),
  ['added:function:b', 'modified:function:a'],
);

// Whitespace-only change is NOT a semantic hunk.
const wsTree = parser.parse('export function a() {\n  return 1;\n}\nconst k = 1;')!;
assert.equal(
  structuralDiffTrees(oldTree.rootNode, wsTree.rootNode).length,
  0,
);

assert.equal(grammarForPath('src/x.ts'), 'typescript');
assert.equal(grammarForPath('src/x.tsx'), 'tsx');
assert.equal(grammarForPath('a.css'), 'css');
assert.equal(grammarForPath('a.rb'), null);

console.log('ast-service: all checks passed');
