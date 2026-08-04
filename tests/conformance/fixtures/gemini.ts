import type { ResponseFixture, ChunkFixture, ErrorFixture } from '../harness.js';
import { none, some } from '../../../src/types/option.js';
import { toToolCallId, toModelId } from '../../../src/types/branded.js';

export const geminiResponseFixtures: ReadonlyArray<ResponseFixture> = [
  {
    description: 'STOP text response with cached tokens',
    raw: { status: 200, headers: { 'content-type': 'application/json' }, body: '{"candidates":[{"content":{"parts":[{"text":"Hello!"}],"role":"model"},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15,"cachedContentTokenCount":3}}' },
    expected: {
      ok: true,
      value: {
        content: [{ type: 'text', text: 'Hello!', providerOptions: none }],
        finishReason: 'complete',
        usage: { input: 10, output: 5, total: 15, cacheWrite: none, cacheRead: some(3) },
        provider: 'gemini',
        model: toModelId(''),
      },
    },
  },
  {
    description: 'functionCall presence forces finishReason tool_call',
    raw: { status: 200, headers: {}, body: '{"candidates":[{"content":{"parts":[{"text":"Let me check."},{"functionCall":{"name":"get_weather","args":{"city":"BA"}}}],"role":"model"},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":12,"totalTokenCount":20}}' },
    expected: {
      ok: true,
      value: {
        content: [
          { type: 'text', text: 'Let me check.', providerOptions: none },
          { type: 'tool_call', id: toToolCallId('get_weather'), name: 'get_weather', arguments: { city: 'BA' }, providerOptions: none },
        ],
        finishReason: 'tool_call',
        usage: { input: 8, output: 12, total: 20, cacheWrite: none, cacheRead: none },
        provider: 'gemini',
        model: toModelId(''),
      },
    },
  },
  {
    description: 'thought part maps to reasoning',
    raw: { status: 200, headers: {}, body: '{"candidates":[{"content":{"parts":[{"thought":true,"text":"hmm","thoughtSignature":"sig_g"},{"text":"ok"}],"role":"model"},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":2,"totalTokenCount":3}}' },
    expected: {
      ok: true,
      value: {
        content: [
          { type: 'reasoning', text: 'hmm', signature: some('sig_g'), providerOptions: none },
          { type: 'text', text: 'ok', providerOptions: none },
        ],
        finishReason: 'complete',
        usage: { input: 1, output: 2, total: 3, cacheWrite: none, cacheRead: none },
        provider: 'gemini',
        model: toModelId(''),
      },
    },
  },
  {
    description: 'SAFETY finishReason maps to filtered',
    raw: { status: 200, headers: {}, body: '{"candidates":[{"content":{"parts":[{"text":"partial"}],"role":"model"},"finishReason":"SAFETY"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}' },
    expected: {
      ok: true,
      value: {
        content: [{ type: 'text', text: 'partial', providerOptions: none }],
        finishReason: 'filtered',
        usage: { input: 1, output: 1, total: 2, cacheWrite: none, cacheRead: none },
        provider: 'gemini',
        model: toModelId(''),
      },
    },
  },
];

export const geminiChunkFixtures: ReadonlyArray<ChunkFixture> = [
  {
    description: 'text delta chunk',
    raw: { eventName: none, data: '{"candidates":[{"content":{"parts":[{"text":"Hi"}],"role":"model"}}]}' },
    expected: { ok: true, value: some({ type: 'delta', index: 0, delta: { type: 'text', text: 'Hi' } }) },
  },
  {
    description: 'functionCall chunk becomes a tool_call start',
    raw: { eventName: none, data: '{"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_weather","args":{"city":"BA"}}}],"role":"model"}}]}' },
    expected: { ok: true, value: some({ type: 'start', index: 0, block: { type: 'tool_call', id: toToolCallId('get_weather'), name: 'get_weather' } }) },
  },
  {
    description: 'functionCall finish maps to tool_call',
    raw: { eventName: none, data: '{"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_weather","args":{"city":"BA"}}}]},"finishReason":"STOP"}]}' },
    expected: { ok: true, value: some({ type: 'end', usage: { input: 0, output: 0, total: 0, cacheWrite: none, cacheRead: none }, finishReason: 'tool_call' }) },
  },
  {
    description: 'thought signature survives empty streaming text',
    raw: { eventName: none, data: '{"candidates":[{"content":{"parts":[{"thought":true,"text":"","thoughtSignature":"sig_empty"}]}}]}' },
    expected: { ok: true, value: some({ type: 'delta', index: 0, delta: { type: 'reasoning', text: '', signature: some('sig_empty') } }) },
  },
  {
    description: 'end chunk with finishReason',
    raw: { eventName: none, data: '{"candidates":[{"content":{"parts":[{"text":""}],"role":"model"},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}' },
    expected: { ok: true, value: some({ type: 'end', usage: { input: 1, output: 1, total: 2, cacheWrite: none, cacheRead: none }, finishReason: 'complete' }) },
  },
  {
    description: 'end chunk with finishReason SAFETY maps to filtered',
    raw: { eventName: none, data: '{"candidates":[{"content":{"parts":[{"text":""}],"role":"model"},"finishReason":"SAFETY"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":0,"totalTokenCount":1}}' },
    expected: { ok: true, value: some({ type: 'end', usage: { input: 1, output: 0, total: 1, cacheWrite: none, cacheRead: none }, finishReason: 'filtered' }) },
  },
  {
    description: 'end chunk with finishReason MAX_TOKENS maps to max_tokens',
    raw: { eventName: none, data: '{"candidates":[{"content":{"parts":[{"text":""}],"role":"model"},"finishReason":"MAX_TOKENS"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":2,"totalTokenCount":3}}' },
    expected: { ok: true, value: some({ type: 'end', usage: { input: 1, output: 2, total: 3, cacheWrite: none, cacheRead: none }, finishReason: 'max_tokens' }) },
  },
  {
    description: 'chunk without candidates is discarded',
    raw: { eventName: none, data: '{"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":0,"totalTokenCount":1}}' },
    expected: { ok: true, value: none },
  },
];

export const geminiErrorFixtures: ReadonlyArray<ErrorFixture> = [
  {
    description: '400 invalid',
    raw: { status: 400, headers: {}, body: '{"error":{"code":400,"message":"Invalid request","status":"INVALID_ARGUMENT"}}' },
    expected: { category: 'invalid', code: 'gemini_error', provider: 'gemini', status: some(400), message: 'Invalid request', raw: '{"error":{"code":400,"message":"Invalid request","status":"INVALID_ARGUMENT"}}' },
  },
  {
    description: '429 transient',
    raw: { status: 429, headers: {}, body: '{"error":{"code":429,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}' },
    expected: { category: 'transient', code: 'gemini_error', provider: 'gemini', status: some(429), message: 'Quota exceeded', raw: '{"error":{"code":429,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}' },
  },
  {
    description: 'PERMISSION_DENIED becomes refused',
    raw: { status: 403, headers: {}, body: '{"error":{"code":403,"message":"not allowed","status":"PERMISSION_DENIED"}}' },
    expected: { category: 'refused', code: 'gemini_error', provider: 'gemini', status: some(403), message: 'not allowed', raw: '{"error":{"code":403,"message":"not allowed","status":"PERMISSION_DENIED"}}' },
  },
];