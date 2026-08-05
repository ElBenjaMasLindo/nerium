import { describe, it, expect } from 'vitest';
import { composeFallback } from '../../src/core/fallback.js';
import { err, ok } from '../../src/types/result.js';
import type { Result } from '../../src/types/result.js';
import { none } from '../../src/types/option.js';
import { toModelId } from '../../src/types/branded.js';
import type { Pipeline } from '../../src/types/connection.js';
import type { ChatRequest } from '../../src/types/request.js';
import type { ChatResponse } from '../../src/types/response.js';
import type { ChatChunk } from '../../src/types/stream.js';
import type { NeriumError } from '../../src/types/error.js';

const mkError = (category: NeriumError['category']): NeriumError => ({
  category, code: 'x', provider: 'p', status: none, message: category, raw: none,
});

const chatOK = (model: string): ChatResponse => ({
  content: [], finishReason: 'complete',
  usage: { input: 0, output: 0, total: 0, cacheWrite: none, cacheRead: none },
  provider: 'p', model: toModelId(model),
});

const request: ChatRequest = {
  model: toModelId('m'),
  messages: [],
  tools: [],
  responseFormat: none,
  sampling: { temperature: none, topP: none, maxOutputTokens: none, stopSequences: [] },
  signal: none,
  providerOptions: none,
};

const mkPipeline = (result: Result<ChatResponse, NeriumError>, model: string): Pipeline => ({
  chat: async () => result,
  stream: async function* () {
    yield ok<ChatChunk>({ type: 'end', usage: { input: 0, output: 0, total: 0, cacheWrite: none, cacheRead: none }, finishReason: 'complete' });
  },
  capabilitiesForModel: () => none,
  listModels: none,
});

describe('composeFallback (chat)', () => {
  it('skips to the second pipeline only on transient', async () => {
    const first = mkPipeline(err(mkError('transient')), 'a');
    const second = mkPipeline(ok(chatOK('b')), 'b');
    const out = await composeFallback([first, second]).chat(request);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.model).toBe('b');
  });

  it('propagates non-transient errors without trying the next pipeline', async () => {
    const first = mkPipeline(err(mkError('invalid')), 'a');
    const second = mkPipeline(ok(chatOK('b')), 'b');
    const out = await composeFallback([first, second]).chat(request);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.category).toBe('invalid');
  });

  it('returns the first result when it is ok', async () => {
    const first = mkPipeline(ok(chatOK('a')), 'a');
    const out = await composeFallback([first, mkPipeline(ok(chatOK('b')), 'b')]).chat(request);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.model).toBe('a');
  });
});