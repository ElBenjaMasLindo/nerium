# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Agent Skill (`docs/SKILL.md`)**: Added the document that should have existed since Day 1 for an SDK explicitly built for AI agents.
- **Agent Instructions (`AGENTS.md`)**: Added repository execution guidelines, pre-flight reading requirements, and quality protocol for AI agents.

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
