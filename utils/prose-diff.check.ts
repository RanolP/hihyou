// Self-check: node utils/prose-diff.check.ts
import assert from 'node:assert/strict';
import { diffBlocks, type BlockSeg } from './prose-diff.ts';

const b = (tag: string, text: string): BlockSeg => ({
  tag,
  text,
  html: `<${tag}>${text}</${tag}>`,
});

// Unchanged blocks pass through with original html.
let out = diffBlocks([b('p', 'hello world')], [b('p', 'hello world')]);
assert.equal(out.length, 1);
assert.deepEqual(out[0], { kind: 'same', html: '<p>hello world</p>' });

// A modified paragraph gets word-level ins/del marks.
out = diffBlocks(
  [b('p', 'the quick brown fox')],
  [b('p', 'the quick red fox')],
);
assert.equal(out.length, 1);
assert.equal(out[0].kind, 'changed');
assert.ok(out[0].html.includes('<del>brown</del>'));
assert.ok(out[0].html.includes('<ins>red</ins>'));
assert.ok(out[0].html.includes('the quick'));

// Pure additions and removals are fully marked.
out = diffBlocks(
  [b('p', 'a'), b('p', 'gone')],
  [b('p', 'a'), b('p', 'fresh'), b('h2', 'title')],
);
assert.equal(out[0].kind, 'same');
assert.equal(out[1].kind, 'changed'); // gone->fresh paired
out = diffBlocks([b('p', 'a')], [b('p', 'a'), b('h2', 'title')]);
assert.deepEqual(
  out.map((o) => o.kind),
  ['same', 'added'],
);
assert.ok(out[1].html.includes('<ins>title</ins>'));
out = diffBlocks([b('p', 'a'), b('p', 'bye')], [b('p', 'a')]);
assert.deepEqual(
  out.map((o) => o.kind),
  ['same', 'removed'],
);
assert.ok(out[1].html.includes('<del>bye</del>'));

// Uneven changed runs: extras become added/removed.
out = diffBlocks(
  [b('p', 'one edited')],
  [b('p', 'one changed'), b('p', 'two')],
);
assert.deepEqual(
  out.map((o) => o.kind),
  ['changed', 'added'],
);

// HTML in text is escaped inside marks.
out = diffBlocks([b('p', 'x')], [b('p', '<script>')]);
assert.ok(!out[0].html.includes('<script>'));

console.log('prose-diff: all checks passed');
