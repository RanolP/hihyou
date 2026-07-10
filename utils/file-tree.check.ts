// Self-check: node utils/file-tree.check.ts
import assert from 'node:assert/strict';
import { buildFileTree, treeFilePaths } from './file-tree.ts';

const tree = buildFileTree([
  'packages/wxt/src/core/a.ts',
  'packages/wxt/src/core/b.ts',
  'packages/runner/README.md',
  'README.md',
  'docs/guide/intro.md',
]);

// Top level: two dirs (docs/guide compacted, packages) + one file.
assert.deepEqual(
  tree.dirs.map((d) => d.name),
  ['docs/guide', 'packages'],
);
assert.deepEqual(
  tree.files.map((f) => f.name),
  ['README.md'],
);

// docs/guide is fully compacted (one file inside).
const docs = tree.dirs[0];
assert.equal(docs.path, 'docs/guide');
assert.equal(docs.files[0].path, 'docs/guide/intro.md');

// packages splits into runner and wxt/src/core (compacted chain).
const packages = tree.dirs[1];
assert.deepEqual(
  packages.dirs.map((d) => d.name),
  ['runner', 'wxt/src/core'],
);
assert.equal(packages.dirs[1].path, 'packages/wxt/src/core');
assert.equal(packages.dirs[1].files.length, 2);

// treeFilePaths flattens everything.
assert.equal(treeFilePaths(tree).length, 5);
assert.ok(treeFilePaths(packages).every((p) => p.startsWith('packages/')));

console.log('file-tree: all checks passed');
