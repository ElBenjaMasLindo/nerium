import { describe, it, expect } from 'vitest';
import { anthropicCodec } from '../../src/codecs/anthropic/index.js';
import { buildMessages } from '../../src/codecs/anthropic/wire.js';
import { none, some } from '../../src/types/option.js';
import { toModelId, toToolCallId } from '../../src/types/branded.js';
import type { ChatRequest, Message } from '../../src/types/request.js';

const baseRequest: ChatRequest = {
  model: toModelId('claude-3-5-sonnet'),
  messages: [],
  tools: [],
  responseFormat: none,
  sampling: { temperature: some(0.7), topP: none, maxOutputTokens: some(1024), stopSequences: [] },
  signal: none,
  providerOptions: none,
};

describe('Anthropic Codec Wire Protocol', () => {
  describe('consecutive tool result message coalescing', () => {
    it('coalesces consecutive tool result messages into a single user turn', () => {
      const messages: ReadonlyArray<Message> = [
        { role: 'user', content: [{ type: 'text', text: 'Run dual search', providerOptions: none }] },
        {
          role: 'assistant',
          content: [
            { type: 'tool_call', id: toToolCallId('call_1'), name: 'search_a', arguments: { q: 'alpha' }, providerOptions: none },
            { type: 'tool_call', id: toToolCallId('call_2'), name: 'search_b', arguments: { q: 'beta' }, providerOptions: none },
          ],
        },
        {
          role: 'tool',
          content: [{ type: 'tool_result', toolCallId: toToolCallId('call_1'), result: { found: 'alpha_data' }, providerOptions: none }],
        },
        {
          role: 'tool',
          content: [{ type: 'tool_result', toolCallId: toToolCallId('call_2'), result: { found: 'beta_data' }, providerOptions: none }],
        },
      ];

      const req: ChatRequest = { ...baseRequest, messages };
      const res = anthropicCodec.buildRequest(req, { baseURL: 'https://api.anthropic.com', extraHeaders: {}, stream: false });
      expect(res.ok).toBe(true);
      if (!res.ok || !res.value.body.some) return;

      const payload = JSON.parse(res.value.body.value) as {
        messages: ReadonlyArray<{ role: string; content: ReadonlyArray<Record<string, unknown>> }>;
      };

      expect(payload.messages).toHaveLength(3);
      expect(payload.messages[0]?.role).toBe('user');
      expect(payload.messages[1]?.role).toBe('assistant');

      const lastTurn = payload.messages[2];
      expect(lastTurn?.role).toBe('user');
      expect(lastTurn?.content).toHaveLength(2);
      expect(lastTurn?.content[0]).toEqual({
        type: 'tool_result',
        tool_use_id: 'call_1',
        content: JSON.stringify({ found: 'alpha_data' }),
      });
      expect(lastTurn?.content[1]).toEqual({
        type: 'tool_result',
        tool_use_id: 'call_2',
        content: JSON.stringify({ found: 'beta_data' }),
      });
    });
  });

  describe('thinking signature retention', () => {
    it('retains thinking signature in wire payload when signature is present', () => {
      const messages: ReadonlyArray<Message> = [
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'Step by step analysis', signature: some('sig_anthropic_123'), providerOptions: none },
            { type: 'text', text: 'Conclusion', providerOptions: none },
          ],
        },
      ];

      const built = buildMessages(messages);
      expect(built).toHaveLength(1);
      const assistantTurn = built[0];
      expect(assistantTurn?.role).toBe('assistant');
      expect(assistantTurn?.content[0]).toEqual({
        type: 'thinking',
        thinking: 'Step by step analysis',
        signature: 'sig_anthropic_123',
      });
    });

    it('omits signature property when thinking signature is none', () => {
      const messages: ReadonlyArray<Message> = [
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'Unsigned thought', signature: none, providerOptions: none },
          ],
        },
      ];

      const built = buildMessages(messages);
      expect(built).toHaveLength(1);
      const assistantTurn = built[0];
      expect(assistantTurn?.content[0]).toEqual({
        type: 'thinking',
        thinking: 'Unsigned thought',
      });
      expect(assistantTurn?.content[0]).not.toHaveProperty('signature');
    });
  });
});
