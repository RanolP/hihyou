// Self-check: node utils/pr-location.check.ts
import assert from 'node:assert/strict';
import { parsePrLocation } from './pr-location.ts';

const at = (path: string) => parsePrLocation(new URL(path, 'https://github.com'));

assert.deepEqual(at('/wxt-dev/wxt/pull/123'), {
  owner: 'wxt-dev',
  repo: 'wxt',
  number: 123,
  view: 'conversation',
});
assert.equal(at('/wxt-dev/wxt/pull/123/files')?.view, 'files');
assert.equal(at('/wxt-dev/wxt/pull/123/commits')?.view, 'commits');
assert.deepEqual(at('/wxt-dev/wxt/pull/123/changes'), {
  owner: 'wxt-dev',
  repo: 'wxt',
  number: 123,
  view: 'changes',
});
assert.equal(at('/wxt-dev/wxt/pull/123/changes/4cc0e8dd')?.range, '4cc0e8dd');
assert.equal(
  at('/wxt-dev/wxt/pull/123/changes/abc123..def456')?.range,
  'abc123..def456',
);
assert.equal(at('/wxt-dev/wxt/pull/123/checks'), null);
assert.equal(at('/wxt-dev/wxt/pulls'), null);
assert.equal(at('/wxt-dev/wxt'), null);
assert.equal(at('/'), null);

console.log('pr-location: all checks passed');
