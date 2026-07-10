// Self-check: node utils/injection-heuristic.check.ts
import assert from 'node:assert/strict';
import { scoreInjectionLang } from './injection-heuristic.ts';

assert.equal(
  scoreInjectionLang(['.box {', '  color: red;', '  margin: 0 auto;', '}']),
  'css',
);
assert.equal(
  scoreInjectionLang(['<div class="a">', '  <span>hi</span>', '</div>']),
  'html',
);
assert.equal(
  scoreInjectionLang(['const x = 1;', 'return x + 2;']),
  null,
  'plain code is neither',
);
assert.equal(scoreInjectionLang(['']), null, 'empty literal');
assert.equal(
  scoreInjectionLang(['SELECT * FROM users', 'WHERE id = 1']),
  null,
  'sql is not misdetected',
);

console.log('injection-heuristic: all checks passed');
