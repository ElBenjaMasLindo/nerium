import type { Option } from '../types/option.js';
import { some, none } from '../types/option.js';
import type { ToolCallId } from '../types/branded.js';
import type { Message, SamplingParams, ToolDefinition } from '../types/request.js';
import type { ContentBlock } from '../types/content.js';

type OpenAiPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type OpenAiToolCall = { id: ToolCallId; type: 'function'; function: { name: string; arguments: string } };

export type OpenAiMessage = {
  role: string;
  content: string | ReadonlyArray<OpenAiPart>;
  tool_calls?: ReadonlyArray<OpenAiToolCall>;
  tool_call_id?: ToolCallId;
};

const isTextBlock = (b: ContentBlock): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text';

const textOf = (blocks: ReadonlyArray<ContentBlock>): string =>
  blocks.filter(isTextBlock).map((b) => b.text).join('');

const isTextOnly = (blocks: ReadonlyArray<ContentBlock>): boolean => blocks.every(isTextBlock);

const toPart = (block: ContentBlock): Option<OpenAiPart> => {
  if (block.type === 'text') return some({ type: 'text', text: block.text });
  if (block.type === 'media') return some({ type: 'image_url', image_url: { url: `data:${block.mimeType};base64,${block.data}` } });
  return none;
};

const toParts = (blocks: ReadonlyArray<ContentBlock>): ReadonlyArray<OpenAiPart> => {
  const parts: OpenAiPart[] = [];
  for (const block of blocks) {
    const part = toPart(block);
    if (part.some) parts.push(part.value);
  }
  return parts;
};

const toToolCalls = (blocks: ReadonlyArray<ContentBlock>): ReadonlyArray<OpenAiToolCall> =>
  blocks
    .filter((b): b is Extract<ContentBlock, { type: 'tool_call' }> => b.type === 'tool_call')
    .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.arguments) } }));

const toolResultMessage = (content: ReadonlyArray<ContentBlock>): OpenAiMessage => {
  const result = content.find((b): b is Extract<ContentBlock, { type: 'tool_result' }> => b.type === 'tool_result');
  if (!result) return { role: 'tool', content: '' };
  return { role: 'tool', tool_call_id: result.toolCallId, content: JSON.stringify(result.result) };
};

const userMessage = (role: string, content: ReadonlyArray<ContentBlock>): OpenAiMessage => ({
  role,
  content: isTextOnly(content) ? textOf(content) : toParts(content),
});

const assistantMessage = (role: string, content: ReadonlyArray<ContentBlock>): OpenAiMessage => {
  const base: OpenAiMessage = { role, content: textOf(content) };
  const toolCalls = toToolCalls(content);
  return toolCalls.length > 0 ? { ...base, tool_calls: toolCalls } : base;
};

const roleMessage = (message: Message): OpenAiMessage => {
  if (message.role === 'tool') return toolResultMessage(message.content);
  if (message.role === 'user') return userMessage(message.role, message.content);
  if (message.role === 'assistant') return assistantMessage(message.role, message.content);
  return { role: 'system', content: textOf(message.content) };
};

export const buildMessages = (messages: ReadonlyArray<Message>): ReadonlyArray<OpenAiMessage> =>
  messages.map(roleMessage);

export const buildTools = (
  tools: ReadonlyArray<ToolDefinition>,
): ReadonlyArray<{ type: 'function'; function: ToolDefinition }> =>
  tools.map((t) => ({ type: 'function' as const, function: t }));

const putIfSome = (out: Record<string, unknown>, key: string, value: Option<number>): void => {
  if (value.some) out[key] = value.value;
};

export const buildSampling = (sampling: SamplingParams): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  putIfSome(out, 'temperature', sampling.temperature);
  putIfSome(out, 'top_p', sampling.topP);
  putIfSome(out, 'max_tokens', sampling.maxOutputTokens);
  if (sampling.stopSequences.length > 0) out['stop'] = [...sampling.stopSequences];
  return out;
};