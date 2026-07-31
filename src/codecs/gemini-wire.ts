import { match } from 'ts-pattern';
import { some, none } from '../types/option.js';
import type { Option } from '../types/option.js';
import type { Message, SamplingParams, ToolDefinition } from '../types/request.js';
import type { ContentBlock } from '../types/content.js';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

type TextBlock = Extract<ContentBlock, { type: 'text' }>;
type MediaBlock = Extract<ContentBlock, { type: 'media' }>;
type ReasoningBlock = Extract<ContentBlock, { type: 'reasoning' }>;
type ToolCallBlock = Extract<ContentBlock, { type: 'tool_call' }>;
type ToolResultBlock = Extract<ContentBlock, { type: 'tool_result' }>;

const toTextPart = (b: TextBlock): Record<string, unknown> => ({ text: b.text });
const toMediaPart = (b: MediaBlock): Record<string, unknown> => ({ inlineData: { mimeType: b.mimeType, data: b.data } });
const toReasoningPart = (b: ReasoningBlock): Record<string, unknown> => ({ thought: true, text: b.text });
const toToolCallPart = (b: ToolCallBlock): Record<string, unknown> => ({ functionCall: { name: b.name, args: b.arguments } });
// Gemini has no call id; Nerium mints the ToolCallId from the function name (see gemini-parse),
// so the id string here is exactly the name Gemini expects back.
const toToolResultPart = (b: ToolResultBlock): Record<string, unknown> => ({ functionResponse: { name: b.toolCallId, response: b.result } });
const toOpaquePart = (b: Extract<ContentBlock, { type: 'opaque' }>): Record<string, unknown> => ({ [b.subtype]: b.raw });

const toPart = (block: ContentBlock): Record<string, unknown> =>
  match(block)
    .with({ type: 'text' }, toTextPart)
    .with({ type: 'media' }, toMediaPart)
    .with({ type: 'reasoning' }, toReasoningPart)
    .with({ type: 'tool_call' }, toToolCallPart)
    .with({ type: 'tool_result' }, toToolResultPart)
    .with({ type: 'opaque' }, toOpaquePart)
    .exhaustive();

const toParts = (blocks: ReadonlyArray<ContentBlock>): ReadonlyArray<Record<string, unknown>> =>
  blocks.map(toPart);

const roleOf = (role: string): 'user' | 'model' =>
  role === 'assistant' ? 'model' : 'user';

const isTextBlock = (b: ContentBlock): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text';

export const splitSystem = (
  messages: ReadonlyArray<Message>,
): { system: Option<string>; conversation: ReadonlyArray<Message> } => {
  const systemTexts: string[] = [];
  const conversation: Message[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      const text = message.content.filter(isTextBlock).map((b) => b.text).join('');
      if (text !== '') systemTexts.push(text);
    } else {
      conversation.push(message);
    }
  }
  const system = systemTexts.length === 0 ? none : some(systemTexts.join('\n\n'));
  return { system, conversation };
};

export const buildContents = (
  messages: ReadonlyArray<Message>,
): ReadonlyArray<{ role: 'user' | 'model'; parts: ReadonlyArray<Record<string, unknown>> }> =>
  messages.map((m) => ({ role: roleOf(m.role), parts: toParts(m.content) }));

export const buildSystemInstruction = (system: Option<string>): Option<{ parts: ReadonlyArray<{ text: string }> }> =>
  system.some ? some({ parts: [{ text: system.value }] }) : none;

export const buildTools = (
  tools: ReadonlyArray<ToolDefinition>,
): ReadonlyArray<{ functionDeclarations: ReadonlyArray<ToolDefinition> }> =>
  tools.length === 0 ? [] : [{ functionDeclarations: tools }];

const putIfSome = (out: Record<string, unknown>, key: string, value: Option<number>): void => {
  if (value.some) out[key] = value.value;
};

export const buildGenerationConfig = (sampling: SamplingParams): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  putIfSome(out, 'temperature', sampling.temperature);
  putIfSome(out, 'topP', sampling.topP);
  putIfSome(out, 'maxOutputTokens', sampling.maxOutputTokens);
  if (sampling.stopSequences.length > 0) out['stopSequences'] = [...sampling.stopSequences];
  return out;
};