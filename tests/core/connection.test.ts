import { describe, it, expect, vi, afterEach } from 'vitest';
import { createConnection } from '../../src/core/connection.js';
import { openaiCodec } from '../../src/codecs/openai/index.js';
import { none, some } from '../../src/types/option.js';
import { toModelId } from '../../src/types/branded.js';
import type { Capabilities } from '../../src/types/capabilities.js';

const caps: Capabilities = {
  streaming: true, tools: true, media: [], reasoning: false,
  structuredOutput: false, contextWindow: 128000, promptCaching: false,
};

const makeResponse = (status: number, body: string): Response => new Response(body, { status, headers: { 'content-type': 'application/json' } });

const mockFetch = (fn: typeof globalThis.fetch) => vi.stubGlobal('fetch', fn);
afterEach(() => vi.unstubAllGlobals());

const request = {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi', providerOptions: none }] }],
  tools: [],
  responseFormat: none,
  sampling: { temperature: none, topP: none, maxOutputTokens: none, stopSequences: [] },
  signal: none,
  providerOptions: none,
} as const;

describe('createConnection (openai) integration', () => {
  it('chat returns ok(ChatResponse) on a 200 completion', async () => {
    mockFetch(async () => makeResponse(200, '{"id":"1","model":"gpt-4o","choices":[{"index":0,"message":{"role":"assistant","content":"Hello!"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}'));
    const pipeline = await createConnection({
      codec: openaiCodec,
      auth: { type: 'static', credential: { type: 'value', value: 'sk-test' }, location: 'header', key: 'Authorization' },
      baseURL: 'https://api.openai.com/v1',
      extraHeaders: {},
      capabilities: { type: 'static', map: new Map([[toModelId('gpt-4o'), caps]]) },
    });
    if (!pipeline.ok) throw new Error('expected connection ok');
    const out = await pipeline.value.chat(request as never);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.provider).toBe('openai');
      expect(out.value.finishReason).toBe('complete');
      expect(out.value.content[0]).toMatchObject({ type: 'text', text: 'Hello!' });
    }
  });

  it('chat returns err(parseError) on a non-2xx with provider labeled', async () => {
    mockFetch(async () => makeResponse(401, '{"error":{"message":"bad key","type":"invalid_request_error","code":"invalid_api_key"}}'));
    const pipeline = await createConnection({
      codec: openaiCodec,
      auth: { type: 'none' },
      baseURL: 'https://api.openai.com/v1',
      extraHeaders: {},
      capabilities: { type: 'static', map: new Map([[toModelId('gpt-4o'), caps]]) },
    });
    if (!pipeline.ok) throw new Error('expected connection ok');
    const out = await pipeline.value.chat(request as never);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.category).toBe('invalid');
      expect(out.error.provider).toBe('openai');
    }
  });

  it('chat fails locally when the model has no resolved capabilities', async () => {
    const pipeline = await createConnection({
      codec: openaiCodec,
      auth: { type: 'none' },
      baseURL: 'https://api.openai.com/v1',
      extraHeaders: {},
      capabilities: { type: 'static', map: new Map() },
    });
    if (!pipeline.ok) throw new Error('expected connection ok');
    const out = await pipeline.value.chat(request as never);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('unknown_model');
  });

  it('auth static header is attached to the outgoing request', async () => {
    let sentHeaders: Record<string, string> = {};
    mockFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
      sentHeaders = init?.headers as Record<string, string>;
      return makeResponse(200, '{"model":"gpt-4o","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}');
    });
    const pipeline = await createConnection({
      codec: openaiCodec,
      auth: { type: 'static', credential: { type: 'value', value: 'Bearer sk-test' }, location: 'header', key: 'Authorization' },
      baseURL: 'https://api.openai.com/v1',
      extraHeaders: {},
      capabilities: { type: 'static', map: new Map([[toModelId('gpt-4o'), caps]]) },
    });
    if (!pipeline.ok) throw new Error('expected connection ok');
    await pipeline.value.chat(request as never);
    expect(sentHeaders['Authorization']).toBe('Bearer sk-test');
  });
});