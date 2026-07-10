import { describe, expect, it } from 'vitest';
import { rowInPick } from './pick';

const ctx = (left: number, right: number) => ({ type: 'CONTEXT', left, right });
const add = (right: number) => ({ type: 'ADDITION', right });
const del = (left: number, right: number) => ({ type: 'DELETION', left, right });

describe('rowInPick', () => {
  it('R picks match context and additions by right line', () => {
    const pick = { side: 'R' as const, start: 10, end: 12 };
    expect(rowInPick(ctx(100, 10), pick)).toBe(true);
    expect(rowInPick(add(11), pick)).toBe(true);
    expect(rowInPick(ctx(100, 13), pick)).toBe(false);
  });

  it('L picks match deletions and context by left line, never additions', () => {
    const pick = { side: 'L' as const, start: 4, end: 6 };
    expect(rowInPick(del(4, 3), pick)).toBe(true);
    expect(rowInPick(ctx(5, 99), pick)).toBe(true);
    expect(rowInPick(add(5), pick)).toBe(false);
    expect(rowInPick(del(7, 3), pick)).toBe(false);
  });

  it('hunk rows never match', () => {
    expect(
      rowInPick({ type: 'HUNK', left: 5, right: 5 }, { side: 'L', start: 1, end: 10 }),
    ).toBe(false);
  });
});
