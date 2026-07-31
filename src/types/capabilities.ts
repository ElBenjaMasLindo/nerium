import type { ModelId } from './branded.js';

export type Capabilities = {
  streaming: boolean;
  tools: boolean;
  media: ReadonlyArray<string>;
  reasoning: boolean;
  structuredOutput: boolean;
  contextWindow: number;
  promptCaching: boolean;
};

export type ModelInfo = { id: ModelId; capabilities: Capabilities };