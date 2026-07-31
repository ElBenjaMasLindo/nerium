import type { Option } from './option.js';
import type { ModelId } from './branded.js';
import type { ContentBlock } from './content.js';

export type Role = 'system' | 'user' | 'assistant' | 'tool';
export type Message = { role: Role; content: ReadonlyArray<ContentBlock> };

export type ResponseFormat = { schema: Record<string, unknown> };

export type SamplingParams = {
  temperature: Option<number>;
  topP: Option<number>;
  maxOutputTokens: Option<number>;
  stopSequences: ReadonlyArray<string>;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ChatRequest = {
  model: ModelId;
  messages: ReadonlyArray<Message>;
  tools: ReadonlyArray<ToolDefinition>;
  responseFormat: Option<ResponseFormat>;
  sampling: SamplingParams;
  signal: Option<AbortSignal>;
  providerOptions: Option<Record<string, unknown>>;
};