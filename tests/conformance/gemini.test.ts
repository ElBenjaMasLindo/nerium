import { runResponseFixtures, runChunkFixtures, runErrorFixtures } from './harness.js';
import { geminiCodec } from '../../src/codecs/gemini.js';
import { geminiResponseFixtures, geminiChunkFixtures, geminiErrorFixtures } from './fixtures/gemini.js';

runResponseFixtures('gemini', geminiCodec, geminiResponseFixtures);
runChunkFixtures('gemini', geminiCodec, geminiChunkFixtures);
runErrorFixtures('gemini', geminiCodec, geminiErrorFixtures);