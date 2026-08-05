import { describe, it, expect } from 'vitest';
import { openaiCodec } from '../../src/codecs/openai/index.js';
import { parseChunk, parseResponse } from '../../src/codecs/openai/parse.js';
import { none, some } from '../../src/types/option.js';
import { toModelId, toToolCallId } from '../../src/types/branded.js';
import type { ChatRequest } from '../../src/types/request.js';
import type { RawHttpResponse, RawStreamEvent } from '../../src/types/http-wire.js';

const baseRequest: ChatRequest = {
  model: toModelId('gpt-4o'),
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi', providerOptions: none }] }],
  tools: [],
  responseFormat: none,
  sampling: { temperature: some(0.7), topP: none, maxOutputTokens: none, stopSequences: [] },
  signal: none,
  providerOptions: none,
};

const makeHttpResponse = (status: number, body: string): RawHttpResponse => ({
  status,
  headers: { 'content-type': 'application/json' },
  body,
});

const makeStreamEvent = (data: string): RawStreamEvent => ({
  eventName: none,
  data,
});

describe('OpenAI Codec Wire & Parsing', () => {
  describe('responseFormat payload generation', () => {
    it('generates response_format with json_schema when responseFormat is some', () => {
      const schema = { type: 'object', properties: { count: { type: 'number' } } };
      const req: ChatRequest = { ...baseRequest, responseFormat: some({ schema }) };
      const res = openaiCodec.buildRequest(req, { baseURL: 'https://api.openai.com/v1', extraHeaders: {}, stream: false });
      expect(res.ok).toBe(true);
      if (!res.ok || !res.value.body.some) return;

      const payload = JSON.parse(res.value.body.value) as { response_format?: unknown };
      expect(payload.response_format).toEqual({
        type: 'json_schema',
        json_schema: { name: 'response', schema, strict: true },
      });
    });

    it('omits response_format when responseFormat is none', () => {
      const res = openaiCodec.buildRequest(baseRequest, { baseURL: 'https://api.openai.com/v1', extraHeaders: {}, stream: false });
      expect(res.ok).toBe(true);
      if (!res.ok || !res.value.body.some) return;

      const payload = JSON.parse(res.value.body.value) as { response_format?: unknown };
      expect(payload.response_format).toBeUndefined();
    });
  });

  describe('parallel tool call streaming chunks', () => {
    it('parses tool call start chunk for index 0', () => {
      const eventData = JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_abc', function: { name: 'get_weather', arguments: '' } }] } }],
      });
      const parsed = parseChunk(makeStreamEvent(eventData));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || !parsed.value.some || Array.isArray(parsed.value.value)) return;
      expect(parsed.value.value).toEqual({
        type: 'start',
        index: 0,
        block: { type: 'tool_call', id: toToolCallId('call_abc'), name: 'get_weather' },
      });
    });

    it('parses tool call delta chunk for index 0', () => {
      const eventData = JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":"' } }] } }],
      });
      const parsed = parseChunk(makeStreamEvent(eventData));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || !parsed.value.some || Array.isArray(parsed.value.value)) return;
      expect(parsed.value.value).toEqual({
        type: 'delta',
        index: 0,
        delta: { type: 'tool_call', argumentsFragment: '{"city":"' },
      });
    });

    it('parses tool call start and delta for parallel index 1', () => {
      const startData = JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_def', function: { name: 'get_time', arguments: '' } }] } }],
      });
      const startParsed = parseChunk(makeStreamEvent(startData));
      expect(startParsed.ok).toBe(true);
      if (!startParsed.ok || !startParsed.value.some || Array.isArray(startParsed.value.value)) return;
      expect(startParsed.value.value).toEqual({
        type: 'start',
        index: 1,
        block: { type: 'tool_call', id: toToolCallId('call_def'), name: 'get_time' },
      });

      const deltaData = JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{"tz":"UTC"}' } }] } }],
      });
      const deltaParsed = parseChunk(makeStreamEvent(deltaData));
      expect(deltaParsed.ok).toBe(true);
      if (!deltaParsed.ok || !deltaParsed.value.some || Array.isArray(deltaParsed.value.value)) return;
      expect(deltaParsed.value.value).toEqual({
        type: 'delta',
        index: 1,
        delta: { type: 'tool_call', argumentsFragment: '{"tz":"UTC"}' },
      });
    });
  });

  describe('reasoning_content deltas', () => {
    it('parses reasoning_content in stream delta', () => {
      const eventData = JSON.stringify({
        choices: [{ delta: { reasoning_content: 'Analyzing user input...' } }],
      });
      const parsed = parseChunk(makeStreamEvent(eventData));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || !parsed.value.some || Array.isArray(parsed.value.value)) return;
      expect(parsed.value.value).toEqual({
        type: 'delta',
        index: 0,
        delta: { type: 'reasoning', text: 'Analyzing user input...', signature: none },
      });
    });

    it('parses reasoning_content in non-streaming response', () => {
      const body = JSON.stringify({
        choices: [{ message: { role: 'assistant', reasoning_content: 'Step 1: examine request', content: 'Final answer' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model: 'o3-mini',
      });
      const parsed = parseResponse(makeHttpResponse(200, body));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.content).toHaveLength(2);
      expect(parsed.value.content[0]).toEqual({
        type: 'reasoning',
        text: 'Step 1: examine request',
        signature: none,
        providerOptions: none,
      });
      expect(parsed.value.content[1]).toEqual({
        type: 'text',
        text: 'Final answer',
        providerOptions: none,
      });
    });
  });

  describe('usage chunk collection', () => {
    it('parses standalone usage chunk when choices array is empty', () => {
      const eventData = JSON.stringify({
        choices: [],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 34,
          total_tokens: 46,
          prompt_tokens_details: { cached_tokens: 8 },
        },
      });
      const parsed = parseChunk(makeStreamEvent(eventData));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || !parsed.value.some || Array.isArray(parsed.value.value)) return;
      expect(parsed.value.value).toEqual({
        type: 'usage',
        usage: {
          input: 12,
          output: 34,
          total: 46,
          cacheWrite: none,
          cacheRead: some(8),
        },
      });
    });

    it('parses usage in finish chunk', () => {
      const eventData = JSON.stringify({
        choices: [{ finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      });
      const parsed = parseChunk(makeStreamEvent(eventData));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || !parsed.value.some || Array.isArray(parsed.value.value)) return;
      expect(parsed.value.value).toEqual({
        type: 'end',
        finishReason: 'complete',
        usage: { input: 10, output: 20, total: 30, cacheWrite: none, cacheRead: none },
      });
    });
  });
});
