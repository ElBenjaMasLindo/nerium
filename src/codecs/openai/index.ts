import { err, ok } from '../../types/result.js';
import type { Result } from '../../types/result.js';
import { some, none } from '../../types/option.js';
import type { Codec, ConnectionRuntimeConfig } from '../../types/codec.js';
import type { ChatRequest } from '../../types/request.js';
import type { NeriumError } from '../../types/error.js';
import type { HttpRequest } from '../../types/http-wire.js';
import type { ModelInfo } from '../../types/capabilities.js';
import { toModelId } from '../../types/branded.js';
import { send } from '../../adapters/http.js';
import { safeJsonParse } from '../../core/safe-json.js';
import { isRecord, isString } from '../../core/json-guards.js';
import { buildMessages, buildTools, buildSampling } from './wire.js';
import { parseResponse, parseChunk, parseError } from './parse.js';

const joinUrl = (base: string, path: string): string =>
  base.endsWith('/') ? `${base}${path.slice(1)}` : `${base}${path}`;

const buildPayload = (request: ChatRequest, config: ConnectionRuntimeConfig): Record<string, unknown> => {
  const payload: Record<string, unknown> = { model: request.model, messages: buildMessages(request.messages), stream: config.stream };
  if (request.tools.length > 0) payload['tools'] = buildTools(request.tools);
  const format = request.responseFormat;
  if (format.some) {
    payload['response_format'] = {
      type: 'json_schema',
      json_schema: { name: 'response', schema: format.value.schema, strict: true },
    };
  }
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

const extractOpenAiModels = (data: ReadonlyArray<unknown>): ReadonlyArray<ModelInfo> => {
  const models: ModelInfo[] = [];
  for (const item of data) {
    if (isRecord(item) && isString(item['id'])) {
      models.push({
        id: toModelId(item['id']),
        capabilities: { streaming: true, tools: true, media: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], reasoning: true, structuredOutput: true, contextWindow: 128000, promptCaching: true },
      });
    }
  }
  return models;
};

const is2xx = (status: number): boolean => status >= 200 && status < 300;

const fetchOpenAiModelsData = async (config: ConnectionRuntimeConfig): Promise<Result<ReadonlyArray<unknown>, NeriumError>> => {
  const req: HttpRequest = { method: 'GET', url: joinUrl(config.baseURL, '/models'), headers: config.extraHeaders, body: none };
  const sent = await send(req, none);
  if (!sent.ok) return err(sent.error);
  if (!is2xx(sent.value.status)) return err(parseError(sent.value));
  const parsed = safeJsonParse(sent.value.body);
  if (!parsed.ok || !isRecord(parsed.value)) return err({ category: 'unknown', code: 'parse', provider: 'openai', status: some(sent.value.status), message: 'invalid json', raw: some(sent.value.body) });
  const data = parsed.value['data'];
  if (!Array.isArray(data)) return err({ category: 'unknown', code: 'parse', provider: 'openai', status: some(sent.value.status), message: 'missing data array', raw: some(sent.value.body) });
  return ok(data);
};

const listModels = async (config: ConnectionRuntimeConfig): Promise<Result<ReadonlyArray<ModelInfo>, NeriumError>> => {
  const fetched = await fetchOpenAiModelsData(config);
  if (!fetched.ok) return err(fetched.error);
  return ok(extractOpenAiModels(fetched.value));
};

export const openaiCodec: Codec = {
  provider: 'openai',
  buildRequest,
  parseResponse,
  parseChunk,
  parseError,
  listModels: some(listModels),
};
