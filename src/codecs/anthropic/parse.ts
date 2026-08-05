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

export const mapFinishReason = (reason: string): FinishReason => {
  switch (reason) {
    case 'end_turn': return 'complete';
    case 'max_tokens': return 'max_tokens';
    case 'stop_sequence': return 'stop_sequence';
    case 'tool_use': return 'tool_call';
    default: return 'unknown';
  }
};

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

const pushThinking = (blocks: ContentBlock[], block: Record<string, unknown>): void => {
  const text = isString(block['thinking']) ? block['thinking'] : '';
  const signature = isString(block['signature']) ? some(block['signature']) : none;
  if (text !== '' || signature.some) blocks.push({ type: 'reasoning', text, signature, providerOptions: none });
};

const pushImage = (blocks: ContentBlock[], block: Record<string, unknown>): void => {
  const source = block['source'];
  if (!isRecord(source)) return;
  const mediaType = source['media_type'];
  const data = source['data'];
  if (!isString(mediaType) || !isString(data)) return;
  blocks.push({ type: 'media', mimeType: mediaType, data, providerOptions: none });
};

const pushMediaOrThinking = (blocks: ContentBlock[], type: string, block: Record<string, unknown>): boolean => {
  if (type === 'thinking') { pushThinking(blocks, block); return true; }
  if (type === 'image') { pushImage(blocks, block); return true; }
  return false;
};

const pushKnownBlock = (blocks: ContentBlock[], type: string, block: Record<string, unknown>): boolean => {
  if (type === 'text') { if (isString(block['text'])) pushText(blocks, block['text']); return true; }
  if (pushMediaOrThinking(blocks, type, block)) return true;
  if (type === 'tool_use') { pushToolUse(blocks, block); return true; }
  if (type === 'tool_result') { pushToolResult(blocks, block); return true; }
  return false;
};

const pushContentBlock = (blocks: ContentBlock[], block: unknown): void => {
  if (!isRecord(block)) return;
  const type = isString(block['type']) ? block['type'] : 'unknown';
  if (!pushKnownBlock(blocks, type, block)) {
    blocks.push({ type: 'opaque', subtype: type, raw: block, providerOptions: none });
  }
};

const unknownError = (raw: RawHttpResponse, message: string): NeriumError => ({
  category: 'unknown', code: 'parse', provider, status: some(raw.status), message, raw: some(raw.body),
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
  category: 'unknown', code: 'chunk', provider, status: none, message: 'invalid chunk', raw: some(event.data),
});

type StreamOptions = { ok: true; value: Option<ChatChunk> } | { ok: false; error: NeriumError };

const startToolCallBlock = (type: Record<string, unknown>, data: string): Result<ContentBlockStart, NeriumError> => {
  const id = type['id'];
  const name = type['name'];
  if (!isString(id) || !isString(name)) return err(chunkError({ eventName: none, data }));
  return ok({ type: 'tool_call', id: toToolCallId(id), name });
};

const startBlock = (type: Record<string, unknown>, data: string): Result<ContentBlockStart, NeriumError> => {
  const blockType = type['type'];
  if (blockType === 'text') return ok({ type: 'text' });
  if (blockType === 'thinking') return ok({ type: 'reasoning', signature: isString(type['signature']) ? some(type['signature']) : none });
  if (blockType === 'tool_use') return startToolCallBlock(type, data);
  return ok({ type: 'opaque', subtype: isString(blockType) ? blockType : 'unknown' });
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

const reasoningOrSignatureDelta = (delta: Record<string, unknown>, index: number): Option<ChatChunk> => {
  const t = delta['type'];
  if (t === 'thinking_delta' && isString(delta['thinking'])) return some({ type: 'delta', index, delta: { type: 'reasoning', text: delta['thinking'], signature: none } });
  if (t === 'signature_delta' && isString(delta['signature'])) return some({ type: 'delta', index, delta: { type: 'reasoning', text: '', signature: some(delta['signature']) } });
  return none;
};

const deltaPayload = (delta: Record<string, unknown>, index: number): Option<ChatChunk> => {
  const t = delta['type'];
  if (t === 'text_delta' && isString(delta['text'])) return some({ type: 'delta', index, delta: { type: 'text', text: delta['text'] } });
  const rs = reasoningOrSignatureDelta(delta, index);
  if (rs.some) return rs;
  if (t === 'input_json_delta' && isString(delta['partial_json'])) return some({ type: 'delta', index, delta: { type: 'tool_call', argumentsFragment: delta['partial_json'] } });
  return none;
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

const handleMessageStart = (data: string): StreamOptions => {
  const body = parseBodyObject(data);
  if (!body.some || !isRecord(body.value['message'])) return ok(none);
  const usage = body.value['message']['usage'];
  return isRecord(usage) ? ok(some({ type: 'usage', usage: mapUsage(usage) })) : ok(none);
};

const handleMessageDelta = (data: string): StreamOptions =>
  ok(some({ type: 'end', ...endUsage(data) }));

const namedHandler = (name: Option<string>, data: string): StreamOptions => {
  if (!name.some) return ok(none);
  switch (name.value) {
    case 'content_block_start': return handleStart(data);
    case 'content_block_delta': return handleDelta(data);
    case 'message_start': return handleMessageStart(data);
    case 'message_delta': return handleMessageDelta(data);
    default: return ok(none);
  }
};

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
  return { category: refineCategory(raw), code: 'anthropic_error', provider, status: some(raw.status), message, raw: some(raw.body) };
};
