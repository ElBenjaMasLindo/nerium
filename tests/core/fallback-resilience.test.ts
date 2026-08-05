import { describe, it, expect } from 'vitest';
import { composeFallback } from '../../src/core/fallback.js';
import { categorizeByStatus } from '../../src/core/http-status-category.js';
import { err, ok } from '../../src/types/result.js';
import type { Result } from '../../src/types/result.js';
import { none, some } from '../../src/types/option.js';
import { toModelId } from '../../src/types/branded.js';
import type { Pipeline } from '../../src/types/connection.js';
import type { ChatRequest } from '../../src/types/request.js';
import type { ChatResponse } from '../../src/types/response.js';
import type { ChatChunk } from '../../src/types/stream.js';
import type { NeriumError } from '../../src/types/error.js';
import type { Capabilities, ModelInfo } from '../../src/types/capabilities.js';

const dummyRequest: ChatRequest = {
  model: toModelId('gpt-4o'),
  messages: [],
  tools: [],
  responseFormat: none,
  sampling: { temperature: none, topP: none, maxOutputTokens: none, stopSequences: [] },
  signal: none,
  providerOptions: none,
};

const createError = (status: number): NeriumError => ({
  category: categorizeByStatus(status),
  code: `http_${status}`,
  provider: 'test-provider',
  status: some(status),
  message: `HTTP ${status}`,
  raw: none,
});

const createChatResponse = (provider: string, model: string): ChatResponse => ({
  content: [],
  finishReason: 'complete',
  usage: { input: 10, output: 20, total: 30, cacheWrite: none, cacheRead: none },
  provider,
  model: toModelId(model),
});

const defaultCaps: Capabilities = {
  streaming: true,
  tools: true,
  media: ['image/png'],
  reasoning: false,
  structuredOutput: true,
  contextWindow: 128000,
  promptCaching: true,
};

const createPipeline = (config: {
  name: string;
  chatResult: Result<ChatResponse, NeriumError>;
  streamChunks?: ReadonlyArray<Result<ChatChunk, NeriumError>>;
  capabilities?: Record<string, Capabilities>;
  models?: ReadonlyArray<ModelInfo>;
}): Pipeline => ({
  chat: async () => config.chatResult,
  stream: async function* () {
    const chunks = config.streamChunks ?? [
      ok<ChatChunk>({
        type: 'end',
        usage: { input: 10, output: 20, total: 30, cacheWrite: none, cacheRead: none },
        finishReason: 'complete',
      }),
    ];
    for (const chunk of chunks) yield chunk;
  },
  capabilitiesForModel: (model) => {
    const caps = config.capabilities?.[String(model)];
    return caps ? some(caps) : none;
  },
  listModels: config.models ? some(async () => ok(config.models ?? [])) : none,
});

