import { describe, it, expect } from 'vitest';
import type { Codec } from '../../src/types/codec.js';
import type { RawHttpResponse, RawStreamEvent } from '../../src/types/http-wire.js';
import type { ChatResponse } from '../../src/types/response.js';
import type { ChatChunk } from '../../src/types/stream.js';
import type { NeriumError } from '../../src/types/error.js';
import type { Option } from '../../src/types/option.js';

export type ResponseFixture = {
  description: string;
  raw: RawHttpResponse;
  expected: { ok: true; value: ChatResponse } | { ok: false; error: NeriumError };
};

export type ChunkFixture = {
  description: string;
  raw: RawStreamEvent;
  // Optional because parseChunk may discard (e.g. [DONE] or usage-only chunks).
  expected: { ok: true; value: Option<ChatChunk> } | { ok: false; error: NeriumError };
};

export type ErrorFixture = {
  description: string;
  raw: RawHttpResponse;
  expected: NeriumError;
};

export const runResponseFixtures = (
  codecName: string,
  codec: Codec,
  fixtures: ReadonlyArray<ResponseFixture>,
): void => {
  describe(`${codecName} — parseResponse`, () => {
    for (const fixture of fixtures) {
      it(fixture.description, () => {
        expect(codec.parseResponse(fixture.raw)).toEqual(fixture.expected);
      });
    }
  });
};

export const runChunkFixtures = (
  codecName: string,
  codec: Codec,
  fixtures: ReadonlyArray<ChunkFixture>,
): void => {
  describe(`${codecName} — parseChunk`, () => {
    for (const fixture of fixtures) {
      it(fixture.description, () => {
        expect(codec.parseChunk(fixture.raw)).toEqual(fixture.expected);
      });
    }
  });
};

export const runErrorFixtures = (
  codecName: string,
  codec: Codec,
  fixtures: ReadonlyArray<ErrorFixture>,
): void => {
  describe(`${codecName} — parseError`, () => {
    for (const fixture of fixtures) {
      it(fixture.description, () => {
        expect(codec.parseError(fixture.raw)).toEqual(fixture.expected);
      });
    }
  });
};