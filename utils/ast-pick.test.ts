import { createRequire } from 'node:module';
import path from 'node:path';
import { Language, Parser } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { nodeRangeAt } from './ast-service';

// The exact reported scenario: clicking a deleted row inside
// wireVibeInfra must pick the { ... } type-literal node, not the function.
const OLD_TEXT = `export function wireVibeInfra<M extends VibeManifest>(
  manifest: M,
): {
  defineAction: TypedDefineAction<M>;
  defineApp: (actions: Record<string, RegisterableAction>) => VibeApp<M>;
} {
  return {
    defineAction: defineAction as unknown as TypedDefineAction<M>,
    defineApp: (actions) => createApp(manifest, actions),
  };
}
`;

const NEW_TEXT = `export function wireVibeInfra<M extends VibeManifest>(
  manifest: M,
): {
  defineAction: DefineAction<VibeVars<M>>;
  defineApp: (actions: Record<string, RegisterableAction>) => VibeApp<M>;
} {
  return {
    defineAction: createDefineAction<VibeVars<M>>(),
    defineApp: (actions) => createApp(manifest, actions),
  };
}
`;

let parser: Parser;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasmDir = path.join(
    path.dirname(require.resolve('@vscode/tree-sitter-wasm/package.json')),
    'wasm',
  );
  await Parser.init();
  const ts = await Language.load(
    path.join(wasmDir, 'tree-sitter-typescript.wasm'),
  );
  parser = new Parser();
  parser.setLanguage(ts);
});

describe('nodeRangeAt (tiniest multiline node at cursor)', () => {
  it('deleted `defineAction: TypedDefineAction<M>;` picks the type literal, not the function', () => {
    const tree = parser.parse(OLD_TEXT)!;
    // line 4, a column inside `TypedDefineAction`
    const range = nodeRangeAt(tree.rootNode, 4, 18);
    // the `{ defineAction...; defineApp...; }` return-type block: lines 3-6
    expect(range).toEqual({ start: 3, end: 6 });
  });

  it('added `defineAction: createDefineAction...` picks the return object literal', () => {
    const tree = parser.parse(NEW_TEXT)!;
    const range = nodeRangeAt(tree.rootNode, 8, 8);
    // the returned `{ ... }` object: lines 7-10
    expect(range).toEqual({ start: 7, end: 10 });
  });

  it('clicking the signature picks the whole function, and never the file', () => {
    const tree = parser.parse(NEW_TEXT)!;
    expect(nodeRangeAt(tree.rootNode, 1, 20)).toEqual({ start: 1, end: 11 });
    expect(nodeRangeAt(tree.rootNode, 1, 0)).not.toBeNull();
  });

  it('column matters: the manifest parameter line picks the parameter list region', () => {
    const tree = parser.parse(NEW_TEXT)!;
    const range = nodeRangeAt(tree.rootNode, 2, 4)!;
    // formal parameters span lines 1-3; must be tighter than the function
    expect(range.end - range.start).toBeLessThan(10);
    expect(range.start).toBeLessThanOrEqual(2);
    expect(range.end).toBeGreaterThanOrEqual(2);
  });
});
