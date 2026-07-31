import { ok } from '../types/result.js';
import type { Result } from '../types/result.js';
import { some, none } from '../types/option.js';
import type { Codec, ConnectionRuntimeConfig } from '../types/codec.js';
import type { ChatRequest } from '../types/request.js';
import type { NeriumError } from '../types/error.js';
import type { HttpRequest } from '../types/http-wire.js';
import { splitSystem, buildContents, buildSystemInstruction, buildTools, buildGenerationConfig } from './gemini-wire.js';
import { parseResponse, parseChunk, parseError } from './gemini-parse.js';

const joinUrl = (base: string, path: string): string =>
  base.endsWith('/') ? `${base}${path.slice(1)}` : `${base}${path}`;

const endpointPath = (model: string, stream: boolean): string =>
  stream ? `/v1beta/models/${model}:streamGenerateContent` : `/v1beta/models/${model}:generateContent`;

const buildPayload = (request: ChatRequest): Record<string, unknown> => {
  const { system, conversation } = splitSystem(request.messages);
  const payload: Record<string, unknown> = { contents: buildContents(conversation) };
  const sys = buildSystemInstruction(system);
  if (sys.some) payload['systemInstruction'] = sys.value;
  const tools = buildTools(request.tools);
  if (tools.length > 0) payload['tools'] = tools;
  payload['generationConfig'] = buildGenerationConfig(request.sampling);
  const opts = request.providerOptions;
  if (opts.some) Object.assign(payload, opts.value);
  return payload;
};

const buildRequest = (request: ChatRequest, config: ConnectionRuntimeConfig): Result<HttpRequest, NeriumError> => {
  const url = `${joinUrl(config.baseURL, endpointPath(request.model, config.stream))}${config.stream ? '?alt=sse' : ''}`;
  return ok({
    method: 'POST',
    url,
    headers: { ...config.extraHeaders, 'content-type': 'application/json' },
    body: some(JSON.stringify(buildPayload(request))),
  });
};

export const geminiCodec: Codec = {
  provider: 'gemini',
  buildRequest,
  parseResponse,
  parseChunk,
  parseError,
  listModels: none,
};