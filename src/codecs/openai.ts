import { ok, err } from '../types/result.js';
import type { Result } from '../types/result.js';
import { some, none } from '../types/option.js';
import type { Codec, ConnectionRuntimeConfig } from '../types/codec.js';
import type { ChatRequest } from '../types/request.js';
import type { NeriumError } from '../types/error.js';
import type { HttpRequest } from '../types/http-wire.js';
import { buildMessages, buildTools, buildSampling } from './openai-wire.js';
import { parseResponse, parseChunk, parseError } from './openai-parse.js';

const joinUrl = (base: string, path: string): string =>
  base.endsWith('/') ? `${base}${path.slice(1)}` : `${base}${path}`;

const buildPayload = (request: ChatRequest, config: ConnectionRuntimeConfig): Record<string, unknown> => {
  const payload: Record<string, unknown> = { model: request.model, messages: buildMessages(request.messages), stream: config.stream };
  if (request.tools.length > 0) payload['tools'] = buildTools(request.tools);
  const format = request.responseFormat;
  if (format.some) payload['response_format'] = { type: 'json_schema', json_schema: { schema: format.value.schema } };
  Object.assign(payload, buildSampling(request.sampling));
  const opts = request.providerOptions;
  if (opts.some) Object.assign(payload, opts.value);
  return payload;
};

const buildRequest = (request: ChatRequest, config: ConnectionRuntimeConfig): Result<HttpRequest, NeriumError> =>
  ok({
    method: 'POST',
    url: joinUrl(config.baseURL, '/chat/completions'),
    headers: { ...config.extraHeaders, 'content-type': 'application/json' },
    body: some(JSON.stringify(buildPayload(request, config))),
  });

export const openaiCodec: Codec = {
  provider: 'openai',
  buildRequest,
  parseResponse,
  parseChunk,
  parseError,
  listModels: none,
};