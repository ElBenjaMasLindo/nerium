import { describe, it, expect } from 'vitest';
import { openaiCodec } from '../../src/codecs/openai/index.js';
import { none, some } from '../../src/types/option.js';
import { toModelId } from '../../src/types/branded.js';
import type { ChatRequest } from '../../src/types/request.js';

const baseRequest: ChatRequest = {
  model: toModelId('gpt-4o'),
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi', providerOptions: none }] }],
  tools: [],
  responseFormat: none,
  sampling: { temperature: some(0.7), topP: none, maxOutputTokens: none, stopSequences: [] },
  signal: none,
  providerOptions: none,
};

describe('openai — buildRequest', () => {
  it('builds POST /chat/completions with stream=false and sampling for chat', () => {
    const out = openaiCodec.buildRequest(baseRequest, { baseURL: 'https://api.openai.com/v1', extraHeaders: {}, stream: false });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.method).toBe('POST');
    expect(out.value.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(out.value.body.some).toBe(true);
    if (!out.value.body.some) return;
    const payload = JSON.parse(out.value.body.value) as { stream: boolean; model: string; temperature: number };
    expect(payload.stream).toBe(false);
    expect(payload.model).toBe('gpt-4o');
    expect(payload.temperature).toBe(0.7);
  });

  it('sets stream=true when the config requests streaming', () => {
    const out = openaiCodec.buildRequest(baseRequest, { baseURL: 'https://api.openai.com/v1/', extraHeaders: {}, stream: true });
    expect(out.ok).toBe(true);
    if (!out.ok || !out.value.body.some) return;
    const payload = JSON.parse(out.value.body.value) as { stream: boolean };
    expect(payload.stream).toBe(true);
  });

  it('builds tools when provided', () => {
    const request: ChatRequest = {
      ...baseRequest,
      tools: [{ name: 'get_weather', description: 'weather', parameters: { type: 'object' } }],
    };
    const out = openaiCodec.buildRequest(request, { baseURL: 'https://api.openai.com/v1', extraHeaders: {}, stream: false });
    if (!out.ok || !out.value.body.some) throw new Error('expected ok');
    const payload = JSON.parse(out.value.body.value) as { tools: ReadonlyArray<{ type: 'function'; function: { name: string } }> };
    expect(payload.tools[0]?.function.name).toBe('get_weather');
  });
});