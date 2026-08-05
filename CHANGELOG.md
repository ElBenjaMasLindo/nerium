# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Agent Skill (`docs/SKILL.md`)**: Added the document that should have existed since Day 1 for an SDK explicitly built for AI agents.
- **Agent Instructions (`AGENTS.md`)**: Added repository execution guidelines, pre-flight reading requirements, and quality protocol for AI agents.
- **OpenAI Chunk Fixtures**: Added 3 fixtures covering additional `finish_reason` mappings (`length` → `max_tokens`, `content_filter` → `filtered`, legacy `function_call` → `tool_call`).
- **Gemini Chunk Fixtures**: Added 3 fixtures covering additional `finishReason` mappings (`SAFETY` → `filtered`, `MAX_TOKENS` → `max_tokens`) and a discarded chunk without candidates.

### Changed
- **Agent Instructions (`AGENTS.md`)**: Added requirement to keep `docs/SKILL.md` updated whenever API patterns, exports, or contracts change.
- **Zero Runtime Dependencies**: Refactored codebase to completely remove `ts-pattern` from runtime source files (`src/`), replacing pattern matching with native TypeScript `switch` / `if` statements on discriminated unions.
- **Sadist Linter Compliance**: Enforced Sadist linter rules across domain types and internal returns (`Option<T>`, `Result<T, E>`), ensuring `raw: Option<unknown>` in `NeriumError` and strict non-null/non-undefined domain types.
- **Codec Organization**: Reorganized provider codecs (`anthropic`, `gemini`, `openai`) into dedicated subdirectories under `src/codecs/`.
- **OpenAI Codec Refactor**: Eliminated seven duplicate tool-call helper functions in `openai/parse.ts` (`fnOf`, `nameOf`, `argsOf`, `nameFromFunction`, `argsFromFunction`, `nameOfStringRecord`, `argsOfStringRecord`) and replaced with two direct accessors (`fnName`, `fnArgs`).
- **OpenAI Error Parsing**: Inlined `errorCodeField` and `extractErrorFields` into `parseError` to match the Anthropic and Gemini pattern.
- **Stream Usage**: `collectStream` now preserves Anthropic `message_start` input usage and merges it with the final `message_delta` output usage instead of overwriting it; missing `total` is derived from `input + output`. Added `usage` chunk variant to `ChatChunk` to carry mid-stream token counts.
- **Reasoning Signatures**: Anthropic and Gemini now preserve `signature` and `thoughtSignature` across streaming and response parsing, including signature-only deltas. `ContentBlock`, `ContentBlockStart`, and `ContentBlockDelta` now carry `signature: Option<string>` on reasoning blocks.
- **`tool_call` Finish Consistency**: Gemini streaming now forces `finishReason: 'tool_call'` when the same wire event includes a `functionCall` part; `collectStream` applies the same override when accumulated blocks contain a tool call, keeping streaming and non-streaming contracts aligned.
- **Gemini Function Call IDs**: Gemini now prefers the wire `id` field on `functionCall` parts over the function name for generating stable tool-call identifiers.
- **Fallback Engine Aggregation**: `composeFallback` now aggregates `capabilitiesForModel` across all configured fallback pipelines and deduplicates available models in `listModels`.
- **HTTP Status Code Mapping**: Extended `categorizeByStatus` to classify HTTP 408 and 504 as `transient` errors, 404 and 422 as `invalid` errors, and 402 as `refused`.

### Fixed
- **OpenAI Codec Payload**: Fixed structured output payload by requiring the `json_schema.name` property in `response_format` JSON schema payloads.
- **Anthropic Wire Codec**: Fixed user turn handling by automatically merging consecutive same-role turns in `buildMessages` and preserved thinking `signature` in thinking content blocks.
- **Gemini Codec**: Added structured output generation configuration (`responseMimeType: 'application/json'` and `responseSchema`) and fixed safe query string parameter joining when appending `alt=sse`.
- **SSE Line Ending Support**: Enhanced SSE line parser (`splitLines`) to support `\r\n`, `\n`, and isolated `\r` line endings, including trailing carriage returns across chunk boundaries.
- **HTTP Stream Lock Release**: Added explicit `reader.releaseLock()` and `reader.cancel()` in `pumpReader`'s `finally` block to guarantee lock release and prevent reader leaks upon stream termination or errors.

## [0.1.0] - 2026-08-01

### Added
- **Zero-dependency LLM SDK**: Lightweight TypeScript SDK for multi-provider LLM interactions.
- **Provider Codecs**:
  - `openaiCodec`: OpenAI Chat Completions protocol support (OpenAI, Groq, Together, DeepSeek, OpenRouter, Ollama).
  - `anthropicCodec`: Anthropic Messages protocol support (with AWS Bedrock signature variant support).
  - `geminiCodec`: Google Gemini `generateContent` protocol support.
- **Failover & Resilience**:
  - `composeFallback`: Multi-provider failover pipeline that automatically advances only on transient errors (429, 5xx, network timeouts).
- **Streaming & Aggregation**:
  - Unified async iterable stream with `start`, `delta`, and `end` chunk types.
  - `collectStream`: Helper to reduce stream chunks into a final `ChatResponse`.
- **Pure Helpers**:
  - `appendAssistantTurn`: Helper to record assistant turns in conversation history.
  - `appendToolResults`: Helper to record tool execution results.
- **Strong Typing**:
  - `Option<T>` with `some` and `none` for explicit optional fields.
  - Branded types `ModelId` and `ToolCallId` (`toModelId`, `toToolCallId`).
  - Strict typed multi-provider client via `createClient`.

[Unreleased]: https://github.com/ElBenjaMasLindo/nerium/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ElBenjaMasLindo/nerium/releases/tag/v0.1.0
