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
import { splitSystem, buildContents, buildSystemInstruction, buildTools, buildGenerationConfig } from './wire.js';
import { parseResponse, parseChunk, parseError } from './parse.js';

const joinUrl = (base: string, path: string): string =>
  base.endsWith('/') ? `${base}${path.slice(1)}` : `${base}${path}`;

const endpointPath = (model: string, stream: boolean): string =>
  stream ? `/v1beta/models/${model}:streamGenerateContent` : `/v1beta/models/${model}:generateContent`;

const appendQuery = (url: string, query: string): string => {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${query}`;
};

const buildPayload = (request: ChatRequest): Record<string, unknown> => {
  const { system, conversation } = splitSystem(request.messages);
  const payload: Record<string, unknown> = { contents: buildContents(conversation) };
  const sys = buildSystemInstruction(system);
  if (sys.some) payload['systemInstruction'] = sys.value;
  const tools = buildTools(request.tools);
  if (tools.length > 0) payload['tools'] = tools;
  payload['generationConfig'] = buildGenerationConfig(request.sampling, request.responseFormat);
  const opts = request.providerOptions;
  if (opts.some) Object.assign(payload, opts.value);
  return payload;
};

const buildRequest = (request: ChatRequest, config: ConnectionRuntimeConfig): Result<HttpRequest, NeriumError> => {
  const baseUrl = joinUrl(config.baseURL, endpointPath(request.model, config.stream));
  const url = config.stream ? appendQuery(baseUrl, 'alt=sse') : baseUrl;
  return ok({
    method: 'POST',
    url,
    headers: { ...config.extraHeaders, 'content-type': 'application/json' },
    body: some(JSON.stringify(buildPayload(request))),
  });
};

const extractGeminiModels = (modelsData: ReadonlyArray<unknown>): ReadonlyArray<ModelInfo> => {
  const models: ModelInfo[] = [];
  for (const item of modelsData) {
    if (isRecord(item) && isString(item['name'])) {
      const rawId = item['name'].startsWith('models/') ? item['name'].slice('models/'.length) : item['name'];
      models.push({
        id: toModelId(rawId),
        capabilities: { streaming: true, tools: true, media: ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'], reasoning: true, structuredOutput: true, contextWindow: 1000000, promptCaching: false },
      });
    }
  }
  return models;
};

const is2xx = (status: number): boolean => status >= 200 && status < 300;

const fetchGeminiModelsData = async (config: ConnectionRuntimeConfig): Promise<Result<ReadonlyArray<unknown>, NeriumError>> => {
  const req: HttpRequest = { method: 'GET', url: joinUrl(config.baseURL, '/v1beta/models'), headers: config.extraHeaders, body: none };
  const sent = await send(req, none);
  if (!sent.ok) return err(sent.error);
  if (!is2xx(sent.value.status)) return err(parseError(sent.value));
  const parsed = safeJsonParse(sent.value.body);
  if (!parsed.ok || !isRecord(parsed.value)) return err({ category: 'unknown', code: 'parse', provider: 'gemini', status: some(sent.value.status), message: 'invalid json', raw: some(sent.value.body) });
  const modelsData = parsed.value['models'];
  if (!Array.isArray(modelsData)) return err({ category: 'unknown', code: 'parse', provider: 'gemini', status: some(sent.value.status), message: 'missing models array', raw: some(sent.value.body) });
  return ok(modelsData);
};

const listModels = async (config: ConnectionRuntimeConfig): Promise<Result<ReadonlyArray<ModelInfo>, NeriumError>> => {
  const fetched = await fetchGeminiModelsData(config);
  if (!fetched.ok) return err(fetched.error);
  return ok(extractGeminiModels(fetched.value));
};

export const geminiCodec: Codec = {
  provider: 'gemini',
  buildRequest,
  parseResponse,
  parseChunk,
  parseError,
  listModels: some(listModels),
};
