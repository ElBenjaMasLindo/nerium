import type { ResponseFixture, ChunkFixture, ErrorFixture } from '../harness.js';
import { none, some } from '../../../src/types/option.js';
import { toToolCallId, toModelId } from '../../../src/types/branded.js';

export const openaiResponseFixtures: ReadonlyArray<ResponseFixture> = [
  {
    description: 'respuesta exitosa con una sola tool call',
    raw: { status: 200, headers: { 'content-type': 'application/json' }, body: '{"id":"chatcmpl-1","object":"chat.completion","model":"gpt-4o","choices":[{"index":0,"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\\"city\\":\\"BA\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}' },
    expected: {
      ok: true,
      value: {
        content: [{ type: 'tool_call', id: toToolCallId('call_1'), name: 'get_weather', arguments: { city: 'BA' }, providerOptions: none }],
        finishReason: 'tool_call',
        usage: { input: 10, output: 5, total: 15, cacheWrite: none, cacheRead: none },
        provider: 'openai',
        model: toModelId('gpt-4o'),
      },
    },
  },
  {
    description: 'respuesta de texto simple',
    raw: { status: 200, headers: { 'content-type': 'application/json' }, body: '{"id":"chatcmpl-2","object":"chat.completion","model":"gpt-4o","choices":[{"index":0,"message":{"role":"assistant","content":"Hello!"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}' },
    expected: {
      ok: true,
      value: {
        content: [{ type: 'text', text: 'Hello!', providerOptions: none }],
        finishReason: 'complete',
        usage: { input: 3, output: 2, total: 5, cacheWrite: none, cacheRead: none },
        provider: 'openai',
        model: toModelId('gpt-4o'),
      },
    },
  },
];

export const openaiChunkFixtures: ReadonlyArray<ChunkFixture> = [
  {
    description: 'streaming start (role assistant)',
    raw: { eventName: none, data: '{"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}' },
    expected: { ok: true, value: { some: true, value: { type: 'start', index: 0, block: { type: 'text' } } } },
  },
  {
    description: 'text delta',
    raw: { eventName: none, data: '{"choices":[{"index":0,"delta":{"content":"Hi"}}]}' },
    expected: { ok: true, value: { some: true, value: { type: 'delta', index: 0, delta: { type: 'text', text: 'Hi' } } } },
  },
  {
    description: 'tool_call start (id present)',
    raw: { eventName: none, data: '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_9","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}' },
    expected: { ok: true, value: { some: true, value: { type: 'start', index: 0, block: { type: 'tool_call', id: toToolCallId('call_9'), name: 'get_weather' } } } },
  },
  {
    description: 'tool_call arguments delta',
    raw: { eventName: none, data: '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"city"}}]}}]}' },
    expected: { ok: true, value: { some: true, value: { type: 'delta', index: 0, delta: { type: 'tool_call', argumentsFragment: 'city' } } } },
  },
  {
    description: 'end chunk with finish_reason stop',
    raw: { eventName: none, data: '{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}' },
    expected: { ok: true, value: { some: true, value: { type: 'end', usage: { input: 0, output: 0, total: 0, cacheWrite: none, cacheRead: none }, finishReason: 'complete' } } },
  },
  {
    description: 'DONE marker is discarded',
    raw: { eventName: none, data: '[DONE]' },
    expected: { ok: true, value: none },
  },
  {
    description: 'usage-only chunk (empty choices) is discarded',
    raw: { eventName: none, data: '{"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}' },
    expected: { ok: true, value: none },
  },
];

export const openaiErrorFixtures: ReadonlyArray<ErrorFixture> = [
  {
    description: '401 invalid (bad api key)',
    raw: { status: 401, headers: {}, body: '{"error":{"message":"Incorrect API key provided","type":"invalid_request_error","code":"invalid_api_key"}}' },
    expected: { category: 'invalid', code: 'invalid_api_key', provider: 'openai', status: { some: true, value: 401 }, message: 'Incorrect API key provided', raw: '{"error":{"message":"Incorrect API key provided","type":"invalid_request_error","code":"invalid_api_key"}}' },
  },
  {
    description: '429 transient (rate limit)',
    raw: { status: 429, headers: {}, body: '{"error":{"message":"Rate limit reached","type":"rate_limit_exceeded"}}' },
    expected: { category: 'transient', code: 'rate_limit_exceeded', provider: 'openai', status: { some: true, value: 429 }, message: 'Rate limit reached', raw: '{"error":{"message":"Rate limit reached","type":"rate_limit_exceeded"}}' },
  },
  {
    description: '400 with content_filter becomes refused',
    raw: { status: 400, headers: {}, body: '{"error":{"message":"Output blocked by content filter","type":"content_filter"}}' },
    expected: { category: 'refused', code: 'content_filter', provider: 'openai', status: { some: true, value: 400 }, message: 'Output blocked by content filter', raw: '{"error":{"message":"Output blocked by content filter","type":"content_filter"}}' },
  },
];