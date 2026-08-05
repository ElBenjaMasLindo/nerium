import { some } from '../types/option.js';
import type { Option } from '../types/option.js';
import type { Pipeline } from '../types/connection.js';
import type { ChatRequest } from '../types/request.js';
import type { ChatChunk } from '../types/stream.js';
import type { Result } from '../types/result.js';

const matchChunk = (result: Result<ChatChunk, unknown>): Option<ChatChunk> => {
  if (result.ok) return some(result.value);
  throw result.error;
};

export const publicStream = (pipeline: Pipeline) =>
  async function* (request: ChatRequest): AsyncGenerator<ChatChunk> {
    for await (const result of pipeline.stream(request)) {
      const yielded = matchChunk(result);
      if (yielded.some) yield yielded.value;
    }
  };