import { some, none } from '../../types/option.js';
import type { Option } from '../../types/option.js';
import type { Message, SamplingParams, ToolDefinition } from '../../types/request.js';
import type { ContentBlock } from '../../types/content.js';

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
const toReasoning = (b: ReasoningBlock): Record<string, unknown> => {
  const block: Record<string, unknown> = { type: 'thinking', thinking: b.text };
  if (b.signature.some) block['signature'] = b.signature.value;
  return withCache(block, cacheControl(b.providerOptions));
};
const toToolUse = (b: ToolCallBlock): Record<string, unknown> => withCache({ type: 'tool_use', id: b.id, name: b.name, input: b.arguments }, cacheControl(b.providerOptions));
const toToolResult = (b: ToolResultBlock): Record<string, unknown> => withCache({ type: 'tool_result', tool_use_id: b.toolCallId, content: JSON.stringify(b.result) }, cacheControl(b.providerOptions));

const toOpaque = (b: ContentBlock): Record<string, unknown> => ({ type: 'opaque', subtype: b.type, raw: b });

const toStandardBlock = (block: ContentBlock): Option<Record<string, unknown>> => {
  if (block.type === 'text') return some(toText(block));
  if (block.type === 'media') return some(toMedia(block));
  if (block.type === 'reasoning') return some(toReasoning(block));
  return none;
};

const toBlock = (block: ContentBlock): Record<string, unknown> => {
  const std = toStandardBlock(block);
  if (std.some) return std.value;
  if (block.type === 'tool_call') return toToolUse(block);
  if (block.type === 'tool_result') return toToolResult(block);
  if (block.type === 'opaque') return toOpaque(block);
  return {};
};

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

export const splitSystemBlocks = (
  messages: ReadonlyArray<Message>,
): { system: Option<ReadonlyArray<Record<string, unknown>>>; conversation: ReadonlyArray<Message> } => {
  const systemBlocks: Array<Record<string, unknown>> = [];
  const conversation: Message[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      systemBlocks.push(...toBlocks(message.content));
    } else {
      conversation.push(message);
    }
  }
  const system = systemBlocks.length === 0 ? none : some(systemBlocks);
  return { system, conversation };
};

const roleOf = (role: string): 'user' | 'assistant' =>
  role === 'assistant' ? 'assistant' : 'user';

export const buildMessages = (
  messages: ReadonlyArray<Message>,
): ReadonlyArray<{ role: 'user' | 'assistant'; content: ReadonlyArray<Record<string, unknown>> }> => {
  const result: Array<{ role: 'user' | 'assistant'; content: Array<Record<string, unknown>> }> = [];
  for (const m of messages) {
    const role = roleOf(m.role);
    const blocks = [...toBlocks(m.content)];
    const last = result[result.length - 1];
    if (last && last.role === role) {
      last.content.push(...blocks);
    } else {
      result.push({ role, content: blocks });
    }
  }
  return result;
};

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
