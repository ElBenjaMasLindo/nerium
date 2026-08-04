import { match } from 'ts-pattern';
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

const startAcc = (block: ContentBlockStart): Acc =>
  match(block)
    .with({ type: 'text' }, () => ({ type: 'text', text: '' }) as Acc)
    .with({ type: 'media' }, (b) => ({ type: 'media', mimeType: b.mimeType, data: '' }) as Acc)
    .with({ type: 'tool_call' }, (b) => ({ type: 'tool_call', id: b.id, name: b.name, argumentsBuffer: '' }) as Acc)
    .with({ type: 'reasoning' }, (b) => ({ type: 'reasoning', text: '', signature: b.signature }) as Acc)
    .with({ type: 'opaque' }, (b) => ({ type: 'opaque', subtype: b.subtype, raws: [] as unknown[] }) as Acc)
    .exhaustive();

const applyDelta = (acc: Acc, delta: ContentBlockDelta): void => {
  match(delta)
    .with({ type: 'text' }, (d) => { if (acc.type === 'text') acc.text += d.text; })
    .with({ type: 'media' }, (d) => { if (acc.type === 'media') acc.data += d.data; })
    .with({ type: 'tool_call' }, (d) => { if (acc.type === 'tool_call') acc.argumentsBuffer += d.argumentsFragment; })
    .with({ type: 'reasoning' }, (d) => {
      if (acc.type === 'reasoning') {
        acc.text += d.text;
        if (d.signature.some) acc.signature = d.signature;
      }
    })
    .with({ type: 'opaque' }, (d) => { if (acc.type === 'opaque') acc.raws.push(d.raw); })
    .exhaustive();
};

const toContentBlock = (acc: Acc): ContentBlock =>
  match(acc)
    .with({ type: 'text' }, (a) => ({ type: 'text', text: a.text, providerOptions: none }) as const)
    .with({ type: 'media' }, (a) => ({ type: 'media', mimeType: a.mimeType, data: a.data, providerOptions: none }) as const)
    .with({ type: 'tool_call' }, (a) => ({ type: 'tool_call', id: a.id, name: a.name, arguments: parseArgs(a.argumentsBuffer), providerOptions: none }) as const)
    .with({ type: 'reasoning' }, (a) => ({ type: 'reasoning', text: a.text, signature: a.signature, providerOptions: none }) as const)
    .with({ type: 'opaque' }, (a) => ({ type: 'opaque', subtype: a.subtype, raw: a.raws, providerOptions: none }) as const)
    .exhaustive();

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
  finishReason: match(end)
    .with({ some: true }, (e) => e.value.finishReason)
    .with({ some: false }, () => 'unknown' as const)
    .exhaustive(),
  usage: match(end)
    .with({ some: true }, (e) => fillTotal(e.value.usage))
    .with({ some: false }, () => defaultUsage)
    .exhaustive(),
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

export const collectStream = async (
  chunks: AsyncIterable<ChatChunk>,
  context: { provider: string; model: ModelId },
): Promise<ChatResponse> => {
  const accs = new Map<number, Acc>();
  const state: UsageState = { usage: none, end: none };
  for await (const chunk of chunks) {
    match(chunk)
      .with({ type: 'start' }, (c) => { accs.set(c.index, startAcc(c.block)); })
      .with({ type: 'delta' }, (c) => { const a = accs.get(c.index); if (a) applyDelta(a, c.delta); })
      .with({ type: 'end' }, (c) => { state.end = some({ usage: c.usage, finishReason: c.finishReason }); })
      .with({ type: 'usage' }, (c) => { state.usage = some(c.usage); })
      .exhaustive();
  }
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