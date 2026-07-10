import { createRequire } from 'node:module';
import path from 'node:path';
import { Language, Parser } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { nodeChainAt } from './ast-service';

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
  it('deleted `defineAction: TypedDefineAction<M>;` chain: line first, then the type literal, then the function', () => {
    const tree = parser.parse(OLD_TEXT)!;
    const chain = nodeChainAt(tree.rootNode, 4, 18)!;
    // innermost pick is the property line itself
    expect(chain[0]).toEqual({ start: 4, end: 4 });
    // expanding reaches the { ... } type literal before the function
    const typeLiteral = chain.findIndex((r) => r.start === 3 && r.end === 6);
    const fn = chain.findIndex((r) => r.start === 1 && r.end === 11);
    expect(typeLiteral).toBeGreaterThan(-1);
    expect(fn === -1 || fn > typeLiteral).toBe(true);
  });

  it('added `defineAction: createDefineAction...` chain reaches the return object', () => {
    const tree = parser.parse(NEW_TEXT)!;
    const chain = nodeChainAt(tree.rootNode, 8, 8)!;
    expect(chain[0].start).toBe(8);
    expect(chain.some((r) => r.start === 7 && r.end === 10)).toBe(true);
  });

  it('the chain never includes the whole file', () => {
    const tree = parser.parse(NEW_TEXT)!;
    const chain = nodeChainAt(tree.rootNode, 1, 20)!;
    expect(chain.length).toBeGreaterThan(0);
    expect(chain.some((r) => r.start === 1 && r.end === 11)).toBe(true);
  });
});
