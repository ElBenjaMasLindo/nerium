---
name: nerium
description: Use when writing or reviewing code that interacts with LLMs using the `nerium` client, or when creating custom provider codecs. Covers connection setup, tool loops, Option<T> strictness, and error handling.
license: MPL-2.0
---

## Core API Patterns

`nerium` is a provider-agnostic LLM client. To interact with it, you must adhere to its type contracts:
- **Option<T> for Optionals:** `nerium` API fields do not accept `null` or `undefined`. Optional parameters (like `signal` or `responseFormat`) require `Option<T>` (`{ some: true, value: T }` or `{ some: false }`). Use the exported `some(v)` and `none` helpers.
- **Result<T, E> for Internal Returns:** Functions like `createConnection` or codec logic return `Result<T, NeriumError>` instead of throwing. Check `.ok` to handle them.
- **Public Connections Throw:** Once you convert an internal `Pipeline` into a public `Connection` via `toPublicConnection(pipeline)`, the `Connection.chat` method throws `NeriumError` directly instead of returning `Result`, making it easy to consume in standard try/catch loops.

**Main Exports:** `createConnection`, `toPublicConnection`, `createClient`, `composeFallback`, `collectStream`, `appendAssistantTurn`, `appendToolResults`, `openaiCodec`, `anthropicCodec`, `geminiCodec`, `some`, `none`, `ok`, `err`, `toModelId`, `toToolCallId`.

## 1. Setup & Config

```ts
import { 
  createConnection, 
  toPublicConnection, 
  createClient, 
  composeFallback, 
  anthropicCodec,
  openaiCodec
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

const anthropicRes = await createConnection({ /* ... */ });
if (!anthropicRes.ok) throw anthropicRes.error;

// 2. Fallbacks (Combine Pipelines on transient errors)
const resilientPipeline = composeFallback([openaiRes.value, anthropicRes.value]);

// 3. Expose as Public Connection and Client
const conn = toPublicConnection(resilientPipeline);
const client = createClient({ resilient: conn }, 'resilient');
```

## 2. Tool Loop & Execution Recipe

```ts
import { some, none, toModelId, appendAssistantTurn, appendToolResults, type Message, type NeriumError } from 'nerium';

let messages: ReadonlyArray<Message> = [
  { role: 'user', content: [{ type: 'text', text: 'Hello', providerOptions: none }] },
];

while (true) {
  let response;
  try {
    response = await conn.chat({
      model: toModelId('gpt-5.6-luna'),
      messages,
      tools: [], // Array of ToolDefinition: { name, description, parameters }
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

  const toolCalls = response.content.filter((b): b is Extract<typeof b, { type: 'tool_call' }> => b.type === 'tool_call');
  const results = await Promise.all(toolCalls.map(async (call) => ({
    toolCallId: call.id,
    result: await executeTool(call.name, call.arguments),
  })));

  messages = appendToolResults(messages, results);
}
```

## 3. Streaming

```ts
// Using AsyncGenerator
for await (const chunk of conn.stream(request)) {
  if (chunk.type === 'start') console.log(chunk.block); // ContentBlockStart
  if (chunk.type === 'delta') console.log(chunk.delta); // ContentBlockDelta
  if (chunk.type === 'end') console.log(chunk.finishReason, chunk.usage);
}

// Or consume the entire stream into a ChatResponse
import { collectStream } from 'nerium';
const fullResponse = await collectStream(conn.stream(request), { 
  provider: 'openai', 
  model: toModelId('gpt-5.6-luna') 
});
```

## 4. Writing a Custom Codec

If you need to support a new provider, you must implement the `Codec` interface. These are pure functions (no network calls inside them).

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
