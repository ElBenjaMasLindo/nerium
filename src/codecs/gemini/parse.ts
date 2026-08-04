import { match } from 'ts-pattern';
import { some, none } from '../../types/option.js';
import type { Option } from '../../types/option.js';
import { ok, err } from '../../types/result.js';
import type { Result } from '../../types/result.js';
import type { ContentBlock } from '../../types/content.js';
import type { ChatChunk } from '../../types/stream.js';
import type { ChatResponse, FinishReason, TokenUsage } from '../../types/response.js';
import type { ErrorCategory, NeriumError } from '../../types/error.js';
import type { RawHttpResponse, RawStreamEvent } from '../../types/http-wire.js';
import { categorizeByStatus } from '../../core/http-status-category.js';
import { safeJsonParse } from '../../core/safe-json.js';
import { isRecord, isString, isNumber } from '../../core/json-guards.js';
import { toToolCallId, toModelId } from '../../types/branded.js';

const provider = 'gemini';

export const mapFinishReason = (reason: string): FinishReason =>
  match(reason)
    .with('STOP', () => 'complete' as const)
    .with('MAX_TOKENS', () => 'max_tokens' as const)
    .with('SAFETY', () => 'filtered' as const)
    // sadist-exception: NERIUM-1 provider finish-reason is an open string domain (design sec 6).
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
  return {
    input: numOrZero(usage['promptTokenCount']),
    output: numOrZero(usage['candidatesTokenCount']),
    total: numOrZero(usage['totalTokenCount']),
    cacheWrite: none,
    cacheRead: cacheNum(usage, 'cachedContentTokenCount'),
  };
};

const pushText = (blocks: ContentBlock[], text: string): void => {
  if (text !== '') blocks.push({ type: 'text', text, providerOptions: none });
};

const pushThought = (blocks: ContentBlock[], text: string): void => {
  if (text !== '') blocks.push({ type: 'reasoning', text, providerOptions: none });
};

const pushMedia = (blocks: ContentBlock[], part: Record<string, unknown>): void => {
  const data = part['inlineData'];
  if (!isRecord(data)) return;
  const mimeType = data['mimeType'];
  const raw = data['data'];
  if (!isString(mimeType) || !isString(raw)) return;
  blocks.push({ type: 'media', mimeType, data: raw, providerOptions: none });
};

const nameOrEmpty = (fc: Record<string, unknown>): string =>
  isString(fc['name']) ? fc['name'] : '';

const argsOrEmpty = (fc: Record<string, unknown>): Record<string, unknown> =>
  isRecord(fc['args']) ? fc['args'] : {};

const pushFunctionCall = (blocks: ContentBlock[], part: Record<string, unknown>): void => {
  const fc = part['functionCall'];
  if (!isRecord(fc)) return;
  const name = nameOrEmpty(fc);
  // Mint the call id from the name so a later tool_result can recover it (Gemini has no ids).
  blocks.push({ type: 'tool_call', id: toToolCallId(name), name, arguments: argsOrEmpty(fc), providerOptions: none });
};

const pushPart = (blocks: ContentBlock[], part: unknown): void => {
  if (!isRecord(part)) return;
  if (isString(part['text'])) {
    const isThought = part['thought'] === true;
    if (isThought) pushThought(blocks, part['text']);
    else pushText(blocks, part['text']);
    return;
  }
  if (isRecord(part['functionCall'])) pushFunctionCall(blocks, part);
  else if (isRecord(part['inlineData'])) pushMedia(blocks, part);
  else blocks.push({ type: 'opaque', subtype: 'gemini_part', raw: part, providerOptions: none });
};

const candidateBlocks = (body: Record<string, unknown>): ContentBlock[] => {
  const candidates = body['candidates'];
  if (!Array.isArray(candidates)) return [];
  const first = candidates[0];
  if (!isRecord(first)) return [];
  const content = first['content'];
  if (!isRecord(content)) return [];
  const parts = content['parts'];
  if (!Array.isArray(parts)) return [];
  const blocks: ContentBlock[] = [];
  for (const part of parts) pushPart(blocks, part);
  return blocks;
};

const hasFunctionCall = (blocks: ReadonlyArray<ContentBlock>): boolean =>
  blocks.some((b) => b.type === 'tool_call');

