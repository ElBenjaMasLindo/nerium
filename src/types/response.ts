import type { Option } from './option.js';
import type { ModelId } from './branded.js';
import type { ContentBlock } from './content.js';

export type FinishReason =
  | 'complete' | 'max_tokens' | 'tool_call' | 'stop_sequence'
  | 'filtered' | 'error' | 'unknown';

export type TokenUsage = {
  input: number;
  output: number;
  total: number;
  cacheWrite: Option<number>;
  cacheRead: Option<number>;
};

export type ChatResponse = {
  content: ReadonlyArray<ContentBlock>;
  finishReason: FinishReason;
  usage: TokenUsage;
  provider: string;
  model: ModelId;
};