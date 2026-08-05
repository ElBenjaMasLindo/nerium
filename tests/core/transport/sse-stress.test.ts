import { describe, it, expect } from 'vitest';
import { parseSse } from '../../../src/core/transport/sse.js';
import { none, some } from '../../../src/types/option.js';
import type { RawStreamEvent } from '../../../src/types/http-wire.js';

async function* streamChunks(chunks: ReadonlyArray<string>): AsyncGenerator<string> {
  for (const chunk of chunks) yield chunk;
}

const collectSse = async (chunks: ReadonlyArray<string>): Promise<ReadonlyArray<RawStreamEvent>> => {
  const out: RawStreamEvent[] = [];
  for await (const event of parseSse(streamChunks(chunks))) out.push(event);
  return out;
};

describe('parseSse stress tests', () => {
  describe('empty data lines', () => {
    it('handles data: with empty value', async () => {
      const out = await collectSse(['data:\n\n']);
      expect(out).toEqual([{ eventName: none, data: '' }]);
    });

    it('handles standalone data line without colon', async () => {
      const out = await collectSse(['data\n\n']);
      expect(out).toEqual([{ eventName: none, data: '' }]);
    });

    it('combines empty data lines with content data lines', async () => {
      const out = await collectSse(['data:\ndata\ndata: hello\n\n']);
      expect(out).toEqual([{ eventName: none, data: '\n\nhello' }]);
    });
  });

  describe('standalone \\r and \\r\\n line endings', () => {
    it('parses stream with standalone \\r line endings', async () => {
      const out = await collectSse(['event: ping\rdata: {}\r\r']);
      expect(out).toEqual([{ eventName: some('ping'), data: '{}' }]);
    });

    it('handles \\r split across chunk boundary', async () => {
      const out = await collectSse(['event: delta\r', 'data: {"count":1}\r\r']);
      expect(out).toEqual([{ eventName: some('delta'), data: '{"count":1}' }]);
    });

    it('handles \\r\\n split across chunk boundary', async () => {
      const out = await collectSse(['data: payload\r', '\n\r\n']);
      expect(out).toEqual([{ eventName: none, data: 'payload' }]);
    });
  });

  describe('truncated buffers and sudden EOF', () => {
    it('flushes incomplete data line on sudden EOF', async () => {
      const out = await collectSse(['data: unclosed']);
      expect(out).toEqual([{ eventName: none, data: 'unclosed' }]);
    });

    it('flushes incomplete event and data on sudden EOF', async () => {
      const out = await collectSse(['event: update\ndata: partial']);
      expect(out).toEqual([{ eventName: some('update'), data: 'partial' }]);
    });

    it('flushes trailing \\r on sudden EOF', async () => {
      const out = await collectSse(['data: trailing_cr\r']);
      expect(out).toEqual([{ eventName: none, data: 'trailing_cr' }]);
    });

    it('flushes empty data line on sudden EOF', async () => {
      const out = await collectSse(['data:']);
      expect(out).toEqual([{ eventName: none, data: '' }]);
    });

    it('flushes multi-line buffer on sudden EOF', async () => {
      const out = await collectSse(['data: chunk1\ndata: chun']);
      expect(out).toEqual([{ eventName: none, data: 'chunk1\nchun' }]);
    });

    it('produces no extra event if stream ends right after complete dispatch', async () => {
      const out = await collectSse(['data: complete\n\n']);
      expect(out).toEqual([{ eventName: none, data: 'complete' }]);
    });

    it('ignores comments on sudden EOF', async () => {
      const out = await collectSse([': keepalive comment']);
      expect(out).toEqual([]);
    });
  });
});
