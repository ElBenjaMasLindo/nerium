import { describe, it, expect, vi, afterEach } from 'vitest';
import { createConnection, toPublicConnection } from '../../src/index.js';
import { anthropicCodec } from '../../src/codecs/anthropic/index.js';
import { none, some } from '../../src/types/option.js';
import { toModelId } from '../../src/types/branded.js';
import type { Capabilities } from '../../src/types/capabilities.js';
import type { HttpRequest } from '../../src/types/http-wire.js';

const caps: Capabilities = {
  streaming: true, tools: true, media: [], reasoning: true,
  structuredOutput: false, contextWindow: 200000, promptCaching: true,
};

const makeResponse = (status: number, body: string): Response => new Response(body, { status, headers: { 'content-type': 'application/json' } });

const mockFetch = (fn: typeof globalThis.fetch) => vi.stubGlobal('fetch', fn);
afterEach(() => vi.unstubAllGlobals());

const request = {
  model: 'claude-3-5-sonnet',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi', providerOptions: none }] }],
  tools: [],
  responseFormat: none,
  sampling: { temperature: none, topP: none, maxOutputTokens: some(128), stopSequences: [] },
  signal: none,
  providerOptions: none,
} as const;

describe('signed auth composition over an existing codec', () => {
  it('wraps the codec buildRequest output with a signing function, without touching the codec', async () => {
    let receivedPath = '';
    let receivedHeaders: Record<string, string> = {};
    mockFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      receivedPath = url;
      receivedHeaders = (init?.headers as Record<string, string>) ?? {};
      return makeResponse(200, '{"id":"msg_1","model":"claude-3-5-sonnet","content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}');
    });

    const sign = async (request: HttpRequest): Promise<HttpRequest> => ({
      ...request,
      url: `${request.url}?signed=true`,
      headers: { ...request.headers, 'x-amz-signature': 'stub-signature' },
    });

    const pipeline = await createConnection({
      codec: anthropicCodec,
      auth: { type: 'signed', sign },
      baseURL: 'https://api.anthropic.com',
      extraHeaders: {},
      capabilities: { type: 'static', map: new Map([[toModelId('claude-3-5-sonnet'), caps]]) },
    });
    if (!pipeline.ok) throw new Error('expected connection ok');
    await pipeline.value.chat(request as never);

    expect(receivedPath).toContain('?signed=true');
    expect(receivedHeaders['x-amz-signature']).toBe('stub-signature');
    // The codec's own header survives the signing wrap:
    expect(receivedHeaders['anthropic-version']).toBe('2023-06-01');
  });

  it('exposes the connection through the same public contract', async () => {
    mockFetch(async () => makeResponse(200, '{"id":"msg_2","model":"claude-3-5-sonnet","content":[{"type":"text","text":"hello"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}'));
    const sign = async (request: HttpRequest): Promise<HttpRequest> => request;
    const pipeline = await createConnection({
      codec: anthropicCodec,
      auth: { type: 'signed', sign },
      baseURL: 'https://api.anthropic.com',
      extraHeaders: {},
      capabilities: { type: 'static', map: new Map([[toModelId('claude-3-5-sonnet'), caps]]) },
    });
    if (!pipeline.ok) throw new Error('expected connection ok');
    const connection = toPublicConnection(pipeline.value);
    const response = await connection.chat(request as never);
    expect(response.provider).toBe('anthropic');
    expect(response.content[0]).toMatchObject({ type: 'text', text: 'hello' });
  });
});