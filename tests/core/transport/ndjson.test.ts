import { describe, it, expect } from 'vitest';
import { parseNdjson } from '../../../src/core/transport/ndjson.js';
import { none } from '../../../src/types/option.js';

async function* chunks(parts: ReadonlyArray<string>): AsyncGenerator<string> {
  for (const p of parts) yield p;
}

const collect = async (parts: ReadonlyArray<string>) => {
  const out = [];
  for await (const ev of parseNdjson(chunks(parts))) out.push(ev);
  return out;
};

describe('parseNdjson', () => {
  it('emits one event per non-empty line with eventName none', async () => {
    const out = await collect(['{"a":1}\n', '{"b":2}\n']);
    expect(out).toEqual([
      { eventName: none, data: '{"a":1}' },
      { eventName: none, data: '{"b":2}' },
    ]);
  });

  it('skips blank lines and flushes a trailing object without newline', async () => {
    const out = await collect(['{"a":1}\n\n', '{"b":2}']);
    expect(out).toEqual([
      { eventName: none, data: '{"a":1}' },
      { eventName: none, data: '{"b":2}' },
    ]);
  });

  it('reassembles an object split across chunks', async () => {
    const out = await collect(['{"a":', '1}\n{"b":2}\n']);
    expect(out).toEqual([
      { eventName: none, data: '{"a":1}' },
      { eventName: none, data: '{"b":2}' },
    ]);
  });
});