import { describe, it, expect, vi, afterEach } from 'vitest';
import { send } from '../../src/adapters/http.js';
import { none, some } from '../../src/types/option.js';
import type { HttpRequest } from '../../src/types/http-wire.js';

const request: HttpRequest = {
  method: 'POST',
  url: 'https://example.test/chat',
  headers: { 'content-type': 'application/json' },
  body: some('{}'),
};

const mockFetch = (fn: typeof globalThis.fetch) => {
  vi.stubGlobal('fetch', fn);
};

afterEach(() => vi.unstubAllGlobals());

const makeResponse = (status: number, body: string): Response => {
  const headers = new Headers({ 'content-type': 'application/json' });
  return new Response(body, { status, headers });
};

describe('send', () => {
  it('returns ok(raw) for 2xx', async () => {
    mockFetch(async () => makeResponse(200, '{"ok":true}'));
    const out = await send(request, none);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.status).toBe(200);
      expect(out.value.body).toBe('{"ok":true}');
    }
  });

  it('keeps raw intact for non-2xx (status is not classified here)', async () => {
    mockFetch(async () => makeResponse(500, '{"error":"boom"}'));
    const out = await send(request, none);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.body).toBe('{"error":"boom"}');
  });

  it('returns err with category client when the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    mockFetch(async () => {
      const e = new DOMException('aborted', 'AbortError');
      throw e;
    });
    const out = await send(request, some(controller.signal));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.category).toBe('client');
  });
});