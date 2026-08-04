import type { ResponseFixture, ChunkFixture, ErrorFixture } from '../harness.js';
import { none, some } from '../../../src/types/option.js';
import { toToolCallId, toModelId } from '../../../src/types/branded.js';

export const anthropicResponseFixtures: ReadonlyArray<ResponseFixture> = [
  {
    description: 'end_turn text response with cache usage',
    raw: { status: 200, headers: { 'content-type': 'application/json' }, body: '{"id":"msg_1","type":"message","role":"assistant","model":"claude-3-5-sonnet","content":[{"type":"text","text":"Hello!"}],"stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":2,"cache_read_input_tokens":3}}' },
    expected: {
      ok: true,
      value: {
        content: [{ type: 'text', text: 'Hello!', providerOptions: none }],
        finishReason: 'complete',
        usage: { input: 10, output: 5, total: 15, cacheWrite: some(2), cacheRead: some(3) },
        provider: 'anthropic',
        model: toModelId('claude-3-5-sonnet'),
      },
    },
  },
  {
    description: 'tool_use stop reason with one tool_use block',
    raw: { status: 200, headers: {}, body: '{"id":"msg_2","type":"message","role":"assistant","model":"claude-3-5-sonnet","content":[{"type":"text","text":"Let me check."},{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{"city":"BA"}}],"stop_reason":"tool_use","usage":{"input_tokens":8,"output_tokens":12}}' },
    expected: {
      ok: true,
      value: {
        content: [
          { type: 'text', text: 'Let me check.', providerOptions: none },
          { type: 'tool_call', id: toToolCallId('toolu_1'), name: 'get_weather', arguments: { city: 'BA' }, providerOptions: none },
        ],
        finishReason: 'tool_call',
        usage: { input: 8, output: 12, total: 20, cacheWrite: none, cacheRead: none },
        provider: 'anthropic',
        model: toModelId('claude-3-5-sonnet'),
      },
    },
  },
  {
    description: 'thinking block maps to reasoning',
    raw: { status: 200, headers: {}, body: '{"id":"msg_3","model":"claude-3-7-sonnet","content":[{"type":"thinking","thinking":"hmm","signature":"sig_1"},{"type":"text","text":"ok"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":2}}' },
    expected: {
      ok: true,
      value: {
        content: [
          { type: 'reasoning', text: 'hmm', signature: some('sig_1'), providerOptions: none },
          { type: 'text', text: 'ok', providerOptions: none },
        ],
        finishReason: 'complete',
        usage: { input: 1, output: 2, total: 3, cacheWrite: none, cacheRead: none },
        provider: 'anthropic',
        model: toModelId('claude-3-7-sonnet'),
      },
    },
  },
  {
    description: 'unknown block type becomes opaque',
    raw: { status: 200, headers: {}, body: '{"id":"msg_4","model":"claude-3","content":[{"type":"server_tool_use","name":"web_search","input":{}}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}' },
    expected: {
      ok: true,
      value: {
        content: [{ type: 'opaque', subtype: 'server_tool_use', raw: { type: 'server_tool_use', name: 'web_search', input: {} }, providerOptions: none }],
        finishReason: 'complete',
        usage: { input: 1, output: 1, total: 2, cacheWrite: none, cacheRead: none },
        provider: 'anthropic',
        model: toModelId('claude-3'),
      },
    },
  },
];

export const anthropicChunkFixtures: ReadonlyArray<ChunkFixture> = [
  {
    description: 'content_block_start text',
    raw: { eventName: some('content_block_start'), data: '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}' },
    expected: { ok: true, value: some({ type: 'start', index: 0, block: { type: 'text' } }) },
  },
  {
    description: 'content_block_start tool_use',
    raw: { eventName: some('content_block_start'), data: '{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_2","name":"get_weather","input":{}}}' },
    expected: { ok: true, value: some({ type: 'start', index: 1, block: { type: 'tool_call', id: toToolCallId('toolu_2'), name: 'get_weather' } }) },
  },
  {
    description: 'content_block_delta text_delta',
    raw: { eventName: some('content_block_delta'), data: '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}' },
    expected: { ok: true, value: some({ type: 'delta', index: 0, delta: { type: 'text', text: 'Hi' } }) },
  },
  {
    description: 'content_block_delta input_json_delta',
    raw: { eventName: some('content_block_delta'), data: '{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\""}}' },
    expected: { ok: true, value: some({ type: 'delta', index: 1, delta: { type: 'tool_call', argumentsFragment: '{"city"' } }) },
  },
  {
    description: 'signature_delta preserves thinking signature',
    raw: { eventName: some('content_block_delta'), data: '{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig_2"}}' },
    expected: { ok: true, value: some({ type: 'delta', index: 0, delta: { type: 'reasoning', text: '', signature: some('sig_2') } }) },
  },
  {
    description: 'message_delta end with stop_reason',
    raw: { eventName: some('message_delta'), data: '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}' },
    expected: { ok: true, value: some({ type: 'end', usage: { input: 0, output: 5, total: 5, cacheWrite: none, cacheRead: none }, finishReason: 'complete' }) },
  },
  {
    description: 'unrelated event (ping) is discarded',
    raw: { eventName: some('ping'), data: '{"type":"ping"}' },
    expected: { ok: true, value: none },
  },
];

export const anthropicErrorFixtures: ReadonlyArray<ErrorFixture> = [
  {
    description: '401 invalid',
    raw: { status: 401, headers: {}, body: '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}' },
    expected: { category: 'invalid', code: 'anthropic_error', provider: 'anthropic', status: some(401), message: 'invalid x-api-key', raw: '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}' },
  },
  {
    description: '429 transient',
    raw: { status: 429, headers: {}, body: '{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}' },
    expected: { category: 'transient', code: 'anthropic_error', provider: 'anthropic', status: some(429), message: 'slow down', raw: '{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}' },
  },
  {
    description: 'permission_error becomes refused',
    raw: { status: 403, headers: {}, body: '{"type":"error","error":{"type":"permission_error","message":"not allowed"}}' },
    expected: { category: 'refused', code: 'anthropic_error', provider: 'anthropic', status: some(403), message: 'not allowed', raw: '{"type":"error","error":{"type":"permission_error","message":"not allowed"}}' },
  },
];