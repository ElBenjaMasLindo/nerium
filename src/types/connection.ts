import type { Result } from './result.js';
import type { Option } from './option.js';
import type { ChatRequest } from './request.js';
import type { ChatResponse } from './response.js';
import type { ChatChunk } from './stream.js';
import type { NeriumError } from './error.js';
import type { Capabilities, ModelInfo } from './capabilities.js';
import type { ModelId } from './branded.js';
import type { Codec } from './codec.js';
import type { AuthConfig } from './auth.js';

export type Pipeline = {
  chat: (request: ChatRequest) => Promise<Result<ChatResponse, NeriumError>>;
  stream: (request: ChatRequest) => AsyncGenerator<Result<ChatChunk, NeriumError>>;
  capabilitiesForModel: (model: ModelId) => Option<Capabilities>;
  listModels: Option<() => Promise<Result<ReadonlyArray<ModelInfo>, NeriumError>>>;
};

export type Connection = {
  chat: (request: ChatRequest) => Promise<ChatResponse>;
  stream: (request: ChatRequest) => AsyncGenerator<ChatChunk>;
  capabilitiesForModel: (model: ModelId) => Option<Capabilities>;
  listModels: Option<() => Promise<ReadonlyArray<ModelInfo>>>;
};

export type CapabilitiesSource =
  | { type: 'static'; map: ReadonlyMap<ModelId, Capabilities> }
  | { type: 'discover' };

export type CreateConnectionInput = {
  codec: Codec;
  auth: AuthConfig;
  baseURL: string;
  extraHeaders: Readonly<Record<string, string>>;
  capabilities: CapabilitiesSource;
};

export type Client<Aliases extends string> = {
  connection: (alias?: Aliases) => Connection;
};