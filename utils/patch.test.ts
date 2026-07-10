import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPatch, patchRowSpan, type PatchRow } from './patch';

const ctx = (left: number, right: number, s: string): PatchRow => ({
  type: 'CONTEXT',
  left,
  right,
  text: ` ${s}`,
});
const del = (left: number, right: number, s: string): PatchRow => ({
  type: 'DELETION',
  left,
  right,
  text: `-${s}`,
});
const add = (right: number, s: string): PatchRow => ({
  type: 'ADDITION',
  right,
  text: `+${s}`,
});

function gitApply(oldContent: string, patch: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'hihyou-patch-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(path.join(dir, 'file.ts'), oldContent);
  execFileSync('git', ['apply', '--whitespace=nowarn', '-'], {
    cwd: dir,
    input: patch,
  });
  return readFileSync(path.join(dir, 'file.ts'), 'utf8');
}

describe('buildPatch really applies with git', () => {
  it('modification hunk applies', () => {
    const oldContent = 'one\ntwo\nthree\nfour\nfive\n';
    const rows = [
      ctx(1, 1, 'one'),
      del(2, 1, 'two'),
      add(2, 'TWO'),
      add(3, 'TWO.5'),
      ctx(3, 4, 'three'),
    ];
    const patch = buildPatch('file.ts', 'file.ts', rows)!;
    expect(gitApply(oldContent, patch)).toBe(
      'one\nTWO\nTWO.5\nthree\nfour\nfive\n',
    );
  });

  it('deletion-only hunk applies', () => {
    const oldContent = 'a\nb\nc\nd\n';
    const rows = [ctx(1, 1, 'a'), del(2, 1, 'b'), del(3, 1, 'c'), ctx(4, 2, 'd')];
    const patch = buildPatch('file.ts', 'file.ts', rows)!;
    expect(gitApply(oldContent, patch)).toBe('a\nd\n');
  });

  it('multiple hunks split at HUNK rows and apply together', () => {
    const oldContent = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n';
    const rows: PatchRow[] = [
      { type: 'HUNK', text: '@@' },
      ctx(1, 1, 'l1'),
      del(2, 1, 'l2'),
      add(2, 'L2'),
      ctx(3, 3, 'l3'),
      { type: 'HUNK', text: '@@' },
      ctx(6, 6, 'l6'),
      del(7, 6, 'l7'),
      ctx(8, 7, 'l8'),
    ];
    const patch = buildPatch('file.ts', 'file.ts', rows)!;
    expect(gitApply(oldContent, patch)).toBe('l1\nL2\nl3\nl4\nl5\nl6\nl8\n');
  });

  it('context-only selections produce no patch', () => {
    expect(buildPatch('f', 'f', [ctx(1, 1, 'x')])).toBeNull();
  });
});

describe('patchRowSpan', () => {
  it('expands to contiguous span plus context margin, stopping at hunks', () => {
    const lines: PatchRow[] = [
      { type: 'HUNK', text: '@@' },
      ctx(1, 1, 'a'),
      ctx(2, 2, 'b'),
      del(3, 2, 'c'),
      add(3, 'C'),
      ctx(4, 4, 'd'),
      ctx(5, 5, 'e'),
    ];
    const span = patchRowSpan(lines, new Set([3, 4]), 1);
    expect(span.map((r) => r.text)).toEqual([' b', '-c', '+C', ' d']);
  });
});
