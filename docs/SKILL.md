---
name: nerium
description: Use when writing or reviewing code that interacts with LLMs using the `nerium` client, or when creating custom provider codecs. Covers connection setup, tool loops, Option<T> strictness, zero-dependency pattern matching, and error handling.
license: MIT
---

## Core API Patterns

`nerium` is a provider-agnostic, zero-runtime-dependency LLM SDK. To interact with it, adhere to its strict type contracts:
- **Option<T> for Optionals:** `nerium` API fields do not accept `null` or `undefined`. Optional parameters (like `signal`, `responseFormat`, `temperature`) require `Option<T>` (`{ some: true, value: T }` or `{ some: false }`). Use exported `some(v)` and `none` helpers.
- **Result<T, E> for Internal Returns:** Internal pipeline creation, codec functions, and helper functions return `Result<T, NeriumError>` (`{ ok: true, value: T }` or `{ ok: false, error: E }`). Use exported `ok(v)` and `err(e)` helpers. Check `.ok` to handle them safely.
- **Zero Runtime Dependencies & Native Matching:** No `ts-pattern` or external runtime libraries. All discriminated unions (`ContentBlock`, `ChatChunk`, `ErrorCategory`, `Result`, `Option`) are narrowed using native TypeScript `switch` / `if` statements and type guards.
- **Public Connections Throw:** Once an internal `Pipeline` is converted into a public `Connection` via `toPublicConnection(pipeline)` or accessed via `createClient`, `Connection.chat` and `Connection.stream` throw `NeriumError` directly instead of returning `Result`, making try/catch consumption straightforward.

**Main Exports:** `createConnection`, `toPublicConnection`, `createClient`, `composeFallback`, `collectStream`, `appendAssistantTurn`, `appendToolResults`, `openaiCodec`, `anthropicCodec`, `geminiCodec`, `some`, `none`, `ok`, `err`, `toModelId`, `toToolCallId`.

## 1. Setup & Config

```ts
import {
  createConnection,
  toPublicConnection,
  createClient,
  composeFallback,
  openaiCodec,
  anthropicCodec
} from 'nerium';

// 1. Create internal pipelines (returns Result<Pipeline, NeriumError>)
const openaiRes = await createConnection({
  codec: openaiCodec,
  auth: { type: 'static', credential: { type: 'value', value: `Bearer ${process.env.OPENAI_API_KEY!}` }, location: 'header', key: 'Authorization' },
  baseURL: 'https://api.openai.com/v1',
  extraHeaders: {},
  capabilities: { type: 'discover' }, // Resolves model capabilities dynamically
});
if (!openaiRes.ok) throw openaiRes.error;

const anthropicRes = await createConnection({
  codec: anthropicCodec,
  auth: { type: 'static', credential: { type: 'value', value: process.env.ANTHROPIC_API_KEY! }, location: 'header', key: 'x-api-key' },
  baseURL: 'https://api.anthropic.com/v1',
  extraHeaders: { 'anthropic-version': '2023-06-01' },
  capabilities: { type: 'discover' },
});
if (!anthropicRes.ok) throw anthropicRes.error;

// 2. Fallbacks (Combine Pipelines on transient errors)
const resilientPipeline = composeFallback([openaiRes.value, anthropicRes.value]);

// 3. Expose as Public Connection and Client
const conn = toPublicConnection(resilientPipeline);
const client = createClient({ resilient: conn }, 'resilient');
```

## 2. Tool Loop & Execution Recipe

```ts
import {
  some,
  none,
  toModelId,
  appendAssistantTurn,
  appendToolResults,
  type Message,
  type NeriumError,
  type ContentBlock
} from 'nerium';

const conn = client.connection('resilient'); // Or client.connection() for default alias

let messages: ReadonlyArray<Message> = [
  { role: 'user', content: [{ type: 'text', text: 'Analyze weather in Tokyo', providerOptions: none }] },
];

while (true) {
  let response;
  try {
    response = await conn.chat({
      model: toModelId('gpt-4o'),
      messages,
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather for location',
          parameters: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] },
        },
      ],
      responseFormat: none, // Option<{ schema: Record<string, unknown> }>
      sampling: { temperature: none, topP: none, maxOutputTokens: none, stopSequences: [] },
      signal: none, // Option<AbortSignal>
      providerOptions: none,
    });
  } catch (e) {
    const err = e as NeriumError;
    if (err.category === 'transient') continue; // Implement your own delay/backoff here
    throw err; // categories: 'invalid', 'refused', 'client' (aborted), 'unknown'
  }

  messages = appendAssistantTurn(messages, response);
  if (response.finishReason !== 'tool_call') break;

  // Narrow discriminated union with native filter without ts-pattern
  const toolCalls = response.content.filter(
    (b): b is Extract<ContentBlock, { type: 'tool_call' }> => b.type === 'tool_call'
  );

  const results = await Promise.all(
    toolCalls.map(async (call) => ({
      toolCallId: call.id,
      result: await executeTool(call.name, call.arguments),
    }))
  );

  messages = appendToolResults(messages, results);
}
```

## 3. Streaming

```ts
// 1. Direct AsyncGenerator consumption with native switch
for await (const chunk of conn.stream(request)) {
  switch (chunk.type) {
    case 'start':
      console.log('Block start:', chunk.block); // ContentBlockStart
      break;
    case 'delta':
      console.log('Delta:', chunk.delta); // ContentBlockDelta
      break;
    case 'usage':
      console.log('Usage update:', chunk.usage); // TokenUsage
      break;
    case 'end':
      console.log('Finished:', chunk.finishReason, chunk.usage);
      break;
  }
}

// 2. Or consume the entire stream into a ChatResponse
import { collectStream } from 'nerium';
const fullResponse = await collectStream(conn.stream(request), {
  provider: 'openai',
  model: toModelId('gpt-4o')
});
```

## 4. Writing a Custom Codec

If you need to support a new provider, implement the `Codec` interface. Codecs are pure functions with no network side-effects.

```ts
import type { Result, NeriumError, ChatRequest, ChatResponse, ChatChunk, ModelInfo, Option } from 'nerium';
import type { HttpRequest, RawHttpResponse, RawStreamEvent } from 'nerium'; // HTTP wire types

type ConnectionRuntimeConfig = {
  baseURL: string;
  extraHeaders: Readonly<Record<string, string>>;
  stream: boolean;
};

export type Codec = {
  provider: string;
  buildRequest: (request: ChatRequest, config: ConnectionRuntimeConfig) => Result<HttpRequest, NeriumError>;
  parseResponse: (raw: RawHttpResponse) => Result<ChatResponse, NeriumError>;
  parseChunk: (event: RawStreamEvent) => Result<Option<ChatChunk>, NeriumError>;
  parseError: (raw: RawHttpResponse) => NeriumError;
  listModels: Option<(config: ConnectionRuntimeConfig) => Promise<Result<ReadonlyArray<ModelInfo>, NeriumError>>>;
};
```
