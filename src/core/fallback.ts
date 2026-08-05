import type { Pipeline } from '../types/connection.js';
import type { Result } from '../types/result.js';
import { ok } from '../types/result.js';
import type { Option } from '../types/option.js';
import { none, some } from '../types/option.js';
import type { ChatRequest } from '../types/request.js';
import type { ChatResponse } from '../types/response.js';
import type { NeriumError } from '../types/error.js';
import type { ChatChunk } from '../types/stream.js';
import type { Capabilities, ModelInfo } from '../types/capabilities.js';
import type { ModelId } from '../types/branded.js';

const aggregateCapabilities = (
  pipelines: readonly [Pipeline, ...ReadonlyArray<Pipeline>],
  model: ModelId,
): Option<Capabilities> => {
  for (const pipeline of pipelines) {
    const caps = pipeline.capabilitiesForModel(model);
    if (caps.some) return caps;
  }
  return none;
};

const collectModelsFromPipeline = async (
  pipeline: Pipeline,
  seen: Set<string>,
  out: ModelInfo[],
): Promise<void> => {
  if (!pipeline.listModels.some) return;
  const res = await pipeline.listModels.value();
  if (!res.ok) return;
  for (const m of res.value) {
    if (!seen.has(String(m.id))) {
      seen.add(String(m.id));
      out.push(m);
    }
  }
};

const aggregateListModels = (
  pipelines: readonly [Pipeline, ...ReadonlyArray<Pipeline>],
): Option<() => Promise<Result<ReadonlyArray<ModelInfo>, NeriumError>>> => {
  if (!pipelines.some((p) => p.listModels.some)) return none;
  return some(async () => {
    const allModels: ModelInfo[] = [];
    const seen = new Set<string>();
    for (const p of pipelines) await collectModelsFromPipeline(p, seen, allModels);
    return ok(allModels);
  });
};

export const composeFallback = (
  pipelines: readonly [Pipeline, ...ReadonlyArray<Pipeline>],
): Pipeline => ({
  chat: (request) => tryChatInOrder(pipelines, request),
  stream: (request) => tryStreamInOrder(pipelines, request),
  capabilitiesForModel: (model) => aggregateCapabilities(pipelines, model),
  listModels: aggregateListModels(pipelines),
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