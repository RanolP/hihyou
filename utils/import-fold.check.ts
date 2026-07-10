// Self-check: node utils/import-fold.check.ts
import assert from 'node:assert/strict';
import { importFold } from './import-fold.ts';

const lines = [
  { type: 'HUNK' },
  { type: 'CONTEXT', right: 1 },
  { type: 'ADDITION', right: 2 },
  { type: 'DELETION', right: 2 },
  { type: 'CONTEXT', right: 3 },
  { type: 'CONTEXT', right: 4 },
  { type: 'CONTEXT', right: 10 },
  { type: 'ADDITION', right: 11 },
];

// Imports span lines 1-4: rows 1..5 fold, 2 changed rows inside.
const fold = importFold(lines, [
  { start: 1, end: 2 },
  { start: 4, end: 4 },
]);
assert.ok(fold);
assert.equal(fold.startIdx, 1);
assert.equal(fold.endIdx, 5);
assert.equal(fold.total, 5);
assert.equal(fold.changed, 2);

// Too small a block: no fold.
assert.equal(importFold(lines.slice(0, 3), [{ start: 1, end: 2 }]), null);

// No imports: no fold.
assert.equal(importFold(lines, []), null);

console.log('import-fold: all checks passed');
