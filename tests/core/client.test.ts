import { describe, it, expect } from 'vitest';
import { createClient } from '../../src/core/client.js';
import type { Connection } from '../../src/types/connection.js';
import { none } from '../../src/types/option.js';
import { toModelId } from '../../src/types/branded.js';

const dummyConnection = (id: string): Connection => ({
  chat: async () => ({
    content: [],
    finishReason: 'complete',
    usage: { input: 0, output: 0, total: 0, cacheWrite: none, cacheRead: none },
    provider: id,
    model: toModelId('dummy'),
  }),
  stream: async function* () {},
  capabilitiesForModel: () => none,
  listModels: none,
});

describe('createClient', () => {
  it('returns default connection when alias is omitted', () => {
    const connA = dummyConnection('connA');
    const connB = dummyConnection('connB');
    const client = createClient({ primary: connA, secondary: connB }, 'primary');

    expect(client.connection()).toBe(connA);
  });

  it('returns specified connection when valid alias is provided', () => {
    const connA = dummyConnection('connA');
    const connB = dummyConnection('connB');
    const client = createClient({ primary: connA, secondary: connB }, 'primary');

    expect(client.connection('secondary')).toBe(connB);
  });
});
