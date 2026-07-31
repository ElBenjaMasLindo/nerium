import { describe, it, expect } from 'vitest';
import { parseSse } from '../../../src/core/transport/sse.js';
import { none, some } from '../../../src/types/option.js';

async function* chunks(parts: ReadonlyArray<string>): AsyncGenerator<string> {
  for (const p of parts) yield p;
}

const collect = async (parts: ReadonlyArray<string>) => {
  const out = [];
  for await (const ev of parseSse(chunks(parts))) out.push(ev);
  return out;
};

describe('parseSse', () => {
  it('parses event + data into a RawStreamEvent', async () => {
    const out = await collect(['event: message\n', 'data: {"a":1}\n', '\n']);
    expect(out).toEqual([{ eventName: some('message'), data: '{"a":1}' }]);
  });

  it('uses none for eventName when the event field is absent', async () => {
    const out = await collect(['data: [DONE]\n\n']);
    expect(out).toEqual([{ eventName: none, data: '[DONE]' }]);
  });

  it('joins multi-line data with newlines', async () => {
    const out = await collect(['data: line1\ndata: line2\n\n']);
    // multi-line data is joined with \n by the SSE spec
    expect(out).toEqual([{ eventName: none, data: 'line1\nline2' }]);
  });

  it('handles a stream split across chunks and CRLF', async () => {
    const out = await collect(['event: delta\r\n', 'data: {', '"b":2}\r', '\n\r\n']);
    expect(out).toEqual([{ eventName: some('delta'), data: '{"b":2}' }]);
  });

  it('ignores comment lines', async () => {
    const out = await collect([': keep-alive\n', 'data: {"x":1}\n', '\n']);
    expect(out).toEqual([{ eventName: none, data: '{"x":1}' }]);
  });
});