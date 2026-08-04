import { match } from 'ts-pattern';
import { some, none } from '../../types/option.js';
import type { Option } from '../../types/option.js';
import { ok, err } from '../../types/result.js';
import type { Result } from '../../types/result.js';
import type { ContentBlock, ContentBlockStart } from '../../types/content.js';
import type { ChatChunk } from '../../types/stream.js';
import type { ChatResponse, FinishReason, TokenUsage } from '../../types/response.js';
import type { ErrorCategory, NeriumError } from '../../types/error.js';
import type { RawHttpResponse, RawStreamEvent } from '../../types/http-wire.js';
import { categorizeByStatus } from '../../core/http-status-category.js';
import { safeJsonParse } from '../../core/safe-json.js';
import { isRecord, isString, isNumber } from '../../core/json-guards.js';
import { toToolCallId, toModelId } from '../../types/branded.js';

const provider = 'anthropic';

export const mapFinishReason = (reason: string): FinishReason =>
  match(reason)
    .with('end_turn', () => 'complete' as const)
    .with('max_tokens', () => 'max_tokens' as const)
    .with('stop_sequence', () => 'stop_sequence' as const)
    .with('tool_use', () => 'tool_call' as const)
    // sadist-exception: NERIUM-1 provider stop-reason is an open string domain (design sec 6).
    .otherwise(() => 'unknown' as const);

const parseBodyObject = (body: string): Option<Record<string, unknown>> => {
  const parsed = safeJsonParse(body);
  return parsed.ok && isRecord(parsed.value) ? some(parsed.value) : none;
};

const numOrZero = (value: unknown): number => (isNumber(value) ? value : 0);

const cacheNum = (usage: Record<string, unknown>, key: string): Option<number> => {
  const v = usage[key];
  return isNumber(v) ? some(v) : none;
};

export const mapUsage = (usage: unknown): TokenUsage => {
  if (!isRecord(usage)) return { input: 0, output: 0, total: 0, cacheWrite: none, cacheRead: none };
  const input = numOrZero(usage['input_tokens']);
  const output = numOrZero(usage['output_tokens']);
  return { input, output, total: input + output, cacheWrite: cacheNum(usage, 'cache_creation_input_tokens'), cacheRead: cacheNum(usage, 'cache_read_input_tokens') };
};

const pushToolResult = (blocks: ContentBlock[], block: Record<string, unknown>): void => {
  const id = block['tool_use_id'];
  if (!isString(id)) return;
  const content = block['content'];
  const result = safeJsonParse(isString(content) ? content : '{}');
  blocks.push({ type: 'tool_result', toolCallId: toToolCallId(id), result: result.ok && isRecord(result.value) ? result.value : {}, providerOptions: none });
};

const pushToolUse = (blocks: ContentBlock[], block: Record<string, unknown>): void => {
  const id = block['id'];
  const name = block['name'];
  const input = block['input'];
  if (!isString(id) || !isString(name)) return;
  blocks.push({ type: 'tool_call', id: toToolCallId(id), name, arguments: isRecord(input) ? input : {}, providerOptions: none });
};

const pushText = (blocks: ContentBlock[], text: string): void => {
  if (text !== '') blocks.push({ type: 'text', text, providerOptions: none });
};

const pushThinking = (blocks: ContentBlock[], text: string): void => {
  if (text !== '') blocks.push({ type: 'reasoning', text, providerOptions: none });
};

const pushImage = (blocks: ContentBlock[], block: Record<string, unknown>): void => {
  const source = block['source'];
  if (!isRecord(source)) return;
  const mediaType = source['media_type'];
  const data = source['data'];
  if (!isString(mediaType) || !isString(data)) return;
  blocks.push({ type: 'media', mimeType: mediaType, data, providerOptions: none });
};

const pushContentBlock = (blocks: ContentBlock[], block: unknown): void => {
  if (!isRecord(block)) return;
  const type = block['type'];
  match(type)
    .with('text', () => { if (isString(block['text'])) pushText(blocks, block['text']); })
    .with('thinking', () => { if (isString(block['thinking'])) pushThinking(blocks, block['thinking']); })
    .with('tool_use', () => pushToolUse(blocks, block))
    .with('tool_result', () => pushToolResult(blocks, block))
    .with('image', () => pushImage(blocks, block))
    // sadist-exception: NERIUM-1 provider block type is an open vocabulary (design sec 4).
    .otherwise(() => blocks.push({ type: 'opaque', subtype: isString(type) ? type : 'unknown', raw: block, providerOptions: none }));
};

const unknownError = (raw: RawHttpResponse, message: string): NeriumError => ({
  category: 'unknown', code: 'parse', provider, status: some(raw.status), message, raw: raw.body,
});

export const parseResponse = (raw: RawHttpResponse): Result<ChatResponse, NeriumError> => {
  const body = parseBodyObject(raw.body);
  if (!body.some) return err(unknownError(raw, 'invalid body'));
  const content = body.value['content'];
  if (!Array.isArray(content)) return err(unknownError(raw, 'no content'));
  const blocks: ContentBlock[] = [];
  for (const block of content) pushContentBlock(blocks, block);
  return ok({
    content: blocks,
    finishReason: isString(body.value['stop_reason']) ? mapFinishReason(body.value['stop_reason']) : 'unknown',
    usage: mapUsage(body.value['usage']),
    provider,
    model: toModelId(isString(body.value['model']) ? body.value['model'] : ''),
  });
};

