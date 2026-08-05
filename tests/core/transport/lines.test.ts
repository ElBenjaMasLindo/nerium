import { describe, it, expect } from 'vitest';
import { splitLines, stripPrefix } from '../../../src/core/transport/lines.js';

describe('lines transport', () => {
  describe('splitLines', () => {
    it('splits text by LF correctly', () => {
      const { lines, rest } = splitLines('line1\nline2\nrest');
      expect(lines).toEqual(['line1', 'line2']);
      expect(rest).toBe('rest');
    });

    it('handles standalone \\r without trailing \\n', () => {
      const { lines, rest } = splitLines('line1\rline2\rrest');
      expect(lines).toEqual(['line1', 'line2']);
      expect(rest).toBe('rest');
    });

    it('handles CRLF \\r\\n correctly', () => {
      const { lines, rest } = splitLines('line1\r\nline2\r\nrest');
      expect(lines).toEqual(['line1', 'line2']);
      expect(rest).toBe('rest');
    });

    it('preserves trailing \\r when chunk ends with \\r', () => {
      const { lines, rest } = splitLines('data: hello\r');
      expect(lines).toEqual([]);
      expect(rest).toBe('data: hello\r');
    });

    it('handles chunk ending with \\r followed by chunk starting with \\n', () => {
      const res1 = splitLines('data: hello\r');
      expect(res1.lines).toEqual([]);
      expect(res1.rest).toBe('data: hello\r');

      const buf = res1.rest + '\nsecond: line\n';
      const res2 = splitLines(buf);
      expect(res2.lines).toEqual(['data: hello', 'second: line']);
      expect(res2.rest).toBe('');
    });

    it('handles empty string input', () => {
      const { lines, rest } = splitLines('');
      expect(lines).toEqual([]);
      expect(rest).toBe('');
    });

    it('handles consecutive newline variations \\r\\r and \\r\\n\\r\\n', () => {
      const resCr = splitLines('a\r\rb');
      expect(resCr.lines).toEqual(['a', '']);
      expect(resCr.rest).toBe('b');

      const resCrlf = splitLines('a\r\n\r\nb');
      expect(resCrlf.lines).toEqual(['a', '']);
      expect(resCrlf.rest).toBe('b');
    });
  });

  describe('stripPrefix', () => {
    it('strips prefix of given length and leading space', () => {
      expect(stripPrefix('data: hello', 5)).toBe('hello');
      expect(stripPrefix('event: msg', 6)).toBe('msg');
    });

    it('strips prefix without leading space if space is absent', () => {
      expect(stripPrefix('data:hello', 5)).toBe('hello');
    });

    it('returns empty string when line length equals prefix length', () => {
      expect(stripPrefix('data:', 5)).toBe('');
    });
  });
});
