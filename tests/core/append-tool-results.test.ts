import { describe, it, expect } from 'vitest';
import { appendToolResults } from '../../src/core/utilities.js';
import { none } from '../../src/types/option.js';
import { toToolCallId } from '../../src/types/branded.js';

describe('appendToolResults', () => {
  it('adds one tool message per result, each referencing its tool_call id', () => {
    const id1 = toToolCallId('t1');
    const id2 = toToolCallId('t2');
    const out = appendToolResults([], [
      { toolCallId: id1, result: { temp: 20 } },
      { toolCallId: id2, result: { temp: 25 } },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.content[0]).toEqual({ type: 'tool_result', toolCallId: id1, result: { temp: 20 }, providerOptions: none });
    expect(out[1]?.content[0]).toEqual({ type: 'tool_result', toolCallId: id2, result: { temp: 25 }, providerOptions: none });
  });
});