const candidateFinish = (body: Record<string, unknown>): FinishReason => {
  const candidates = body['candidates'];
  if (!Array.isArray(candidates)) return 'unknown';
  const first = candidates[0];
  if (!isRecord(first)) return 'unknown';
  const reason = first['finishReason'];
  return isString(reason) ? mapFinishReason(reason) : 'unknown';
};

const unknownError = (raw: RawHttpResponse, message: string): NeriumError => ({
  category: 'unknown', code: 'parse', provider, status: some(raw.status), message, raw: raw.body,
});

export const parseResponse = (raw: RawHttpResponse): Result<ChatResponse, NeriumError> => {
  const body = parseBodyObject(raw.body);
  if (!body.some) return err(unknownError(raw, 'invalid body'));
  const blocks = candidateBlocks(body.value);
  const finish = hasFunctionCall(blocks) ? 'tool_call' : candidateFinish(body.value);
  return {
    ok: true,
    value: {
      content: blocks,
      finishReason: finish,
      usage: mapUsage(body.value['usageMetadata']),
      provider,
      model: toModelId(isString(body.value['model']) ? body.value['model'] : ''),
    },
  } as const;
};

const chunkError = (event: RawStreamEvent): NeriumError => ({
  category: 'unknown', code: 'chunk', provider, status: none, message: 'invalid chunk', raw: event.data,
});

type StreamOptions = { ok: true; value: Option<ChatChunk> } | { ok: false; error: NeriumError };

const firstPart = (parts: unknown): Option<Record<string, unknown>> => {
  if (!Array.isArray(parts) || parts.length === 0) return none;
  const first = parts[0];
  return isRecord(first) ? some(first) : none;
};

const deltaFromPart = (part: Record<string, unknown>, index: number): Option<ChatChunk> => {
  const text = part['text'];
  const fc = part['functionCall'];
  if (isString(text) && text !== '') return some({ type: 'delta', index, delta: { type: 'text', text } });
  if (isRecord(fc)) return functionCallChunk(fc, index);
  return none;
};

const functionCallChunk = (fc: Record<string, unknown>, index: number): Option<ChatChunk> => {
  const name = nameOrEmpty(fc);
  return some({ type: 'start', index, block: { type: 'tool_call', id: toToolCallId(name), name } });
};

const endChunk = (body: Record<string, unknown>): Option<ChatChunk> => {
  const candidates = body['candidates'];
  if (!Array.isArray(candidates)) return none;
  const first = candidates[0];
  if (!isRecord(first) || !isString(first['finishReason'])) return none;
  return some({ type: 'end', usage: mapUsage(body['usageMetadata']), finishReason: mapFinishReason(first['finishReason']) });
};

const candidatePart = (body: Record<string, unknown>): Option<Record<string, unknown>> => {
  const candidates = body['candidates'];
  if (!Array.isArray(candidates)) return none;
  const first = candidates[0];
  if (!isRecord(first)) return none;
  const content = first['content'];
  if (!isRecord(content)) return none;
  return firstPart(content['parts']);
};

const dataChunk = (data: string): StreamOptions => {
  const body = parseBodyObject(data);
  if (!body.some) return err(chunkError({ eventName: none, data }));
  const end = endChunk(body.value);
  if (end.some) return ok(end);
  const part = candidatePart(body.value);
  if (!part.some) return ok(none);
  return ok(deltaFromPart(part.value, 0));
};

export const parseChunk = (event: RawStreamEvent): Result<Option<ChatChunk>, NeriumError> => dataChunk(event.data);

const refineCategory = (raw: RawHttpResponse): ErrorCategory => {
  const body = parseBodyObject(raw.body);
  if (!body.some) return categorizeByStatus(raw.status);
  const error = body.value['error'];
  if (isRecord(error) && isString(error['status'])) {
    if (error['status'] === 'PERMISSION_DENIED') return 'refused';
  }
  return categorizeByStatus(raw.status);
};

const geminiMessage = (raw: RawHttpResponse): string => {
  const body = parseBodyObject(raw.body);
  if (body.some && isRecord(body.value['error']) && isString(body.value['error']['message'])) return body.value['error']['message'];
  return raw.body;
};

export const parseError = (raw: RawHttpResponse): NeriumError => ({
  category: refineCategory(raw), code: 'gemini_error', provider, status: some(raw.status), message: geminiMessage(raw), raw: raw.body,
});
