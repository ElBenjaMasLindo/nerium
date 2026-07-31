import { match } from 'ts-pattern';
import { some, none } from '../types/option.js';
import type { Option } from '../types/option.js';
import type { Pipeline, Connection } from '../types/connection.js';
import type { ModelInfo } from '../types/capabilities.js';
import type { Result } from '../types/result.js';
import { publicStream } from './stream.js';

const unwrapList = (result: Result<ReadonlyArray<ModelInfo>, unknown>): ReadonlyArray<ModelInfo> =>
  match(result)
    .with({ ok: true }, (r) => r.value)
    .with({ ok: false }, (r): never => { throw r.error; })
    .exhaustive();

const publicListModels = (pipeline: Pipeline): Option<() => Promise<ReadonlyArray<ModelInfo>>> =>
  match(pipeline.listModels)
    .with({ some: true }, (l) => some(async () => unwrapList(await l.value())))
    .with({ some: false }, () => none)
    .exhaustive();

export const toPublicConnection = (pipeline: Pipeline): Connection => ({
  chat: async (request) => match(await pipeline.chat(request))
    .with({ ok: true }, (r) => r.value)
    .with({ ok: false }, (r): never => { throw r.error; })
    .exhaustive(),
  stream: publicStream(pipeline),
  capabilitiesForModel: pipeline.capabilitiesForModel,
  listModels: publicListModels(pipeline),
});