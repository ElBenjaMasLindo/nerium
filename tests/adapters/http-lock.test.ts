import { describe, it, expect, vi, afterEach } from 'vitest';
import { openStream } from '../../src/adapters/http.js';
import { none, some } from '../../src/types/option.js';
import type { HttpRequest } from '../../src/types/http-wire.js';

const dummyRequest: HttpRequest = {
  method: 'POST',
  url: 'https://api.example.test/stream',
  headers: { 'content-type': 'application/json' },
  body: some('{}'),
};

const mockFetchResponse = (response: Response) => {
  vi.stubGlobal('fetch', async () => response);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const createTestStream = (chunks: ReadonlyArray<string>) => {
  const encoder = new TextEncoder();
  let cancelled = false;
  let cancelReason: unknown = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
    cancel(reason) {
      cancelled = true;
      cancelReason = reason;
    },
  });

  return { stream, isCancelled: () => cancelled, getCancelReason: () => cancelReason };
};

describe('HTTP Reader lock leak prevention', () => {
  it('releases lock and cancels stream on early generator break', async () => {
    const { stream, isCancelled } = createTestStream(['chunk1\n', 'chunk2\n', 'chunk3\n']);
    const mockResponse = new Response(stream, { status: 200 });
    mockFetchResponse(mockResponse);

    const streamResult = await openStream(dummyRequest, none);
    expect(streamResult.ok).toBe(true);

    if (streamResult.ok) {
      const received: string[] = [];
      for await (const chunk of streamResult.value.body) {
        received.push(chunk);
        break;
      }

      expect(received).toEqual(['chunk1\n']);
      expect(stream.locked).toBe(false);
      expect(isCancelled()).toBe(true);
    }
  });

  it('releases lock and cancels stream when exception is thrown in consumer loop', async () => {
    const { stream, isCancelled } = createTestStream(['chunk1\n', 'chunk2\n']);
    const mockResponse = new Response(stream, { status: 200 });
    mockFetchResponse(mockResponse);

    const streamResult = await openStream(dummyRequest, none);
    expect(streamResult.ok).toBe(true);

    if (streamResult.ok) {
      const receiveAndThrow = async () => {
        for await (const chunk of streamResult.value.body) {
          if (chunk) throw new Error('consumer exception');
        }
      };

      await expect(receiveAndThrow()).rejects.toThrow('consumer exception');
      expect(stream.locked).toBe(false);
      expect(isCancelled()).toBe(true);
    }
  });

  it('releases lock upon completing normal stream consumption', async () => {
    const { stream } = createTestStream(['part1', 'part2']);
    const mockResponse = new Response(stream, { status: 200 });
    mockFetchResponse(mockResponse);

    const streamResult = await openStream(dummyRequest, none);
    expect(streamResult.ok).toBe(true);

    if (streamResult.ok) {
      const received: string[] = [];
      for await (const chunk of streamResult.value.body) {
        received.push(chunk);
      }
      expect(received).toEqual(['part1', 'part2']);
      expect(stream.locked).toBe(false);
    }
  });

  it('releases lock when stream errors during read', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('first'));
        controller.error(new Error('connection reset'));
      },
      cancel() {
        cancelled = true;
      },
    });
    mockFetchResponse(new Response(stream, { status: 200 }));

    const streamResult = await openStream(dummyRequest, none);
    expect(streamResult.ok).toBe(true);

    if (streamResult.ok) {
      const consumeWithError = async () => {
        const received: string[] = [];
        for await (const chunk of streamResult.value.body) {
          received.push(chunk);
        }
        return received;
      };

      await expect(consumeWithError()).rejects.toMatchObject({
        category: 'transient',
        code: 'network',
      });
      expect(stream.locked).toBe(false);
    }
  });

  it('handles response with null body without errors', async () => {
    const mockResponse = new Response(null, { status: 204 });
    mockFetchResponse(mockResponse);

    const streamResult = await openStream(dummyRequest, none);
    expect(streamResult.ok).toBe(true);

    if (streamResult.ok) {
      const chunks: string[] = [];
      for await (const chunk of streamResult.value.body) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([]);
    }
  });
});
