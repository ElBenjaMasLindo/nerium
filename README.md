# Nerium

> Provider-agnostic. Runtime-agnostic. Infrastructure-agnostic. Zero deps.

[![License: MPL-2.0](https://img.shields.io/badge/License-MPL_2.0-brightgreen.svg)](https://mozilla.org/MPL/2.0/)
[![npm version](https://img.shields.io/npm/v/nerium.svg)](https://www.npmjs.com/package/nerium)
[![CI](https://github.com/ElBenjaMasLindo/nerium/actions/workflows/ci.yml/badge.svg)](https://github.com/ElBenjaMasLindo/nerium/actions/workflows/ci.yml)

Nerium is a TypeScript SDK that talks to language models without tying you to a provider, a runtime, or a piece of infrastructure. It runs in Node, Deno, Bun, Workers, edge — anywhere fetch exists. It has zero runtime dependencies. It does not require a gateway, a service, or any companion package.

Small enough to fit in one agent skill. Give an LLM the full API surface in a single prompt and it can use every function correctly — no guessing.

## Install

```bash
npm install nerium
# or
pnpm add nerium
```

Requires Node.js 20+ (LTS) or any runtime with `fetch`. Targets TypeScript 5.x.

## Quickstart

```ts
import {
  createConnection, toPublicConnection,
  openaiCodec,
  some, none, toModelId,
  type CreateConnectionInput, type ChatRequest,
} from 'nerium';

const input: CreateConnectionInput = {
  codec: openaiCodec,
  auth: {
    type: 'static',
    credential: { type: 'value', value: `Bearer ${process.env.OPENAI_API_KEY}` },
    location: 'header',
    key: 'Authorization',
  },
  baseURL: 'https://api.openai.com/v1',
  extraHeaders: {},
  capabilities: {
    type: 'static',
    map: new Map([[
      toModelId('gpt-5.6-luna'),
      { streaming: true, tools: false, media: [], reasoning: false,
        structuredOutput: false, contextWindow: 128000, promptCaching: false },
    ]]),
  },
};

const built = await createConnection(input);
if (!built.ok) throw built.error;
const connection = toPublicConnection(built.value);

const request: ChatRequest = {
  model: toModelId('gpt-5.6-luna'),
  messages: [{
    role: 'user',
    content: [{ type: 'text', text: 'Say hello in one word.', providerOptions: none }],
  }],
  tools: [],
  responseFormat: none,
  sampling: { temperature: none, topP: none, maxOutputTokens: none, stopSequences: [] },
  signal: none,
  providerOptions: none,
};

const response = await connection.chat(request);
const text = response.content.find((b) => b.type === 'text');
console.log(text?.type === 'text' ? text.text : '<no text>');
```

## Why Nerium

- **Zero runtime dependencies.**
  `"dependencies": {}`. No transitive install, no supply-chain surface, no polyfill lock-in.
- **Built-in provider failover.**
  `composeFallback([a, b, c])` chains pipelines in order, advancing only on `transient` errors (rate limits, 5xx, network). `invalid` and `refused` errors propagate immediately because retrying won't fix them.
- **Fits in one agent skill.**
  The entire public API — types, functions, errors — is deliberately small. Paste it into a system prompt and any LLM can generate correct Nerium code without guessing.

- **Triple agnostic.**
  1. **Provider agnostic.**
    The same ChatRequest/ChatResponse interface works across every provider. Works with any provider that speaks OpenAI-compatible, Anthropic, or Gemini protocol. Swap between OpenAI, DeepSeek, Groq, Together, OpenRouter, Ollama, or any other — your code never changes.
  2. **Infrastructure agnostic.**
    Zero ecosystem. No companion services, no hosted gateways, no "Nerium Cloud" to migrate to. The SDK is the entire project — a thin, neutral layer that works with your existing infrastructure, not against it.
  3. **Runtime agnostic.**
    Zero Node-specific APIs. Zero runtime polyfills. The only platform primitive Nerium uses is fetch — it runs on Node, Deno, Bun, Workers, edge, or any JavaScript runtime with an HTTP client.

## Usage

### Multiple providers via a typed client

```ts
import { createClient, openaiCodec, anthropicCodec, geminiCodec } from 'nerium';

const client = createClient({
  openaiCompatible: openaiConnection,
  anthropic:        anthropicConnection,
  gemini:           geminiConnection,
}, 'openaiCompatible');

const conn = client.connection();            // default
const alt  = client.connection('anthropic'); // compile error if alias missing
```

### Streaming

```ts
for await (const chunk of connection.stream(request)) {
  if (chunk.type === 'delta' && chunk.delta.type === 'text') {
    process.stdout.write(chunk.delta.text);
  }
}
```

Three chunk types: `start`, `delta`, `end`. The three events that make up any stream. `collectStream(chunks, { provider, model })` reduces a stream to the equivalent `ChatResponse` when you don't need incremental output.

### Fallback between providers

```ts
import { composeFallback, toPublicConnection } from 'nerium';

const resilient = toPublicConnection(
  composeFallback([openaiPipeline, anthropicPipeline, geminiPipeline]),
);
```

`composeFallback` advances to the next connection only on `transient` errors (rate limits, 5xx, network). `invalid` and `refused` propagate immediately — retrying won't fix a bad request, and we won't pretend it might.

### Cancellation

Pass a standard `AbortSignal` via `request.signal`:

```ts
const ac = new AbortController();
const request = { ...rest, signal: some(ac.signal) };
setTimeout(() => ac.abort(), 30_000);
```

A cancelled request throws a `NeriumError` with `category: 'client'`.

## Supported protocols

| Protocol          | Wire format             | Providers using this protocol                          |
|-------------------|-------------------------|--------------------------------------------------------|
| OpenAI Compatible | Chat Completions        | OpenAI, DeepSeek, Groq, Together, Fireworks, OpenRouter, etc. |
| Anthropic         | Messages                | Anthropic                                              |
| Gemini            | generateContent (SSE)   | Google Gemini                                          |

AWS Bedrock, Azure OpenAI, and Vertex AI are not new codecs — they are variants of `auth` (`signed`) over the same codecs. Zero additional translation code.

## API

```ts
import {
  createConnection, toPublicConnection, createClient,
  composeFallback, collectStream,
  appendAssistantTurn, appendToolResults,
  openaiCodec, anthropicCodec, geminiCodec,
  some, none, toModelId, toToolCallId,
  type ChatRequest, type ChatResponse, type ChatChunk,
  type NeriumError, type Capabilities,
} from 'nerium';
```

- `createConnection(input)` — returns `Promise<Result<Pipeline, NeriumError>>`.
- `toPublicConnection(pipeline)` — converts the internal `Pipeline` (Result-based)
  into the public `Connection` (throw-based).
- `createClient(connections, defaultAlias)` — typed alias map. Unknown alias is
  a compile error.
- `composeFallback(pipelines)` — chains pipelines, advances on `transient`.
- `collectStream(chunks, ctx)` — stream → `ChatResponse`.
- `appendAssistantTurn(messages, response)` — pure helper.
- `appendToolResults(messages, results)` — pure helper.
- `openaiCodec`, `anthropicCodec`, `geminiCodec` — codec implementations for OpenAI-compatible, Anthropic, and Gemini protocols.
- `some` / `none` / `toModelId` / `toToolCallId` — required because Nerium uses
  explicit `Option<T>` and branded `ModelId` / `ToolCallId` instead of `T | undefined`.

## Versioning

SemVer. `0.x` allows breaking changes in `MINOR` (additions to discriminated unions count as breaking). Stability is achieved when the surface stops changing, not when the version hits 1.0.

## License

[Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/) — behaves like MIT when you `npm install` and use it as-is: no copyleft obligation on your code. Only applies if you modify nerium's own source files. See [LICENSE](LICENSE) for full terms.
