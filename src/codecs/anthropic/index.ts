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
import { splitSystemBlocks, buildMessages, buildTools, buildSampling } from './wire.js';
import { parseResponse, parseChunk, parseError } from './parse.js';

const joinUrl = (base: string, path: string): string =>
  base.endsWith('/') ? `${base}${path.slice(1)}` : `${base}${path}`;

const buildPayload = (request: ChatRequest, config: ConnectionRuntimeConfig): Record<string, unknown> => {
  const { system, conversation } = splitSystemBlocks(request.messages);
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

const extractAnthropicModels = (data: ReadonlyArray<unknown>): ReadonlyArray<ModelInfo> => {
  const models: ModelInfo[] = [];
  for (const item of data) {
    if (isRecord(item) && isString(item['id'])) {
      models.push({
        id: toModelId(item['id']),
        capabilities: { streaming: true, tools: true, media: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], reasoning: true, structuredOutput: false, contextWindow: 200000, promptCaching: true },
      });
    }
  }
  return models;
};

const is2xx = (status: number): boolean => status >= 200 && status < 300;

const fetchAnthropicModelsData = async (config: ConnectionRuntimeConfig): Promise<Result<ReadonlyArray<unknown>, NeriumError>> => {
  const req: HttpRequest = { method: 'GET', url: joinUrl(config.baseURL, '/v1/models'), headers: { ...config.extraHeaders, 'anthropic-version': '2023-06-01' }, body: none };
  const sent = await send(req, none);
  if (!sent.ok) return err(sent.error);
  if (!is2xx(sent.value.status)) return err(parseError(sent.value));
  const parsed = safeJsonParse(sent.value.body);
  if (!parsed.ok || !isRecord(parsed.value)) return err({ category: 'unknown', code: 'parse', provider: 'anthropic', status: some(sent.value.status), message: 'invalid json', raw: some(sent.value.body) });
  const data = parsed.value['data'];
  if (!Array.isArray(data)) return err({ category: 'unknown', code: 'parse', provider: 'anthropic', status: some(sent.value.status), message: 'missing data array', raw: some(sent.value.body) });
  return ok(data);
};

const listModels = async (config: ConnectionRuntimeConfig): Promise<Result<ReadonlyArray<ModelInfo>, NeriumError>> => {
  const fetched = await fetchAnthropicModelsData(config);
  if (!fetched.ok) return err(fetched.error);
  return ok(extractAnthropicModels(fetched.value));
};

export const anthropicCodec: Codec = {
  provider: 'anthropic',
  buildRequest,
  parseResponse,
  parseChunk,
  parseError,
  listModels: some(listModels),
};
