#!/usr/bin/env node
// hihyou apply daemon: receives unified diffs from the extension and
// applies them to a local checkout with `git apply`.
//
//   node scripts/apply-server.mjs <repo-dir> [port=48917]
//
// Binds to 127.0.0.1 only. Run one per repo you are reviewing against.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';

const [dir, port = '48917'] = process.argv.slice(2);
if (!dir || !existsSync(dir)) {
  console.error('usage: node scripts/apply-server.mjs <repo-dir> [port]');
  process.exit(1);
}

createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/apply') {
    res.writeHead(404);
    res.end();
    return;
  }
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    let result;
    try {
      const { patch } = JSON.parse(body);
      execFileSync('git', ['apply', '--whitespace=nowarn', '-'], {
        cwd: dir,
        input: patch,
      });
      console.log('applied patch (%d bytes)', patch.length);
      result = { ok: true };
    } catch (err) {
      const detail = String(err.stderr ?? err.message).slice(0, 500);
      console.error('apply failed:', detail.trim());
      result = { ok: false, detail };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  });
}).listen(Number(port), '127.0.0.1', () =>
  console.log(`hihyou apply daemon: ${dir} @ http://127.0.0.1:${port}`),
);
