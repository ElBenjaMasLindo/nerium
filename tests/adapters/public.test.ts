import { describe, it, expect, vi, afterEach } from 'vitest';
import { createConnection, toPublicConnection, createClient } from '../../src/index.js';
import { openaiCodec } from '../../src/codecs/openai/index.js';
import { none } from '../../src/types/option.js';
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

const connectionInput = {
  codec: openaiCodec,
  auth: { type: 'none' } as const,
  baseURL: 'https://api.openai.com/v1',
  extraHeaders: {},
  capabilities: { type: 'static', map: new Map([[toModelId('gpt-4o'), caps]]) } as const,
};

describe('toPublicConnection (end-to-end)', () => {
  it('chat returns an unwrapped ChatResponse on success', async () => {
    mockFetch(async () => makeResponse(200, '{"model":"gpt-4o","choices":[{"index":0,"message":{"role":"assistant","content":"Hello!"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}'));
    const pipeline = await createConnection(connectionInput);
    if (!pipeline.ok) throw new Error('expected connection ok');
    const connection = toPublicConnection(pipeline.value);
    const response = await connection.chat(request as never);
    expect(response).not.toHaveProperty('ok');
    expect(response.finishReason).toBe('complete');
    expect(response.content[0]).toMatchObject({ type: 'text', text: 'Hello!' });
  });

  it('chat throws (never returns a Result) on failure', async () => {
    mockFetch(async () => makeResponse(401, '{"error":{"message":"bad","type":"invalid_request_error","code":"invalid_api_key"}}'));
    const pipeline = await createConnection(connectionInput);
    if (!pipeline.ok) throw new Error('expected connection ok');
    const connection = toPublicConnection(pipeline.value);
    await expect(connection.chat(request as never)).rejects.toMatchObject({ category: 'invalid' });
  });
});

describe('createClient', () => {
  it('selects the default and named alias, typed at compile time', async () => {
    mockFetch(async () => makeResponse(200, '{"model":"gpt-4o","choices":[{"index":0,"message":{"role":"assistant","content":"a"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}'));
    const pipeline = await createConnection(connectionInput);
    if (!pipeline.ok) throw new Error('expected connection ok');
    const connection = toPublicConnection(pipeline.value);
    const client = createClient({ openai: connection }, 'openai');
    expect(client.connection()).toBe(connection);
    expect(client.connection('openai')).toBe(connection);
  });
});