describe('Fallback Engine Resilience', () => {
  describe('Capability Resolution across multi-provider pipelines', () => {
    it('resolves capabilities from the first provider that supports the model', () => {
      const openAiCaps: Capabilities = { ...defaultCaps, structuredOutput: true };
      const anthropicCaps: Capabilities = { ...defaultCaps, structuredOutput: false };

      const openAi = createPipeline({
        name: 'openai',
        chatResult: ok(createChatResponse('openai', 'gpt-4o')),
        capabilities: { 'gpt-4o': openAiCaps },
      });

      const anthropic = createPipeline({
        name: 'anthropic',
        chatResult: ok(createChatResponse('anthropic', 'claude-3-5-sonnet')),
        capabilities: { 'claude-3-5-sonnet': anthropicCaps },
      });

      const fallback = composeFallback([openAi, anthropic]);

      const gptCaps = fallback.capabilitiesForModel(toModelId('gpt-4o'));
      expect(gptCaps.some).toBe(true);
      if (gptCaps.some) expect(gptCaps.value.structuredOutput).toBe(true);

      const claudeCaps = fallback.capabilitiesForModel(toModelId('claude-3-5-sonnet'));
      expect(claudeCaps.some).toBe(true);
      if (claudeCaps.some) expect(claudeCaps.value.structuredOutput).toBe(false);

      const unknownCaps = fallback.capabilitiesForModel(toModelId('unknown-model'));
      expect(unknownCaps.some).toBe(false);
    });
  });

  describe('Model listing aggregation and de-duplication', () => {
    it('aggregates and de-duplicates models from multiple providers', async () => {
      const modelGpt: ModelInfo = { id: toModelId('gpt-4o'), capabilities: defaultCaps };
      const modelCommon: ModelInfo = { id: toModelId('common-m'), capabilities: defaultCaps };
      const modelClaude: ModelInfo = { id: toModelId('claude-3-5'), capabilities: defaultCaps };

      const openAi = createPipeline({
        name: 'openai',
        chatResult: ok(createChatResponse('openai', 'gpt-4o')),
        models: [modelGpt, modelCommon],
      });

      const anthropic = createPipeline({
        name: 'anthropic',
        chatResult: ok(createChatResponse('anthropic', 'claude-3-5')),
        models: [modelCommon, modelClaude],
      });

      const fallback = composeFallback([openAi, anthropic]);
      expect(fallback.listModels.some).toBe(true);

      if (fallback.listModels.some) {
        const listResult = await fallback.listModels.value();
        expect(listResult.ok).toBe(true);
        if (listResult.ok) {
          expect(listResult.value).toHaveLength(3);
          expect(listResult.value.map((m) => String(m.id))).toEqual([
            'gpt-4o', 'common-m', 'claude-3-5',
          ]);
        }
      }
    });
  });

  describe('HTTP 408 / 504 Transient Error Fallback Triggering', () => {
    it('triggers fallback on HTTP 408 Request Timeout', async () => {
      const openAi = createPipeline({
        name: 'openai',
        chatResult: err(createError(408)),
      });
      const anthropic = createPipeline({
        name: 'anthropic',
        chatResult: ok(createChatResponse('anthropic', 'claude-3-5-sonnet')),
      });

      const fallback = composeFallback([openAi, anthropic]);
      const res = await fallback.chat(dummyRequest);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.provider).toBe('anthropic');
    });

    it('triggers fallback on HTTP 504 Gateway Timeout', async () => {
      const openAi = createPipeline({
        name: 'openai',
        chatResult: err(createError(504)),
      });
      const anthropic = createPipeline({
        name: 'anthropic',
        chatResult: ok(createChatResponse('anthropic', 'claude-3-5-sonnet')),
      });

      const fallback = composeFallback([openAi, anthropic]);
      const res = await fallback.chat(dummyRequest);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.provider).toBe('anthropic');
    });

    it('falls back through multi-provider chain (OpenAI -> Anthropic -> Gemini)', async () => {
      const openAi = createPipeline({ name: 'openai', chatResult: err(createError(504)) });
      const anthropic = createPipeline({ name: 'anthropic', chatResult: err(createError(408)) });
      const gemini = createPipeline({
        name: 'gemini',
        chatResult: ok(createChatResponse('gemini', 'gemini-1.5-pro')),
      });

      const fallback = composeFallback([openAi, anthropic, gemini]);
      const res = await fallback.chat(dummyRequest);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.provider).toBe('gemini');
    });

    it('does NOT trigger fallback on non-transient HTTP 401 Unauthorized', async () => {
      const openAi = createPipeline({
        name: 'openai',
        chatResult: err(createError(401)),
      });
      const anthropic = createPipeline({
        name: 'anthropic',
        chatResult: ok(createChatResponse('anthropic', 'claude-3-5-sonnet')),
      });

      const fallback = composeFallback([openAi, anthropic]);
      const res = await fallback.chat(dummyRequest);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.status).toEqual(some(401));
    });
  });

  describe('Streaming Fallback Resilience', () => {
    it('triggers stream fallback when first chunk returns HTTP 408 transient error', async () => {
      const deltaChunk: ChatChunk = {
        type: 'delta',
        index: 0,
        delta: { type: 'text', text: 'anthropic stream' },
      };
      const openAi = createPipeline({
        name: 'openai',
        chatResult: ok(createChatResponse('openai', 'gpt-4o')),
        streamChunks: [err(createError(408))],
      });
      const anthropic = createPipeline({
        name: 'anthropic',
        chatResult: ok(createChatResponse('anthropic', 'claude-3-5-sonnet')),
        streamChunks: [ok<ChatChunk>(deltaChunk)],
      });

      const fallback = composeFallback([openAi, anthropic]);
      const chunks: Array<Result<ChatChunk, NeriumError>> = [];
      for await (const chunk of fallback.stream(dummyRequest)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      const firstChunk = chunks[0];
      expect(firstChunk).toBeDefined();
      if (firstChunk !== undefined) {
        expect(firstChunk.ok).toBe(true);
        if (firstChunk.ok && firstChunk.value.type === 'delta') {
          expect(firstChunk.value.delta).toEqual({ type: 'text', text: 'anthropic stream' });
        }
      }
    });

    it('does NOT trigger stream fallback when first chunk returns non-transient HTTP 403', async () => {
      const deltaChunk: ChatChunk = {
        type: 'delta',
        index: 0,
        delta: { type: 'text', text: 'anthropic stream' },
      };
      const openAi = createPipeline({
        name: 'openai',
        chatResult: ok(createChatResponse('openai', 'gpt-4o')),
        streamChunks: [err(createError(403))],
      });
      const anthropic = createPipeline({
        name: 'anthropic',
        chatResult: ok(createChatResponse('anthropic', 'claude-3-5-sonnet')),
        streamChunks: [ok<ChatChunk>(deltaChunk)],
      });

      const fallback = composeFallback([openAi, anthropic]);
      const chunks: Array<Result<ChatChunk, NeriumError>> = [];
      for await (const chunk of fallback.stream(dummyRequest)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      const firstChunk = chunks[0];
      expect(firstChunk).toBeDefined();
      if (firstChunk !== undefined) {
        expect(firstChunk.ok).toBe(false);
        if (!firstChunk.ok) expect(firstChunk.error.status).toEqual(some(403));
      }
    });
  });
});
