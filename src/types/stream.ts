import type { TokenUsage, FinishReason } from './response.js';
import type { ContentBlockStart, ContentBlockDelta } from './content.js';

export type ChatChunk =
  | { type: 'start'; index: number; block: ContentBlockStart }
  | { type: 'delta'; index: number; delta: ContentBlockDelta }
  | { type: 'end'; usage: TokenUsage; finishReason: FinishReason };