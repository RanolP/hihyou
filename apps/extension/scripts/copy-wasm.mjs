// Copies tree-sitter runtime + grammar wasm into public/ so the built
// extension can serve them to the background service worker.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const out = new URL('../public/ts-wasm/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const runtime = path.join(
  path.dirname(require.resolve('web-tree-sitter')),
  'web-tree-sitter.wasm',
);
copyFileSync(runtime, path.join(out, 'web-tree-sitter.wasm'));

const grammarDir = path.join(
  path.dirname(require.resolve('@vscode/tree-sitter-wasm/package.json')),
  'wasm',
);
for (const lang of ['typescript', 'tsx', 'javascript', 'css']) {
  copyFileSync(
    path.join(grammarDir, `tree-sitter-${lang}.wasm`),
    path.join(out, `tree-sitter-${lang}.wasm`),
  );
}
console.log('copied tree-sitter wasm files to public/ts-wasm/');
