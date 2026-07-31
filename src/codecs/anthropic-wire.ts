import { match } from 'ts-pattern';
import { some, none } from '../types/option.js';
import type { Option } from '../types/option.js';
import type { ToolCallId } from '../types/branded.js';
import type { Message, SamplingParams, ToolDefinition } from '../types/request.js';
import type { ContentBlock } from '../types/content.js';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const cacheControl = (providerOptions: Option<Record<string, unknown>>): Option<{ type: 'ephemeral' }> => {
  if (!providerOptions.some) return none;
  const cc = providerOptions.value['cache_control'];
  return isRecord(cc) && cc['type'] === 'ephemeral' ? some({ type: 'ephemeral' }) : none;
};

const withCache = (block: Record<string, unknown>, cc: Option<{ type: 'ephemeral' }>): Record<string, unknown> =>
  cc.some ? { ...block, cache_control: cc.value } : block;

type TextBlock = Extract<ContentBlock, { type: 'text' }>;
type MediaBlock = Extract<ContentBlock, { type: 'media' }>;
type ReasoningBlock = Extract<ContentBlock, { type: 'reasoning' }>;
type ToolCallBlock = Extract<ContentBlock, { type: 'tool_call' }>;
type ToolResultBlock = Extract<ContentBlock, { type: 'tool_result' }>;

const toText = (b: TextBlock): Record<string, unknown> => withCache({ type: 'text', text: b.text }, cacheControl(b.providerOptions));
const toMedia = (b: MediaBlock): Record<string, unknown> => withCache({ type: 'image', source: { type: 'base64', media_type: b.mimeType, data: b.data } }, cacheControl(b.providerOptions));
const toReasoning = (b: ReasoningBlock): Record<string, unknown> => withCache({ type: 'thinking', thinking: b.text }, cacheControl(b.providerOptions));
const toToolUse = (b: ToolCallBlock): Record<string, unknown> => withCache({ type: 'tool_use', id: b.id, name: b.name, input: b.arguments }, cacheControl(b.providerOptions));
const toToolResult = (b: ToolResultBlock): Record<string, unknown> => withCache({ type: 'tool_result', tool_use_id: b.toolCallId, content: JSON.stringify(b.result) }, cacheControl(b.providerOptions));

const toOpaque = (b: ContentBlock): Record<string, unknown> => ({ type: 'opaque', subtype: b.type, raw: b });

const toBlock = (block: ContentBlock): Record<string, unknown> =>
  match(block)
    .with({ type: 'text' }, toText)
    .with({ type: 'media' }, toMedia)
    .with({ type: 'reasoning' }, toReasoning)
    .with({ type: 'tool_call' }, toToolUse)
    .with({ type: 'tool_result' }, toToolResult)
    .with({ type: 'opaque' }, toOpaque)
    .exhaustive();

const toBlocks = (blocks: ReadonlyArray<ContentBlock>): ReadonlyArray<Record<string, unknown>> =>
  blocks.map(toBlock);

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

const roleOf = (role: string): 'user' | 'assistant' =>
  role === 'assistant' ? 'assistant' : 'user';

export const buildMessages = (
  messages: ReadonlyArray<Message>,
): ReadonlyArray<{ role: 'user' | 'assistant'; content: ReadonlyArray<Record<string, unknown>> }> =>
  messages.map((m) => ({ role: roleOf(m.role), content: toBlocks(m.content) }));

export const buildTools = (
  tools: ReadonlyArray<ToolDefinition>,
): ReadonlyArray<{ name: string; description: string; input_schema: Record<string, unknown> }> =>
  tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));

const putIfSome = (out: Record<string, unknown>, key: string, value: Option<number>): void => {
  if (value.some) out[key] = value.value;
};

export const buildSampling = (sampling: SamplingParams): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  putIfSome(out, 'temperature', sampling.temperature);
  putIfSome(out, 'top_p', sampling.topP);
  putIfSome(out, 'max_tokens', sampling.maxOutputTokens);
  if (sampling.stopSequences.length > 0) out['stop_sequences'] = [...sampling.stopSequences];
  return out;
};