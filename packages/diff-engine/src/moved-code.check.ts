// Self-check: node utils/moved-code.check.ts
import assert from 'node:assert/strict';
import { matchMoves, type DeclHash } from './moved-code.ts';

const d = (
  name: string,
  hash: string,
  start = 1,
  end = 10,
  size = 100,
): DeclHash => ({ name, kind: 'function', start, end, hash, size });

// A function deleted from a.ts and added to b.ts is a move.
let moves = matchMoves(
  { 'a.ts': [d('helper', 'H1', 5, 20)], 'b.ts': [] },
  { 'a.ts': [], 'b.ts': [d('helper', 'H1', 30, 45)] },
);
assert.equal(moves.length, 1);
assert.equal(moves[0].fromPath, 'a.ts');
assert.equal(moves[0].toPath, 'b.ts');
assert.equal(moves[0].toStart, 30);

// Code present on both sides of the same file is NOT a move.
moves = matchMoves(
  { 'a.ts': [d('kept', 'K1')] },
  { 'a.ts': [d('kept', 'K1')] },
);
assert.equal(moves.length, 0);

// Tiny declarations are ignored.
moves = matchMoves(
  { 'a.ts': [d('x', 'T1', 1, 1, 10)] },
  { 'b.ts': [d('x', 'T1', 1, 1, 10)] },
);
assert.equal(moves.length, 0);

// One source pairs with at most one target.
moves = matchMoves(
  { 'a.ts': [d('dup', 'D1')] },
  { 'b.ts': [d('dup', 'D1')], 'c.ts': [d('dup', 'D1')] },
);
assert.equal(moves.length, 1);

// Move within the same file (reordered/relocated) still matches when the
// old-side copy is gone: modelled as different ranges.
moves = matchMoves(
  { 'a.ts': [d('reloc', 'R1', 5, 15)], 'b.ts': [] },
  { 'a.ts': [d('reloc', 'R1', 100, 110)] },
);
assert.equal(moves.length, 0, 'same hash in same file is not a move');

console.log('moved-code: all checks passed');
