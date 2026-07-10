// Escapes non-ASCII characters in built JS as \uXXXX. Chrome refuses
// content scripts it considers non-UTF-8; pure-ASCII output is immune
// (and survives partial Syncthing syncs of multibyte sequences).
import { globSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = new URL('../.output/chrome-mv3/', import.meta.url).pathname;
const NON_ASCII = /[\u0080-\uffff]/g;
let changed = 0;
for (const file of globSync('**/*.js', { cwd: dir })) {
  const p = path.join(dir, file);
  const text = readFileSync(p, 'utf8');
  if (!NON_ASCII.test(text)) continue;
  const escaped = text.replace(
    NON_ASCII,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
  writeFileSync(p, escaped);
  changed++;
}
console.log(`ascii-escape: rewrote ${changed} js file(s)`);
