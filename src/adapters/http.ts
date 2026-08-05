import { ok, err } from '../types/result.js';
import { none, some } from '../types/option.js';
import type { Option } from '../types/option.js';
import type { Result } from '../types/result.js';
import type { NeriumError } from '../types/error.js';
import type { HttpRequest, RawHttpResponse } from '../types/http-wire.js';

export type StreamedResponse = {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: AsyncIterable<string>;
};

const fetchInit = (request: HttpRequest, signal: Option<AbortSignal>): RequestInit => {
  const init: RequestInit = { method: request.method, headers: { ...request.headers } };
  if (request.body.some) init.body = request.body.value;
  if (signal.some) init.signal = signal.value;
  return init;
};

const headersToRecord = (headers: Headers): Record<string, string> =>
  Object.fromEntries(headers.entries());

const toNetworkError = (e: unknown): NeriumError => {
  const isAbort = e instanceof Error && e.name === 'AbortError';
  return {
    category: isAbort ? 'client' : 'transient',
    code: isAbort ? 'aborted' : 'network',
    provider: '',
    status: none,
    message: e instanceof Error ? e.message : 'network error',
    raw: some(e),
  };
};

const flushDecoder = (decoder: TextDecoder): string => decoder.decode();

const readNextChunk = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<{ done: boolean; value?: Uint8Array }> => reader.read();

const releaseReader = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> => {
  try { await reader.cancel(); } catch { /* ignore */ }
  reader.releaseLock();
};

async function* pumpReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
): AsyncGenerator<string> {
  try {
    while (true) {
      const { done, value } = await readNextChunk(reader);
      if (done) break;
      if (value) yield decoder.decode(value, { stream: true });
    }
    const tail = flushDecoder(decoder);
    if (tail) yield tail;
  } catch (e) {
    throw toNetworkError(e);
  } finally {
    await releaseReader(reader);
  }
}

async function* readChunks(body: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (body === null) return;
  yield* pumpReader(body.getReader(), new TextDecoder());
}

export const send = async (
  request: HttpRequest,
  signal: Option<AbortSignal>,
): Promise<Result<RawHttpResponse, NeriumError>> => {
  try {
    const response = await fetch(request.url, fetchInit(request, signal));
    const body = await response.text();
    return ok({ status: response.status, headers: headersToRecord(response.headers), body });
  } catch (e) {
    return err(toNetworkError(e));
  }
};

export const openStream = async (
  request: HttpRequest,
  signal: Option<AbortSignal>,
): Promise<Result<StreamedResponse, NeriumError>> => {
  try {
    const response = await fetch(request.url, fetchInit(request, signal));
    return ok({
      status: response.status,
      headers: headersToRecord(response.headers),
      body: readChunks(response.body),
    });
  } catch (e) {
    return err(toNetworkError(e));
  }
};