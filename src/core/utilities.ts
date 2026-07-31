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
  | { type: 'reasoning'; text: string }
  | { type: 'opaque'; subtype: string; raws: unknown[] };

type EndData = { usage: TokenUsage; finishReason: FinishReason };
type End = Option<EndData>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const startAcc = (block: ContentBlockStart): Acc =>
  match(block)
    .with({ type: 'text' }, () => ({ type: 'text', text: '' }) as Acc)
    .with({ type: 'media' }, (b) => ({ type: 'media', mimeType: b.mimeType, data: '' }) as Acc)
    .with({ type: 'tool_call' }, (b) => ({ type: 'tool_call', id: b.id, name: b.name, argumentsBuffer: '' }) as Acc)
    .with({ type: 'reasoning' }, () => ({ type: 'reasoning', text: '' }) as Acc)
    .with({ type: 'opaque' }, (b) => ({ type: 'opaque', subtype: b.subtype, raws: [] as unknown[] }) as Acc)
    .exhaustive();

const applyDelta = (acc: Acc, delta: ContentBlockDelta): void => {
  match(delta)
    .with({ type: 'text' }, (d) => { if (acc.type === 'text') acc.text += d.text; })
    .with({ type: 'media' }, (d) => { if (acc.type === 'media') acc.data += d.data; })
    .with({ type: 'tool_call' }, (d) => { if (acc.type === 'tool_call') acc.argumentsBuffer += d.argumentsFragment; })
    .with({ type: 'reasoning' }, (d) => { if (acc.type === 'reasoning') acc.text += d.text; })
    .with({ type: 'opaque' }, (d) => { if (acc.type === 'opaque') acc.raws.push(d.raw); })
    .exhaustive();
};

const toContentBlock = (acc: Acc): ContentBlock =>
  match(acc)
    .with({ type: 'text' }, (a) => ({ type: 'text', text: a.text, providerOptions: none }) as const)
    .with({ type: 'media' }, (a) => ({ type: 'media', mimeType: a.mimeType, data: a.data, providerOptions: none }) as const)
    .with({ type: 'tool_call' }, (a) => ({ type: 'tool_call', id: a.id, name: a.name, arguments: parseArgs(a.argumentsBuffer), providerOptions: none }) as const)
    .with({ type: 'reasoning' }, (a) => ({ type: 'reasoning', text: a.text, providerOptions: none }) as const)
    .with({ type: 'opaque' }, (a) => ({ type: 'opaque', subtype: a.subtype, raw: a.raws, providerOptions: none }) as const)
    .exhaustive();

const parseArgs = (buffer: string): Record<string, unknown> => {
  const parsed = safeJsonParse(buffer);
  if (parsed.ok && isRecord(parsed.value)) return parsed.value;
  return {};
};

const defaultUsage: TokenUsage = { input: 0, output: 0, total: 0, cacheWrite: none, cacheRead: none };

const resolveEnd = (end: End): { finishReason: FinishReason; usage: TokenUsage } => ({
  finishReason: match(end)
    .with({ some: true }, (e) => e.value.finishReason)
    .with({ some: false }, () => 'unknown' as const)
    .exhaustive(),
  usage: match(end)
    .with({ some: true }, (e) => e.value.usage)
    .with({ some: false }, () => defaultUsage)
    .exhaustive(),
});

const sortedContent = (accs: Map<number, Acc>): ReadonlyArray<ContentBlock> =>
  [...accs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => toContentBlock(value));

const assemble = (
  accs: Map<number, Acc>,
  end: End,
  context: { provider: string; model: ModelId },
): ChatResponse => {
  const { finishReason, usage } = resolveEnd(end);
  return { content: sortedContent(accs), finishReason, usage, provider: context.provider, model: context.model };
};

export const collectStream = async (
  chunks: AsyncIterable<ChatChunk>,
  context: { provider: string; model: ModelId },
): Promise<ChatResponse> => {
  const accs = new Map<number, Acc>();
  let lastEnd: End = none;
  for await (const chunk of chunks) {
    match(chunk)
      .with({ type: 'start' }, (c) => { accs.set(c.index, startAcc(c.block)); })
      .with({ type: 'delta' }, (c) => { const a = accs.get(c.index); if (a) applyDelta(a, c.delta); })
      .with({ type: 'end' }, (c) => { lastEnd = some({ usage: c.usage, finishReason: c.finishReason }); })
      .exhaustive();
  }
  return assemble(accs, lastEnd, context);
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