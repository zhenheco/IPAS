import { describe, expect, it } from 'vitest';
import { firstSubjectWithData } from './subjects';

describe('firstSubjectWithData', () => {
  it('picks the first 科目 that has data', () => {
    expect(firstSubjectWithData([1, 3], (s) => s === 3)).toBe(3);
    expect(firstSubjectWithData([1, 2, 3], () => true)).toBe(1);
  });
  it('falls back to the first 科目 when none has data, and to 1 when there are none', () => {
    expect(firstSubjectWithData([3, 1], () => false)).toBe(3);
    expect(firstSubjectWithData([], () => false)).toBe(1);
  });
});
