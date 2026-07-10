import { describe, expect, it } from 'vitest';
import { whitespaceOnlyRows, type PatchRow } from './patch';

const del = (left: number, s: string): PatchRow => ({ type: 'DELETION', left, text: `-${s}` });
const add = (right: number, s: string): PatchRow => ({ type: 'ADDITION', right, text: `+${s}` });

describe('whitespaceOnlyRows', () => {
  it('finds del/add pairs differing only in whitespace', () => {
    const rows = [
      del(1, 'const a=1;'),
      add(1, 'const a = 1;'),
      del(2, 'real change'),
      add(2, 'different content'),
    ];
    expect(whitespaceOnlyRows(rows).map((r) => r.text)).toEqual([
      '-const a=1;',
      '+const a = 1;',
    ]);
  });

  it('ignores unbalanced or empty pairs', () => {
    expect(whitespaceOnlyRows([del(1, 'x'), add(1, 'y'), add(2, 'z')])).toEqual([]);
    expect(whitespaceOnlyRows([del(1, '  '), add(1, '')])).toEqual([]);
  });
});
