import { describe, expect } from 'vitest';
import { runResponseFixtures, runChunkFixtures, runErrorFixtures } from './harness.js';
import { openaiCodec } from '../../src/codecs/openai/index.js';
import { openaiResponseFixtures, openaiChunkFixtures, openaiErrorFixtures } from './fixtures/openai.js';

runResponseFixtures('openai', openaiCodec, openaiResponseFixtures);
runChunkFixtures('openai', openaiCodec, openaiChunkFixtures);
runErrorFixtures('openai', openaiCodec, openaiErrorFixtures);