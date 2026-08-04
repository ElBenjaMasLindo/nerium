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

const provider = 'openai';
const zeroUsage: TokenUsage = { input: 0, output: 0, total: 0, cacheWrite: none, cacheRead: none };

export const mapFinishReason = (reason: string): FinishReason =>
  match(reason)
    .with('stop', () => 'complete' as const)
    .with('length', () => 'max_tokens' as const)
    .with('tool_calls', () => 'tool_call' as const)
    .with('function_call', () => 'tool_call' as const)
    .with('content_filter', () => 'filtered' as const)
    // sadist-exception: NERIUM-1 finish-reason is an open provider string domain (design sec 6) — not exhaustively enumerable.
    .otherwise(() => 'unknown' as const);

const parseBodyObject = (body: string): Option<Record<string, unknown>> => {
  const parsed = safeJsonParse(body);
  return parsed.ok && isRecord(parsed.value) ? some(parsed.value) : none;
};

const cachedTokens = (usage: Record<string, unknown>): Option<number> => {
  const details = usage['prompt_tokens_details'];
  if (!isRecord(details)) return none;
  const cached = details['cached_tokens'];
  return isNumber(cached) ? some(cached) : none;
};

const numOrZero = (value: unknown): number => (isNumber(value) ? value : 0);

export const mapUsage = (usage: unknown): TokenUsage => {
  if (!isRecord(usage)) return zeroUsage;
  return {
    input: numOrZero(usage['prompt_tokens']),
    output: numOrZero(usage['completion_tokens']),
    total: numOrZero(usage['total_tokens']),
    cacheWrite: none,
    cacheRead: cachedTokens(usage),
  };
};

const parsedArgs = (args: string): Record<string, unknown> => {
  const parsed = safeJsonParse(args);
  return parsed.ok && isRecord(parsed.value) ? parsed.value : {};
};

const pushImageUrl = (blocks: ContentBlock[], url: string): void => {
  const found = /^data:([^;]+);base64,(.*)$/s.exec(url);
  if (found !== null) blocks.push({ type: 'media', mimeType: found[1] ?? '', data: found[2] ?? '', providerOptions: none });
  else blocks.push({ type: 'opaque', subtype: 'image_url', raw: url, providerOptions: none });
};

const pushTextPart = (blocks: ContentBlock[], part: Record<string, unknown>): void => {
  const text = part['text'];
  if (isString(text)) blocks.push({ type: 'text', text, providerOptions: none });
};

const pushImagePart = (blocks: ContentBlock[], part: Record<string, unknown>): void => {
  const url = part['image_url'];
  if (isRecord(url) && isString(url['url'])) pushImageUrl(blocks, url['url']);
};

const pushPart = (blocks: ContentBlock[], part: unknown): void => {
  if (!isRecord(part)) return;
  const type = part['type'];
  if (type === 'text') pushTextPart(blocks, part);
  else if (type === 'image_url') pushImagePart(blocks, part);
  else blocks.push({ type: 'opaque', subtype: isString(type) ? type : 'unknown', raw: part, providerOptions: none });
};

const appendContent = (blocks: ContentBlock[], raw: unknown): void => {
  if (isString(raw) && raw !== '') blocks.push({ type: 'text', text: raw, providerOptions: none });
  else if (Array.isArray(raw)) for (const part of raw) pushPart(blocks, part);
};

const fnName = (fn: Record<string, unknown>): string => (isString(fn['name']) ? fn['name'] : '');
const fnArgs = (fn: Record<string, unknown>): string => (isString(fn['arguments']) ? fn['arguments'] : '');

const pushToolCall = (blocks: ContentBlock[], call: unknown): void => {
  if (!isRecord(call)) return;
  const id = call['id'];
  const fn = call['function'];
  if (!isString(id) || !isRecord(fn)) return;
  blocks.push({ type: 'tool_call', id: toToolCallId(id), name: fnName(fn), arguments: parsedArgs(fnArgs(fn)), providerOptions: none });
};

const messageToBlocks = (message: Record<string, unknown>): ContentBlock[] => {
  const blocks: ContentBlock[] = [];
  const reasoning = message['reasoning_content'];
  if (isString(reasoning) && reasoning !== '') blocks.push({ type: 'reasoning', text: reasoning, signature: none, providerOptions: none });
  appendContent(blocks, message['content']);
  if (Array.isArray(message['tool_calls'])) for (const call of message['tool_calls']) pushToolCall(blocks, call);
  return blocks;
};

const unknownError = (raw: RawHttpResponse, message: string): NeriumError => ({
  category: 'unknown', code: 'parse', provider, status: some(raw.status), message, raw: raw.body,
});

