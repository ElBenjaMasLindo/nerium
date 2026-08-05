import { none, some } from '../types/option.js';
import type { Option } from '../types/option.js';
import type { ChatChunk } from '../types/stream.js';
import type { ChatResponse, FinishReason, TokenUsage } from '../types/response.js';
import type { ContentBlock, ContentBlockStart, ContentBlockDelta, ToolResult } from '../types/content.js';
import type { Message } from '../types/request.js';
import type { ModelId, ToolCallId } from '../types/branded.js';
import { safeJsonParse } from './safe-json.js';

type Acc =
  | { type: 'text'; text: string }
  | { type: 'media'; mimeType: string; data: string }
  | { type: 'tool_call'; id: ToolCallId; name: string; argumentsBuffer: string }
  | { type: 'reasoning'; text: string; signature: Option<string> }
  | { type: 'opaque'; subtype: string; raws: unknown[] };

type EndData = { usage: TokenUsage; finishReason: FinishReason };
type End = Option<EndData>;
type UsageState = { usage: Option<TokenUsage>; end: End };
type NumberField = 'input' | 'output';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const startAcc = (block: ContentBlockStart): Acc => {
  switch (block.type) {
    case 'text': return { type: 'text', text: '' };
    case 'media': return { type: 'media', mimeType: block.mimeType, data: '' };
    case 'tool_call': return { type: 'tool_call', id: block.id, name: block.name, argumentsBuffer: '' };
    case 'reasoning': return { type: 'reasoning', text: '', signature: block.signature };
    case 'opaque': return { type: 'opaque', subtype: block.subtype, raws: [] };
  }
};

const applyReasoningDelta = (acc: Acc, delta: Extract<ContentBlockDelta, { type: 'reasoning' }>): void => {
  if (acc.type === 'reasoning') {
    acc.text += delta.text;
    if (delta.signature.some) acc.signature = delta.signature;
  }
};

const applyTextDelta = (acc: Acc, delta: ContentBlockDelta): boolean => {
  if (delta.type === 'text' && acc.type === 'text') { acc.text += delta.text; return true; }
  return false;
};

const applyContentDelta = (acc: Acc, delta: ContentBlockDelta): boolean => {
  if (applyTextDelta(acc, delta)) return true;
  if (delta.type === 'media' && acc.type === 'media') { acc.data += delta.data; return true; }
  if (delta.type === 'tool_call' && acc.type === 'tool_call') { acc.argumentsBuffer += delta.argumentsFragment; return true; }
  return false;
};

const applyDelta = (acc: Acc, delta: ContentBlockDelta): void => {
  if (applyContentDelta(acc, delta)) return;
  if (delta.type === 'reasoning') { applyReasoningDelta(acc, delta); return; }
  if (delta.type === 'opaque' && acc.type === 'opaque') { acc.raws.push(delta.raw); }
};

const toContentBlock = (acc: Acc): ContentBlock => {
  switch (acc.type) {
    case 'text': return { type: 'text', text: acc.text, providerOptions: none };
    case 'media': return { type: 'media', mimeType: acc.mimeType, data: acc.data, providerOptions: none };
    case 'tool_call': return { type: 'tool_call', id: acc.id, name: acc.name, arguments: parseArgs(acc.argumentsBuffer), providerOptions: none };
    case 'reasoning': return { type: 'reasoning', text: acc.text, signature: acc.signature, providerOptions: none };
    case 'opaque': return { type: 'opaque', subtype: acc.subtype, raw: acc.raws, providerOptions: none };
  }
};

const parseArgs = (buffer: string): Record<string, unknown> => {
  const parsed = safeJsonParse(buffer);
  if (parsed.ok && isRecord(parsed.value)) return parsed.value;
  return {};
};

const defaultUsage: TokenUsage = { input: 0, output: 0, total: 0, cacheWrite: none, cacheRead: none };

const fillTotal = (usage: TokenUsage): TokenUsage =>
  usage.total > 0 ? usage : { ...usage, total: usage.input + usage.output };

const mergeUsageFields = (base: TokenUsage, incoming: TokenUsage): TokenUsage => {
  const pick = (field: NumberField): number => {
    const candidate = incoming[field];
    return candidate > 0 ? candidate : base[field];
  };
  const input = pick('input');
  const output = pick('output');
  const cacheWrite = incoming.cacheWrite.some ? incoming.cacheWrite : base.cacheWrite;
  const cacheRead = incoming.cacheRead.some ? incoming.cacheRead : base.cacheRead;
  return { input, output, total: input + output, cacheWrite, cacheRead };
};

const resolveEnd = (end: End): { finishReason: FinishReason; usage: TokenUsage } => ({
  finishReason: end.some ? end.value.finishReason : 'unknown',
  usage: end.some ? fillTotal(end.value.usage) : defaultUsage,
});

const sortedContent = (accs: Map<number, Acc>): ReadonlyArray<ContentBlock> =>
  [...accs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => toContentBlock(value));

const hasToolCall = (accs: ReadonlyMap<number, Acc>): boolean => {
  for (const acc of accs.values()) if (acc.type === 'tool_call') return true;
  return false;
};

const assemble = (
  accs: Map<number, Acc>,
  state: UsageState,
  context: { provider: string; model: ModelId },
): ChatResponse => {
  const resolved = resolveEnd(state.end);
  const usage = state.usage.some ? mergeUsageFields(state.usage.value, resolved.usage) : resolved.usage;
  const content = sortedContent(accs);
  const finishReason = hasToolCall(accs) ? 'tool_call' : resolved.finishReason;
  return { content, finishReason, usage, provider: context.provider, model: context.model };
};

const applyChunkToState = (chunk: ChatChunk, accs: Map<number, Acc>, state: UsageState): void => {
  if (chunk.type === 'start') { accs.set(chunk.index, startAcc(chunk.block)); return; }
  if (chunk.type === 'delta') { const a = accs.get(chunk.index); if (a) applyDelta(a, chunk.delta); return; }
  if (chunk.type === 'end') { state.end = some({ usage: chunk.usage, finishReason: chunk.finishReason }); return; }
  if (chunk.type === 'usage') { state.usage = some(chunk.usage); }
};

export const collectStream = async (
  chunks: AsyncIterable<ChatChunk>,
  context: { provider: string; model: ModelId },
): Promise<ChatResponse> => {
  const accs = new Map<number, Acc>();
  const state: UsageState = { usage: none, end: none };
  for await (const chunk of chunks) applyChunkToState(chunk, accs, state);
  return assemble(accs, state, context);
};

export const appendAssistantTurn = (
  messages: ReadonlyArray<Message>,
  response: ChatResponse,
): ReadonlyArray<Message> =>
  [...messages, { role: 'assistant', content: response.content }];

const toToolMessage = (result: ToolResult): Message => ({
  role: 'tool',
  content: [{ type: 'tool_result', toolCallId: result.toolCallId, result: result.result, providerOptions: none }],
});

export const appendToolResults = (
  messages: ReadonlyArray<Message>,
  results: ReadonlyArray<ToolResult>,
): ReadonlyArray<Message> =>
  [...messages, ...results.map(toToolMessage)];