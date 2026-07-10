// Self-check: node utils/ts-env.check.ts  (fetches one tarball from npm)
import assert from 'node:assert/strict';
import ts from 'typescript';
import { createDefaultMapFromNodeModules } from '@typescript/vfs';
import {
  importerForPath,
  lockfileImporterDirs,
  resolveLockfileDeps,
} from './pnpm-lock.ts';
import { extractTypesFromTarball } from './tarball.ts';
import {
  COMPILER_OPTIONS,
  buildEnv,
  hoverAt,
  importedPackages,
} from './ts-env.ts';

// ── pnpm-lock resolution ──
const lockfile = `
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      nanoid:
        specifier: ^5.0.0
        version: 5.0.9
  packages/app:
    dependencies:
      solid-js:
        specifier: ^1.9.0
        version: 1.9.11(patched@1.0.0)
`;
const dirs = lockfileImporterDirs(lockfile);
assert.deepEqual(dirs.sort(), ['.', 'packages/app']);
assert.equal(importerForPath(dirs, 'packages/app/src/x.ts'), 'packages/app');
assert.equal(importerForPath(dirs, 'README.md'), '.');
assert.deepEqual(resolveLockfileDeps(lockfile, '.'), { nanoid: '5.0.9' });
assert.deepEqual(resolveLockfileDeps(lockfile, 'packages/app'), {
  'solid-js': '1.9.11',
});

// ── imported package extraction ──
assert.deepEqual(
  importedPackages(
    `import { a } from './local';\nimport { customAlphabet } from 'nanoid';\nimport x from '@scope/pkg/sub';`,
  ).sort(),
  ['@scope/pkg', 'nanoid'],
);

// ── tarball + virtual TS env + hover (network: registry.npmjs.org) ──
const res = await fetch('https://registry.npmjs.org/nanoid/-/nanoid-5.0.9.tgz');
assert.ok(res.ok, 'registry fetch');
const files = await extractTypesFromTarball(
  new Uint8Array(await res.arrayBuffer()),
);
assert.ok(files['package.json'], 'package.json extracted');
assert.ok(
  Object.keys(files).some((f) => f.endsWith('.d.ts')),
  'd.ts extracted',
);

const libs = createDefaultMapFromNodeModules(COMPILER_OPTIONS, ts);
const fileText = `import { customAlphabet } from 'nanoid';\nconst make = customAlphabet('abc', 5);\n`;
const env = buildEnv(libs, '/index.ts', fileText, { nanoid: files });
// hover over `customAlphabet` on line 1 (col of the identifier).
const hover = hoverAt(env, '/index.ts', fileText, 1, 10);
assert.ok(hover, 'quick info returned');
assert.ok(hover.includes('customAlphabet'), hover.slice(0, 120));
assert.ok(/alias|function|const/.test(hover));

console.log('ts-env: all checks passed');
