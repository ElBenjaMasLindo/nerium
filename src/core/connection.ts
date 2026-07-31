import { match } from 'ts-pattern';
import { ok, err } from '../types/result.js';
import type { Result } from '../types/result.js';
import { none, some } from '../types/option.js';
import type { Option } from '../types/option.js';
import type { Codec, ConnectionRuntimeConfig } from '../types/codec.js';
import type { AuthConfig, Credential } from '../types/auth.js';
import type { Capabilities, ModelInfo } from '../types/capabilities.js';
import type { ModelId } from '../types/branded.js';
import type { ChatRequest } from '../types/request.js';
import type { ChatResponse } from '../types/response.js';
import type { ChatChunk } from '../types/stream.js';
import type { ErrorCategory, NeriumError } from '../types/error.js';
import type { HttpRequest, RawHttpResponse } from '../types/http-wire.js';
import type { Pipeline, CreateConnectionInput } from '../types/connection.js';
import { send, openStream, type StreamedResponse } from '../adapters/http.js';
import { parseSse } from './transport/sse.js';

type ConnCtx = {
  codec: Codec;
  auth: AuthConfig;
  caps: ReadonlyMap<ModelId, Capabilities>;
  baseURL: string;
  extraHeaders: Readonly<Record<string, string>>;
  provider: string;
};

type LocalInfo = { code: string; message: string };

const localError = (ctx: ConnCtx, category: ErrorCategory, info: LocalInfo): NeriumError => ({
  category, code: info.code, provider: ctx.provider, status: none, message: info.message, raw: null,
});

const signalAborted = (request: ChatRequest): boolean => request.signal.some && request.signal.value.aborted;

const needsStructured = (request: ChatRequest, caps: Capabilities): boolean =>
  request.responseFormat.some && !caps.structuredOutput;

const needsTools = (request: ChatRequest, caps: Capabilities): boolean =>
  request.tools.length > 0 && !caps.tools;

const hasUnsupportedMedia = (request: ChatRequest, caps: Capabilities): boolean => {
  for (const message of request.messages) {
    for (const block of message.content) {
      if (block.type === 'media' && !caps.media.includes(block.mimeType)) return true;
    }
  }
  return false;
};

const validateCapabilities = (ctx: ConnCtx, request: ChatRequest, caps: Capabilities): Result<true, NeriumError> => {
  if (needsStructured(request, caps)) return err(localError(ctx, 'invalid', { code: 'capability', message: 'structuredOutput not supported by model' }));
  if (needsTools(request, caps)) return err(localError(ctx, 'invalid', { code: 'capability', message: 'tools not supported by model' }));
  if (hasUnsupportedMedia(request, caps)) return err(localError(ctx, 'invalid', { code: 'capability', message: 'media mimeType not supported by model' }));
  return ok(true);
};

const validateLocally = (ctx: ConnCtx, request: ChatRequest): Result<true, NeriumError> => {
  if (signalAborted(request)) return err(localError(ctx, 'client', { code: 'aborted', message: 'request aborted before send' }));
  const caps = ctx.caps.get(request.model);
  if (caps === undefined) return err(localError(ctx, 'invalid', { code: 'unknown_model', message: 'model has no resolved capabilities' }));
  return validateCapabilities(ctx, request, caps);
};

const withProvider = (ctx: ConnCtx, error: NeriumError): NeriumError =>
  error.provider === '' ? { ...error, provider: ctx.provider } : error;

const isOkStatus = (status: number): boolean => status >= 200 && status < 300;

const config = (ctx: ConnCtx, stream: boolean): ConnectionRuntimeConfig => ({
  baseURL: ctx.baseURL, extraHeaders: ctx.extraHeaders, stream,
});

const authError = (ctx: ConnCtx): NeriumError => localError(ctx, 'invalid', { code: 'auth', message: 'credential resolution failed' });

const resolveCredential = async (ctx: ConnCtx, credential: Credential): Promise<Result<string, NeriumError>> => {
  if (credential.type === 'value') return ok(credential.value);
  try { return ok(await credential.resolve()); } catch { return err(authError(ctx)); }
};

type StaticAuth = Extract<AuthConfig, { type: 'static' }>;
type SignedAuth = Extract<AuthConfig, { type: 'signed' }>;

const withHeader = (request: HttpRequest, key: string, value: string): HttpRequest => ({
  ...request, headers: { ...request.headers, [key]: value },
});

const withQuery = (request: HttpRequest, key: string, value: string): HttpRequest => {
  const sep = request.url.includes('?') ? '&' : '?';
  return { ...request, url: `${request.url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}` };
};

const attachCredential = (request: HttpRequest, auth: StaticAuth, value: string): HttpRequest =>
  auth.location === 'header' ? withHeader(request, auth.key, value) : withQuery(request, auth.key, value);

const resolveStatic = async (ctx: ConnCtx, auth: StaticAuth, request: HttpRequest): Promise<Result<HttpRequest, NeriumError>> => {
  const cred = await resolveCredential(ctx, auth.credential);
  if (!cred.ok) return err(cred.error);
  return ok(attachCredential(request, auth, cred.value));
};

const resolveSigned = async (ctx: ConnCtx, auth: SignedAuth, request: HttpRequest): Promise<Result<HttpRequest, NeriumError>> => {
  try { return ok(await auth.sign(request)); } catch { return err(authError(ctx)); }
};

const resolveAuth = async (ctx: ConnCtx, request: HttpRequest): Promise<Result<HttpRequest, NeriumError>> => {
  if (ctx.auth.type === 'none') return ok(request);
  if (ctx.auth.type === 'static') return resolveStatic(ctx, ctx.auth, request);
  return resolveSigned(ctx, ctx.auth, request);
};

