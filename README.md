# Nerium

Provider-agnostic TypeScript SDK for language models, with **zero runtime dependencies**.

Changing providers is a configuration edit, never a rewrite of business code.

## Reference

This README is intentionally short. The complete, neutral reference for
Nerium's surface, semantics and guarantees is the **Conceptual Design
Document, version 0.4** (`.notes/Nerium.md`). Nothing here duplicates it;
read that document for the authoritative description of:

- The codec atom (§1) and the config/execution split (§2).
- Roles (§3), content blocks (§4), errors (§5), finish reasons (§6).
- Models & capabilities (§7), authentication (§8), stream events (§9).
- Token usage (§10), API surface (§11), provider coverage (§12).
- Type guarantees and conformance verification (§13).

## Status

Core codecs shipped: OpenAI-compatible, Anthropic Messages, Google Gemini.
Each is verified by a conformance harness (`tests/conformance/`) against
fixtures sourced from official provider docs (not live traffic).

## Public surface

```ts
import {
  createConnection, toPublicConnection, createClient,
  composeFallback, collectStream, appendAssistantTurn, appendToolResults,
  openaiCodec, anthropicCodec, geminiCodec,
} from 'nerium';
```

- `createConnection` returns a `Pipeline` (Result-based, the internal form).
- `toPublicConnection` converts a `Pipeline` into the throw-based public
  `Connection` consumers actually use.
- `createClient` is a typed map of named connections plus a default.
- `composeFallback` composes pipelines into one, advancing only on
  `transient` errors.

## Zero runtime dependencies

`ts-pattern` (used internally for exhaustive matching) is a
**devDependency** and is inlined into `dist/` by the build. The published
package has `dependencies: {}`. Verify with:

```
grep -c "require(\"ts-pattern\")\|from \"ts-pattern\"" dist/index.cjs dist/index.js
# → 0
```

## Verification

```
pnpm typecheck   # tsc --noEmit (strict)
pnpm lint        # sadist gate (eslint)
pnpm test        # vitest
```