import { describe, it, expect } from 'vitest';
import { categorizeByStatus } from '../../src/core/http-status-category.js';

describe('categorizeByStatus', () => {
  it('maps known statuses and collapses everything else to unknown', () => {
    const cases: ReadonlyArray<[number, string]> = [
      [400, 'invalid'], [401, 'invalid'], [403, 'invalid'],
      [429, 'transient'], [500, 'transient'], [503, 'transient'],
      [200, 'unknown'], [404, 'unknown'], [418, 'unknown'],
    ];
    for (const [status, expected] of cases) {
      expect(categorizeByStatus(status)).toBe(expected);
    }
  });
});