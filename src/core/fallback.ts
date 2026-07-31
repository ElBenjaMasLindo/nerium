import type { Pipeline } from '../types/connection.js';
import type { Result } from '../types/result.js';
import type { ChatRequest } from '../types/request.js';
import type { ChatResponse } from '../types/response.js';
import type { NeriumError } from '../types/error.js';
import type { ChatChunk } from '../types/stream.js';

export const composeFallback = (
  pipelines: readonly [Pipeline, ...ReadonlyArray<Pipeline>],
): Pipeline => ({
  chat: (request) => tryChatInOrder(pipelines, request),
  stream: (request) => tryStreamInOrder(pipelines, request),
  capabilitiesForModel: pipelines[0].capabilitiesForModel,
  listModels: pipelines[0].listModels,
});

const isTransient = (error: NeriumError): boolean => error.category === 'transient';

const tryChatInOrder = async (
  pipelines: readonly [Pipeline, ...ReadonlyArray<Pipeline>],
  request: ChatRequest,
): Promise<Result<ChatResponse, NeriumError>> => {
  const [first, ...rest] = pipelines;
  let acc = await first.chat(request);
  for (const pipeline of rest) {
    if (acc.ok || !isTransient(acc.error)) return acc;
    acc = await pipeline.chat(request);
  }
  return acc;
};

const skipFirstStream = (first: Result<ChatChunk, NeriumError>, isLast: boolean): boolean =>
  !first.ok && isTransient(first.error) && !isLast;

async function* tryStreamInOrder(
  pipelines: readonly [Pipeline, ...ReadonlyArray<Pipeline>],
  request: ChatRequest,
): AsyncGenerator<Result<ChatChunk, NeriumError>> {
  const list = [...pipelines];
  for (const [i, pipeline] of list.entries()) {
    const gen = pipeline.stream(request);
    const first = await gen.next();
    if (first.done) continue;
    const firstResult = first.value;
    if (skipFirstStream(firstResult, i === list.length - 1)) continue;
    yield firstResult;
    if (!firstResult.ok) return;
    yield* gen;
    return;
  }
}