const finalizeChat = async (ctx: ConnCtx, request: ChatRequest, authed: HttpRequest): Promise<Result<ChatResponse, NeriumError>> => {
  const sent = await send(authed, request.signal);
  if (!sent.ok) return err(withProvider(ctx, sent.error));
  if (!isOkStatus(sent.value.status)) return err(ctx.codec.parseError(sent.value));
  return ctx.codec.parseResponse(sent.value);
};

const runChat = async (ctx: ConnCtx, request: ChatRequest): Promise<Result<ChatResponse, NeriumError>> => {
  const local = validateLocally(ctx, request);
  if (!local.ok) return err(local.error);
  const built = ctx.codec.buildRequest(request, config(ctx, false));
  if (!built.ok) return err(built.error);
  const authed = await resolveAuth(ctx, built.value);
  if (!authed.ok) return err(authed.error);
  return finalizeChat(ctx, request, authed.value);
};

const drainToRaw = async (resp: StreamedResponse): Promise<Result<RawHttpResponse, NeriumError>> => {
  try {
    let body = '';
    for await (const chunk of resp.body) body += chunk;
    return ok({ status: resp.status, headers: resp.headers, body });
  } catch (e) {
    return err(e as NeriumError);
  }
};

const errorFromStream = async (ctx: ConnCtx, resp: StreamedResponse): Promise<NeriumError> => {
  const drained = await drainToRaw(resp);
  return drained.ok ? ctx.codec.parseError(drained.value) : drained.error;
};

async function* streamChunks(ctx: ConnCtx, body: AsyncIterable<string>): AsyncGenerator<Result<ChatChunk, NeriumError>> {
  try {
    for await (const event of parseSse(body)) {
      const result = ctx.codec.parseChunk(event);
      if (!result.ok) { yield err(result.error); return; }
      if (result.value.some) yield ok(result.value.value);
    }
  } catch (e) {
    yield err(e as NeriumError);
  }
}

const openStreamRequest = async (ctx: ConnCtx, request: ChatRequest): Promise<Result<StreamedResponse, NeriumError>> => {
  const local = validateLocally(ctx, request);
  if (!local.ok) return err(local.error);
  const built = ctx.codec.buildRequest(request, config(ctx, true));
  if (!built.ok) return err(built.error);
  const authed = await resolveAuth(ctx, built.value);
  if (!authed.ok) return err(authed.error);
  const opened = await openStream(authed.value, request.signal);
  if (!opened.ok) return err(withProvider(ctx, opened.error));
  return ok(opened.value);
};

async function* runStream(ctx: ConnCtx, request: ChatRequest): AsyncGenerator<Result<ChatChunk, NeriumError>> {
  const opened = await openStreamRequest(ctx, request);
  if (!opened.ok) { yield err(opened.error); return; }
  if (!isOkStatus(opened.value.status)) { yield err(await errorFromStream(ctx, opened.value)); return; }
  yield* streamChunks(ctx, opened.value.body);
}

const capabilityForModel = (ctx: ConnCtx, model: ModelId): Option<Capabilities> => {
  const found = ctx.caps.get(model);
  return found === undefined ? none : some(found);
};

const listModelsOption = (ctx: ConnCtx): Option<() => Promise<Result<ReadonlyArray<ModelInfo>, NeriumError>>> =>
  match(ctx.codec.listModels)
    .with({ some: true }, (l) => some(() => l.value(config(ctx, false))))
    .with({ some: false }, () => none)
    .exhaustive();

const toCapabilitiesMap = (models: ReadonlyArray<ModelInfo>): ReadonlyMap<ModelId, Capabilities> => {
  const map = new Map<ModelId, Capabilities>();
  for (const model of models) map.set(model.id, model.capabilities);
  return map;
};

const missingListError = (codec: Codec): NeriumError => ({
  category: 'invalid', code: 'no_list_models', provider: codec.provider, status: none, message: 'discover requested but codec has no listModels', raw: null,
});

const resolveDiscovered = async (ctx: ConnCtx): Promise<Result<ReadonlyMap<ModelId, Capabilities>, NeriumError>> => {
  const list = ctx.codec.listModels;
  if (!list.some) return err(missingListError(ctx.codec));
  const result = await list.value(config(ctx, false));
  if (!result.ok) return err(result.error);
  return ok(toCapabilitiesMap(result.value));
};

const resolveCapabilities = async (ctx: ConnCtx, source: CreateConnectionInput['capabilities']): Promise<Result<ReadonlyMap<ModelId, Capabilities>, NeriumError>> =>
  source.type === 'static' ? ok(source.map) : resolveDiscovered(ctx);

const buildPipeline = (input: CreateConnectionInput, caps: ReadonlyMap<ModelId, Capabilities>): Pipeline => {
  const ctx: ConnCtx = { codec: input.codec, auth: input.auth, caps, baseURL: input.baseURL, extraHeaders: input.extraHeaders, provider: input.codec.provider };
  return {
    chat: (request) => runChat(ctx, request),
    stream: (request) => runStream(ctx, request),
    capabilitiesForModel: (model) => capabilityForModel(ctx, model),
    listModels: listModelsOption(ctx),
  };
};

export const createConnection = async (input: CreateConnectionInput): Promise<Result<Pipeline, NeriumError>> => {
  const ctx: ConnCtx = { codec: input.codec, auth: input.auth, caps: new Map(), baseURL: input.baseURL, extraHeaders: input.extraHeaders, provider: input.codec.provider };
  const caps = await resolveCapabilities(ctx, input.capabilities);
  if (!caps.ok) return err(caps.error);
  return ok(buildPipeline(input, caps.value));
};