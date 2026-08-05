import type { Result } from './result.js';
import type { Option } from './option.js';
import type { ChatRequest } from './request.js';
import type { ChatResponse } from './response.js';
import type { ChatChunk } from './stream.js';
import type { NeriumError } from './error.js';
import type { ModelInfo } from './capabilities.js';
import type { HttpRequest, RawHttpResponse, RawStreamEvent } from './http-wire.js';

export type ConnectionRuntimeConfig = {
  baseURL: string;
  extraHeaders: Readonly<Record<string, string>>;
  stream: boolean;
};

export type Codec = {
  provider: string;
  buildRequest: (request: ChatRequest, config: ConnectionRuntimeConfig) => Result<HttpRequest, NeriumError>;
  parseResponse: (raw: RawHttpResponse) => Result<ChatResponse, NeriumError>;
  parseChunk: (event: RawStreamEvent) => Result<Option<ChatChunk | ReadonlyArray<ChatChunk>>, NeriumError>;
  parseError: (raw: RawHttpResponse) => NeriumError;
  listModels: Option<(config: ConnectionRuntimeConfig) => Promise<Result<ReadonlyArray<ModelInfo>, NeriumError>>>;
};