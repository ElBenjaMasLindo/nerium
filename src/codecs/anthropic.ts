import { ok } from '../types/result.js';
import type { Result } from '../types/result.js';
import { some, none } from '../types/option.js';
import type { Codec, ConnectionRuntimeConfig } from '../types/codec.js';
import type { ChatRequest } from '../types/request.js';
import type { NeriumError } from '../types/error.js';
import type { HttpRequest } from '../types/http-wire.js';
import { splitSystem, buildMessages, buildTools, buildSampling } from './anthropic-wire.js';
import { parseResponse, parseChunk, parseError } from './anthropic-parse.js';

const joinUrl = (base: string, path: string): string =>
  base.endsWith('/') ? `${base}${path.slice(1)}` : `${base}${path}`;

const buildPayload = (request: ChatRequest, config: ConnectionRuntimeConfig): Record<string, unknown> => {
  const { system, conversation } = splitSystem(request.messages);
  const payload: Record<string, unknown> = {
    model: request.model,
    messages: buildMessages(conversation),
    stream: config.stream,
    max_tokens: request.sampling.maxOutputTokens.some ? request.sampling.maxOutputTokens.value : 4096,
  };
  if (system.some) payload['system'] = system.value;
  if (request.tools.length > 0) payload['tools'] = buildTools(request.tools);
  Object.assign(payload, buildSampling(request.sampling));
  const opts = request.providerOptions;
  if (opts.some) Object.assign(payload, opts.value);
  return payload;
};

const buildRequest = (request: ChatRequest, config: ConnectionRuntimeConfig): Result<HttpRequest, NeriumError> =>
  ok({
    method: 'POST',
    url: joinUrl(config.baseURL, '/v1/messages'),
    headers: { ...config.extraHeaders, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: some(JSON.stringify(buildPayload(request, config))),
  });

export const anthropicCodec: Codec = {
  provider: 'anthropic',
  buildRequest,
  parseResponse,
  parseChunk,
  parseError,
  listModels: none,
};