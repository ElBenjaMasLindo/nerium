import { runResponseFixtures, runChunkFixtures, runErrorFixtures } from './harness.js';
import { anthropicCodec } from '../../src/codecs/anthropic.js';
import { anthropicResponseFixtures, anthropicChunkFixtures, anthropicErrorFixtures } from './fixtures/anthropic.js';

runResponseFixtures('anthropic', anthropicCodec, anthropicResponseFixtures);
runChunkFixtures('anthropic', anthropicCodec, anthropicChunkFixtures);
runErrorFixtures('anthropic', anthropicCodec, anthropicErrorFixtures);