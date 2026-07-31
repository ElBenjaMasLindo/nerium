import { none } from '../../types/option.js';
import type { RawStreamEvent } from '../../types/http-wire.js';
import { splitLines } from './lines.js';

export const parseNdjson = async function* (
  chunks: AsyncIterable<string>,
): AsyncGenerator<RawStreamEvent> {
  let buffer = '';
  for await (const chunk of chunks) {
    buffer += chunk;
    const { lines, rest } = splitLines(buffer);
    buffer = rest;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      yield { eventName: none, data: trimmed } as const;
    }
  }
  const last = buffer.trim();
  if (last !== '') yield { eventName: none, data: last } as const;
};