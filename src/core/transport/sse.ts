import { none, some } from '../../types/option.js';
import type { Option } from '../../types/option.js';
import type { RawStreamEvent } from '../../types/http-wire.js';
import { splitLines, stripPrefix } from './lines.js';

type SseState = { buffer: string; event: Option<string>; data: string[] };

const EMPTY = [] as const;

const dispatch = (state: SseState): ReadonlyArray<RawStreamEvent> => {
  if (state.data.length === 0) return EMPTY;
  const event: RawStreamEvent = { eventName: state.event, data: state.data.join('\n') };
  state.data = [];
  state.event = none;
  return [event];
};

const processLine = (state: SseState, line: string): ReadonlyArray<RawStreamEvent> => {
  if (line === '') return dispatch(state);
  if (line.startsWith(':')) return EMPTY;
  if (line.startsWith('data:')) { state.data.push(stripPrefix(line, 5)); return EMPTY; }
  if (line.startsWith('event:')) { state.event = some(stripPrefix(line, 6)); return EMPTY; }
  return EMPTY;
};

const finalFlush = function* (state: SseState): Generator<RawStreamEvent> {
  if (state.buffer !== '') yield* processLine(state, state.buffer.replace(/\r$/, ''));
  yield* dispatch(state);
};

export const parseSse = async function* (
  chunks: AsyncIterable<string>,
): AsyncGenerator<RawStreamEvent> {
  const state: SseState = { buffer: '', event: none, data: [] };
  for await (const chunk of chunks) {
    state.buffer += chunk;
    const { lines, rest } = splitLines(state.buffer);
    state.buffer = rest;
    for (const line of lines) yield* processLine(state, line);
  }
  yield* finalFlush(state);
};