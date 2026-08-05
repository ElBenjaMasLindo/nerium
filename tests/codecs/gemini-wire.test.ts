import { describe, it, expect } from 'vitest';
import { geminiCodec } from '../../src/codecs/gemini/index.js';
import { parseChunk, parseResponse } from '../../src/codecs/gemini/parse.js';
import { none, some } from '../../src/types/option.js';
import { toModelId, toToolCallId } from '../../src/types/branded.js';
import type { ChatRequest, Message } from '../../src/types/request.js';
import type { RawHttpResponse, RawStreamEvent } from '../../src/types/http-wire.js';

const baseRequest: ChatRequest = {
  model: toModelId('gemini-1.5-pro'),
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello', providerOptions: none }] }],
  tools: [],
  responseFormat: none,
  sampling: { temperature: some(0.4), topP: none, maxOutputTokens: some(512), stopSequences: [] },
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

describe('Gemini Codec Wire & Parsing', () => {
  describe('structured output payload generation', () => {
    it('populates responseMimeType and responseSchema in generationConfig when responseFormat is present', () => {
      const schema = { type: 'OBJECT', properties: { answer: { type: 'STRING' } } };
      const req: ChatRequest = { ...baseRequest, responseFormat: some({ schema }) };
      const res = geminiCodec.buildRequest(req, { baseURL: 'https://generativelanguage.googleapis.com', extraHeaders: {}, stream: false });
      expect(res.ok).toBe(true);
      if (!res.ok || !res.value.body.some) return;

      const payload = JSON.parse(res.value.body.value) as {
        generationConfig?: { responseMimeType?: string; responseSchema?: unknown };
      };
      expect(payload.generationConfig?.responseMimeType).toBe('application/json');
      expect(payload.generationConfig?.responseSchema).toEqual(schema);
    });

    it('omits responseMimeType and responseSchema when responseFormat is none', () => {
      const res = geminiCodec.buildRequest(baseRequest, { baseURL: 'https://generativelanguage.googleapis.com', extraHeaders: {}, stream: false });
      expect(res.ok).toBe(true);
      if (!res.ok || !res.value.body.some) return;

      const payload = JSON.parse(res.value.body.value) as {
        generationConfig?: { responseMimeType?: string; responseSchema?: unknown };
      };
      expect(payload.generationConfig?.responseMimeType).toBeUndefined();
      expect(payload.generationConfig?.responseSchema).toBeUndefined();
    });
  });

  describe('base URL query joining', () => {
    it('appends alt=sse using ? when baseURL has no query parameters', () => {
      const res = geminiCodec.buildRequest(baseRequest, {
        baseURL: 'https://generativelanguage.googleapis.com',
        extraHeaders: {},
        stream: true,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:streamGenerateContent?alt=sse',
      );
    });

    it('appends alt=sse using & when baseURL already contains ?key=...', () => {
      const res = geminiCodec.buildRequest(baseRequest, {
        baseURL: 'https://generativelanguage.googleapis.com?key=SECRET_API_KEY',
        extraHeaders: {},
        stream: true,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.url).toBe(
        'https://generativelanguage.googleapis.com?key=SECRET_API_KEY/v1beta/models/gemini-1.5-pro:streamGenerateContent&alt=sse',
      );
    });
  });

  describe('tool call ID mapping', () => {
    it('mints tool call ID from function name when parsing functionCall response', () => {
      const body = JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'get_stock_price', args: { symbol: 'NRM' } } }],
            },
            finishReason: 'STOP',
          },
        ],
        model: 'gemini-1.5-pro',
      });
      const parsed = parseResponse(makeHttpResponse(200, body));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.content).toHaveLength(1);
      expect(parsed.value.content[0]).toEqual({
        type: 'tool_call',
        id: toToolCallId('get_stock_price'),
        name: 'get_stock_price',
        arguments: { symbol: 'NRM' },
        providerOptions: none,
      });
      expect(parsed.value.finishReason).toBe('tool_call');
    });

    it('maps tool_result content block to functionResponse with function name in name field', () => {
      const messages: ReadonlyArray<Message> = [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolCallId: toToolCallId('get_stock_price'),
              result: { price: 100 },
              providerOptions: none,
            },
          ],
        },
      ];
      const req: ChatRequest = { ...baseRequest, messages };
      const res = geminiCodec.buildRequest(req, { baseURL: 'https://generativelanguage.googleapis.com', extraHeaders: {}, stream: false });
      expect(res.ok).toBe(true);
      if (!res.ok || !res.value.body.some) return;

      const payload = JSON.parse(res.value.body.value) as {
        contents: ReadonlyArray<{ parts: ReadonlyArray<{ functionResponse?: { name: string; response: unknown } }> }>;
      };
      expect(payload.contents[0]?.parts[0]?.functionResponse).toEqual({
        name: 'get_stock_price',
        response: { price: 100 },
      });
    });
  });

  describe('final streaming chunk token extraction', () => {
    it('extracts token usage and finish reason alongside text delta in final stream chunk', () => {
      const eventData = JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: 'Done.' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 150,
          candidatesTokenCount: 75,
          totalTokenCount: 225,
          cachedContentTokenCount: 30,
        },
      });

      const parsed = parseChunk(makeStreamEvent(eventData));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || !parsed.value.some || !Array.isArray(parsed.value.value)) return;

      const chunks = parsed.value.value;
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toEqual({
        type: 'delta',
        index: 0,
        delta: { type: 'text', text: 'Done.' },
      });
      expect(chunks[1]).toEqual({
        type: 'end',
        finishReason: 'complete',
        usage: {
          input: 150,
          output: 75,
          total: 225,
          cacheWrite: none,
          cacheRead: some(30),
        },
      });
    });

    it('extracts token usage in standalone end chunk when no parts are present', () => {
      const eventData = JSON.stringify({
        candidates: [{ finishReason: 'STOP' }],
        usageMetadata: {
          promptTokenCount: 40,
          candidatesTokenCount: 60,
          totalTokenCount: 100,
        },
      });

      const parsed = parseChunk(makeStreamEvent(eventData));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || !parsed.value.some || Array.isArray(parsed.value.value)) return;

      expect(parsed.value.value).toEqual({
        type: 'end',
        finishReason: 'complete',
        usage: {
          input: 40,
          output: 60,
          total: 100,
          cacheWrite: none,
          cacheRead: none,
        },
      });
    });
  });
});
