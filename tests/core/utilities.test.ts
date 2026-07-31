import { describe, it, expect } from 'vitest';
import { collectStream, appendAssistantTurn, appendToolResults } from '../../src/core/utilities.js';
import { none, some } from '../../src/types/option.js';
import { toToolCallId, toModelId } from '../../src/types/branded.js';
import type { ChatChunk } from '../../src/types/stream.js';
import type { ChatResponse } from '../../src/types/response.js';
import type { Message } from '../../src/types/request.js';

const ctx = { provider: 'test', model: toModelId('gpt-x') };

async function* fromChunks(chunks: ReadonlyArray<ChatChunk>): AsyncGenerator<ChatChunk> {
  for (const c of chunks) yield c;
}

const usage = { input: 0, output: 0, total: 0, cacheWrite: none, cacheRead: none } as const;

describe('collectStream', () => {
  it('assembles text + tool_call fragments', async () => {
    const id = toToolCallId('call_1');
    const out = await collectStream(fromChunks([
      { type: 'start', index: 0, block: { type: 'text' } },
      { type: 'delta', index: 0, delta: { type: 'text', text: 'Hel' } },
      { type: 'delta', index: 0, delta: { type: 'text', text: 'lo' } },
      { type: 'start', index: 1, block: { type: 'tool_call', id, name: 'get_weather' } },
      { type: 'delta', index: 1, delta: { type: 'tool_call', argumentsFragment: '{"city":"' } },
      { type: 'delta', index: 1, delta: { type: 'tool_call', argumentsFragment: 'BA"}' } },
      { type: 'end', usage: { ...usage, input: 3, output: 5, total: 8 }, finishReason: 'tool_call' },
    ]), ctx);
    expect(out.provider).toBe('test');
    expect(out.finishReason).toBe('tool_call');
    expect(out.usage.total).toBe(8);
    expect(out.content[0]).toEqual({ type: 'text', text: 'Hello', providerOptions: none });
    expect(out.content[1]).toEqual({ type: 'tool_call', id, name: 'get_weather', arguments: { city: 'BA' }, providerOptions: none });
  });

  it('collects opaque deltas into a non-concatenated array', async () => {
    const out = await collectStream(fromChunks([
      { type: 'start', index: 0, block: { type: 'opaque', subtype: 'native' } },
      { type: 'delta', index: 0, delta: { type: 'opaque', raw: { a: 1 } } },
      { type: 'delta', index: 0, delta: { type: 'opaque', raw: { b: 2 } } },
      { type: 'end', usage, finishReason: 'complete' },
    ]), ctx);
    expect(out.content[0]).toEqual({ type: 'opaque', subtype: 'native', raw: [{ a: 1 }, { b: 2 }], providerOptions: none });
  });

  it('parses malformed tool-call arguments to an empty object', async () => {
    const id = toToolCallId('c2');
    const out = await collectStream(fromChunks([
      { type: 'start', index: 0, block: { type: 'tool_call', id, name: 'x' } },
      { type: 'delta', index: 0, delta: { type: 'tool_call', argumentsFragment: 'not-json' } },
      { type: 'end', usage, finishReason: 'tool_call' },
    ]), ctx);
    expect(out.content[0]).toEqual({ type: 'tool_call', id, name: 'x', arguments: {}, providerOptions: none });
  });

  it('reports cache split on usage', async () => {
    const out = await collectStream(fromChunks([
      { type: 'start', index: 0, block: { type: 'text' } },
      { type: 'end', usage: { input: 10, output: 2, total: 12, cacheWrite: some(4), cacheRead: some(6) }, finishReason: 'complete' },
    ]), ctx);
    expect(out.usage.cacheWrite).toEqual(some(4));
    expect(out.usage.cacheRead).toEqual(some(6));
  });
});

describe('appendAssistantTurn', () => {
  it('appends an assistant message built from the response content', () => {
    const messages: ReadonlyArray<Message> = [{ role: 'user', content: [{ type: 'text', text: 'hi', providerOptions: none }] }];
    const response: ChatResponse = {
      content: [{ type: 'text', text: 'hey', providerOptions: none }],
      finishReason: 'complete', usage, provider: 'test', model: toModelId('gpt-x'),
    };
    const out = appendAssistantTurn(messages, response);
    expect(out).toHaveLength(2);
    expect(out[1]?.role).toBe('assistant');
  });
});