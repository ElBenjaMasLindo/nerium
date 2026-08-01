# Contributing to Nerium

Thank you for considering contributing to Nerium! We welcome bug reports, feature suggestions, documentation improvements, and pull requests.

## Core Design Principles & Scope

Before proposing a new feature or pull request, please ensure it aligns with Nerium's core design philosophy:

### The Scope Filter

Ask yourself:
> *"Does this problem arise directly from the core definition of the product (chatting with LLMs without being tied to a provider or runtime), or is it an inherited problem from another project?"*

- **Strictly In Scope**:
  - Provider & protocol translation (OpenAI, Anthropic, Gemini, self-hosted endpoints) under a unified canonical interface.
  - Streaming, tool calling, token usage, multimodal content, structured outputs, context caching, cancellation (`AbortSignal`).
  - Pure, stateless Codecs for request/response wire translation.
- **Strictly Out of Scope**:
  - Retries with complex backoff/queues or partial stream resumption.
  - Embeddings, image generation, audio, fine-tuning, batch APIs.
  - UI framework integrations or telemetry/tracing dashboards.
  - Provider-side proprietary execution tools (e.g., hosted web search, code execution).
  - High-level tool calling loop orchestration.
  - OAuth flow management (identity management is out of scope).

### Translation Discipline

1. **Zero Runtime Dependencies**: `"dependencies": {}`. No external dependencies or polyfills allowed.
2. **Codecs are Pure Functions**: Codecs consist of 4 pure, stateless functions without network or state side-effects.
3. **Escape Hatches**: Provider behaviors (errors, stop reasons) must include escape categories (`unknown` or `opaque`) as providers change wire formats without notice.

---

## Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/ElBenjaMasLindo/nerium.git
   cd nerium
   ```

2. **Install dependencies**:
   ```bash
   npm install
   # or
   pnpm install
   ```

## Verification Commands

Before submitting a pull request, ensure all validation checks pass:

- **Typecheck & Lint**:
  ```bash
  pnpm gate
  ```
- **Run Tests**:
  ```bash
  pnpm test
  ```
- **Build Package**:
  ```bash
  pnpm build
  ```

## Pull Request Guidelines

- Use conventional commit messages: `feat(...)`, `fix(...)`, `docs(...)`, `chore(...)`, `ci(...)`.
- Include unit/conformance tests for any new codecs or bug fixes.
