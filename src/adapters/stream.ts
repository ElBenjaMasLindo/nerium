import { match } from 'ts-pattern';
import { some } from '../types/option.js';
import type { Option } from '../types/option.js';
import type { Pipeline } from '../types/connection.js';
import type { ChatRequest } from '../types/request.js';
import type { ChatChunk } from '../types/stream.js';
import type { Result } from '../types/result.js';

const matchChunk = (result: Result<ChatChunk, unknown>): Option<ChatChunk> =>
  match(result)
    .with({ ok: true }, (r) => some(r.value))
    .with({ ok: false }, (r): never => { throw r.error; })
    .exhaustive();

export const publicStream = (pipeline: Pipeline) =>
  async function* (request: ChatRequest): AsyncGenerator<ChatChunk> {
    for await (const result of pipeline.stream(request)) {
      const yielded = matchChunk(result);
      if (yielded.some) yield yielded.value;
    }
  };