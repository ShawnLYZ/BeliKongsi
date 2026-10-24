import { describe, expect, it } from 'vitest';
import { median } from '@/server/modules/ops/impact';

describe('median', () => {
  it.each([
    [[], null],
    [[3], 3],
    [[2, 5], 4],
    [[1, 2, 9], 2],
    [[1, 2], 2],
    [[9, 1, 2], 2],
  ])('median of %j is %s', (values, expected) => {
    expect(median(values)).toBe(expected);
  });
});