type ValidatedResponse = { message: Record<string, unknown>; choice: Record<string, unknown>; body: Record<string, unknown> };

const responseMessage = (raw: RawHttpResponse): Result<ValidatedResponse, NeriumError> => {
  const body = parseBodyObject(raw.body);
  if (!body.some) return err(unknownError(raw, 'invalid body'));
  const choices = body.value['choices'];
  if (!Array.isArray(choices)) return err(unknownError(raw, 'no choices'));
  const choice = choices[0];
  if (!isRecord(choice)) return err(unknownError(raw, 'invalid choice'));
  const message = choice['message'];
  if (!isRecord(message)) return err(unknownError(raw, 'no message'));
  return ok({ message, choice, body: body.value });
};

export const parseResponse = (raw: RawHttpResponse): Result<ChatResponse, NeriumError> => {
  const validated = responseMessage(raw);
  if (!validated.ok) return err(validated.error);
  const { message, choice, body } = validated.value;
  const finishRaw = choice['finish_reason'];
  return ok({
    content: messageToBlocks(message),
    finishReason: isString(finishRaw) ? mapFinishReason(finishRaw) : 'unknown',
    usage: mapUsage(body['usage']),
    provider,
    model: toModelId(isString(body['model']) ? body['model'] : ''),
  });
};

const chunkError = (event: RawStreamEvent): NeriumError => ({
  category: 'unknown', code: 'chunk', provider, status: none, message: 'invalid chunk', raw: event.data,
});

const firstToolCall = (raw: unknown): Option<Record<string, unknown>> => {
  if (!Array.isArray(raw) || raw.length === 0) return none;
  const first = raw[0];
  return isRecord(first) ? some(first) : none;
};

const toolCallChunk = (tc: Record<string, unknown>): Option<ChatChunk> => {
  const index = isNumber(tc['index']) ? tc['index'] : 0;
  const id = tc['id'];
  const fn = isRecord(tc['function']) ? tc['function'] : {};
  if (isString(id)) return some({ type: 'start', index, block: { type: 'tool_call', id: toToolCallId(id), name: fnName(fn) } });
  return some({ type: 'delta', index, delta: { type: 'tool_call', argumentsFragment: fnArgs(fn) } });
};

const finishChunk = (choice: Record<string, unknown>, body: Record<string, unknown>): Option<ChatChunk> => {
  const finishRaw = choice['finish_reason'];
  if (!isString(finishRaw)) return none;
  return some({ type: 'end', usage: mapUsage(body['usage']), finishReason: mapFinishReason(finishRaw) });
};

const toChunk = (choice: Record<string, unknown>, body: Record<string, unknown>): Option<ChatChunk> => {
  const delta = choice['delta'];
  if (!isRecord(delta)) return finishChunk(choice, body);
  const role = delta['role'];
  if (isString(role)) return some({ type: 'start', index: 0, block: { type: 'text' } });
  const tc = firstToolCall(delta['tool_calls']);
  if (tc.some) return toolCallChunk(tc.value);
  const content = delta['content'];
  if (isString(content) && content !== '') return some({ type: 'delta', index: 0, delta: { type: 'text', text: content } });
  return finishChunk(choice, body);
};

export const parseChunk = (event: RawStreamEvent): Result<Option<ChatChunk>, NeriumError> => {
  if (event.data === '[DONE]') return ok(none);
  const body = parseBodyObject(event.data);
  if (!body.some) return err(chunkError(event));
  const choices = body.value['choices'];
  if (!Array.isArray(choices)) return ok(none);
  if (choices.length === 0) return ok(none);
  const choice = choices[0];
  if (!isRecord(choice)) return err(chunkError(event));
  return ok(toChunk(choice, body.value));
};

const refineCategory = (raw: RawHttpResponse): ErrorCategory => {
  const body = parseBodyObject(raw.body);
  if (!body.some) return categorizeByStatus(raw.status);
  const error = body.value['error'];
  if (isRecord(error) && isString(error['type']) && error['type'] === 'content_filter') return 'refused';
  return categorizeByStatus(raw.status);
};

export const parseError = (raw: RawHttpResponse): NeriumError => {
  const body = parseBodyObject(raw.body);
  const errRecord: Record<string, unknown> = body.some && isRecord(body.value['error']) ? body.value['error'] : {};
  const code = isString(errRecord['code']) ? errRecord['code'] : isString(errRecord['type']) ? errRecord['type'] : 'unknown';
  const message = isString(errRecord['message']) ? errRecord['message'] : raw.body;
  return { category: refineCategory(raw), code, provider, status: some(raw.status), message, raw: raw.body };
};
