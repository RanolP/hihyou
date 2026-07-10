// Self-check: node utils/seen-hunks.check.ts
import assert from 'node:assert/strict';
import {
  fileFullySeen,
  isLineSeen,
  markAllSeen,
  markLinesSeen,
  clearLinesSeen,
  seenCount,
  validateSeen,
  type SeenLine,
} from './seen-hunks.ts';

const ctx = (right: number, text: string): SeenLine => ({
  type: 'CONTEXT',
  left: right - 1,
  right,
  text,
});
const add = (right: number, text: string): SeenLine => ({
  type: 'ADDITION',
  right,
  text,
});
const del = (left: number, text: string): SeenLine => ({
  type: 'DELETION',
  left,
  text,
});
const hunk: SeenLine = { type: 'HUNK', text: '@@ -1,3 +1,4 @@' };

const lines = [hunk, ctx(10, ' a'), del(10, '-old'), add(11, '+new'), add(12, '+more'), ctx(13, ' b')];

// Marking a drag over del+adds records both sides.
let state = markLinesSeen(undefined, [lines[2], lines[3], lines[4]]);
assert.equal(state.L.length, 1);
assert.deepEqual([state.L[0].start, state.L[0].end], [10, 10]);
assert.equal(state.R.length, 1);
assert.deepEqual([state.R[0].start, state.R[0].end], [11, 12]);
assert.ok(isLineSeen(state, lines[3]));
assert.ok(isLineSeen(state, lines[2]));
assert.ok(!isLineSeen(state, lines[1]), 'context line 10 unseen');
assert.ok(!isLineSeen(state, hunk), 'hunk rows are never seen');

// Non-contiguous selections split into separate intervals.
const split = markLinesSeen(undefined, [ctx(1, ' x'), ctx(5, ' y')]);
assert.equal(split.R.length, 2);

// seen count + fully seen + mark all.
assert.equal(seenCount(state, lines), 3);
assert.ok(!fileFullySeen(state, lines));
const all = markAllSeen(lines);
assert.ok(fileFullySeen(all, lines));
assert.equal(seenCount(all, lines), 5);

// Validation keeps hunks whose content is unchanged...
let v = validateSeen(state, lines);
assert.equal(v.changed, false);
assert.equal(v.state.R.length, 1);

// ...drops hunks whose visible text changed (a later commit touched them)...
const touched = lines.map((l) =>
  l.type === 'ADDITION' && l.right === 11 ? { ...l, text: '+CHANGED' } : l,
);
v = validateSeen(state, touched);
assert.equal(v.changed, true);
assert.equal(v.state.R.length, 0, 'touched R interval dropped');
assert.equal(v.state.L.length, 1, 'untouched L interval kept');

// ...and keeps hunks it cannot see at all.
v = validateSeen(state, [hunk]);
assert.equal(v.changed, false);
assert.equal(v.state.R.length, 1);

// Un-seeing a file clears every interval overlapping its lines.
const cleared = clearLinesSeen(all, lines);
assert.equal(seenCount(cleared, lines), 0);

// Idempotent re-mark does not duplicate intervals.
const twice = markLinesSeen(state, [lines[3], lines[4]]);
assert.equal(twice.R.length, state.R.length);

// Scope expansion: selecting one line inside a declaration marks the whole
// declaration's rendered rows.
{
  const { expandSelectionToScopes } = await import('./seen-hunks.ts');
  const all = [
    ctx(10, ' fn start'),
    add(11, '+body a'),
    add(12, '+body b'),
    ctx(13, ' fn end'),
    ctx(30, ' elsewhere'),
  ];
  const expanded = expandSelectionToScopes(
    [all[1]],
    all,
    [{ start: 10, end: 13 }],
  );
  assert.equal(expanded.length, 4, 'whole scope rows included');
  assert.ok(!expanded.some((l) => l.right === 30));

  // Oversized scopes are ignored.
  const untouched = expandSelectionToScopes(
    [all[1]],
    all,
    [{ start: 1, end: 500 }],
  );
  assert.equal(untouched.length, 1);

  // Deletion rows inside the scope come along via their right anchor.
  const withDel = [ctx(10, ' a'), del(10, '-x'), add(11, '+y'), ctx(12, ' b')];
  withDel[1].right = 10;
  const exp2 = expandSelectionToScopes(
    [withDel[2]],
    withDel,
    [{ start: 10, end: 12 }],
  );
  assert.equal(exp2.length, 4);
}

console.log('seen-hunks: all checks passed');