const chunkError = (event: RawStreamEvent): NeriumError => ({
  category: 'unknown', code: 'chunk', provider, status: none, message: 'invalid chunk', raw: event.data,
});

type StreamOptions = { ok: true; value: Option<ChatChunk> } | { ok: false; error: NeriumError };

const startBlock = (type: Record<string, unknown>, data: string): Result<ContentBlockStart, NeriumError> => {
  const blockType = type['type'];
  return match(blockType)
    .with('text', () => ok({ type: 'text' }) as Result<ContentBlockStart, NeriumError>)
    .with('thinking', () => ok({ type: 'reasoning' }) as Result<ContentBlockStart, NeriumError>)
    .with('tool_use', () => {
      const id = type['id'];
      const name = type['name'];
      if (!isString(id) || !isString(name)) return err(chunkError({ eventName: none, data }));
      return ok({ type: 'tool_call', id: toToolCallId(id), name });
    })
    // sadist-exception: NERIUM-1 provider block type is an open vocabulary.
    .otherwise(() => ok({ type: 'opaque', subtype: isString(blockType) ? blockType : 'unknown' })) as Result<ContentBlockStart, NeriumError>;
};

const handleStart = (data: string): StreamOptions => {
  const body = parseBodyObject(data);
  if (!body.some) return err(chunkError({ eventName: none, data }));
  const index = isNumber(body.value['index']) ? body.value['index'] : 0;
  const type = body.value['content_block'];
  if (!isRecord(type)) return ok(none);
  const block = startBlock(type, data);
  if (!block.ok) return err(block.error);
  return ok(some({ type: 'start', index, block: block.value }));
};

const deltaPayload = (delta: Record<string, unknown>, index: number): Option<ChatChunk> => {
  const t = delta['type'];
  const text = match(t)
    .with('text_delta', () => isString(delta['text']) ? some({ type: 'delta', index, delta: { type: 'text', text: delta['text'] } }) : none)
    .with('thinking_delta', () => isString(delta['thinking']) ? some({ type: 'delta', index, delta: { type: 'reasoning', text: delta['thinking'] } }) : none)
    .with('input_json_delta', () => isString(delta['partial_json']) ? some({ type: 'delta', index, delta: { type: 'tool_call', argumentsFragment: delta['partial_json'] } }) : none)
    // sadist-exception: NERIUM-1 provider delta type is an open vocabulary.
    .otherwise(() => none) as Option<ChatChunk>;
  return text;
};

const handleDelta = (data: string): StreamOptions => {
  const body = parseBodyObject(data);
  if (!body.some) return err(chunkError({ eventName: none, data }));
  const index = isNumber(body.value['index']) ? body.value['index'] : 0;
  const delta = body.value['delta'];
  if (!isRecord(delta)) return ok(none);
  return ok(deltaPayload(delta, index));
};

const endUsage = (data: string): { usage: TokenUsage; finishReason: FinishReason } => {
  const body = parseBodyObject(data);
  if (!body.some) return { usage: { input: 0, output: 0, total: 0, cacheWrite: none, cacheRead: none }, finishReason: 'unknown' };
  const delta = body.value['delta'];
  const usage = body.value['usage'];
  return {
    usage: mapUsage(usage),
    finishReason: isRecord(delta) && isString(delta['stop_reason']) ? mapFinishReason(delta['stop_reason']) : 'unknown',
  };
};

const handleMessageDelta = (data: string): StreamOptions =>
  ok(some({ type: 'end', ...endUsage(data) }));

const namedHandler = (name: Option<string>, data: string): StreamOptions =>
  match(name)
    .with({ some: true, value: 'content_block_start' }, () => handleStart(data))
    .with({ some: true, value: 'content_block_delta' }, () => handleDelta(data))
    .with({ some: true, value: 'message_delta' }, () => handleMessageDelta(data))
    // sadist-exception: NERIUM-1 SSE event names are an open provider vocabulary — not exhaustively enumerable.
    .otherwise(() => ok(none));

export const parseChunk = (event: RawStreamEvent): Result<Option<ChatChunk>, NeriumError> =>
  namedHandler(event.eventName, event.data);

const refineCategory = (raw: RawHttpResponse): ErrorCategory => {
  const body = parseBodyObject(raw.body);
  if (!body.some) return categorizeByStatus(raw.status);
  const error = body.value['error'];
  if (isRecord(error) && isString(error['type'])) {
    if (error['type'] === 'permission_error' || error['type'] === 'content_filter') return 'refused';
  }
  return categorizeByStatus(raw.status);
};

export const parseError = (raw: RawHttpResponse): NeriumError => {
  const body = parseBodyObject(raw.body);
  const message = body.some && isRecord(body.value['error']) && isString(body.value['error']['message'])
    ? body.value['error']['message']
    : raw.body;
  return { category: refineCategory(raw), code: 'anthropic_error', provider, status: some(raw.status), message, raw: raw.body };
};
