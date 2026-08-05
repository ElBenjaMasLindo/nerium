import { some, none } from '../types/option.js';
import type { Option } from '../types/option.js';
import type { Pipeline, Connection } from '../types/connection.js';
import type { ModelInfo } from '../types/capabilities.js';
import type { Result } from '../types/result.js';
import { publicStream } from './stream.js';

const unwrapList = (result: Result<ReadonlyArray<ModelInfo>, unknown>): ReadonlyArray<ModelInfo> => {
  if (result.ok) return result.value;
  throw result.error;
};

const publicListModels = (pipeline: Pipeline): Option<() => Promise<ReadonlyArray<ModelInfo>>> => {
  if (pipeline.listModels.some) {
    const listFn = pipeline.listModels.value;
    return some(async () => unwrapList(await listFn()));
  }
  return none;
};

export const toPublicConnection = (pipeline: Pipeline): Connection => ({
  chat: async (request) => {
    const res = await pipeline.chat(request);
    if (res.ok) return res.value;
    throw res.error;
  },
  stream: publicStream(pipeline),
  capabilitiesForModel: pipeline.capabilitiesForModel,
  listModels: publicListModels(pipeline),
});