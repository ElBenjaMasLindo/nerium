---
name: sadist
description: Pre-commit coding rules for TypeScript projects gated by the sadist linter. Read this skill before writing any function, and when tsc or ESLint rejects a commit. Covers null handling, error returns, exhaustive pattern matching, domain types, and structural constraints the gate enforces automatically.
compatibility: Requires Node.js 18+ and a TypeScript project with "sadist" installed
license: MPL-2.0
metadata:
  version: "0.5.3"
---

Write code that passes on the first attempt. These are hard rules, not style preferences.

## Rules

1. **No `null`/`undefined` in domain types.** Use:
   ```ts
   type Option<T> = { some: true; value: T } | { some: false };
   ```

2. **No `throw` outside `src/adapters/`.** Return instead:
   ```ts
   type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
   ```

3. **Every match on a union uses `ts-pattern` with `.exhaustive()`.**
   ```ts
   import { match } from "ts-pattern";
   match(result)
     .with({ ok: true }, (r) => r.value)
     .with({ ok: false }, (r) => handleError(r.error))
     .exhaustive();
   ```
   Never `.otherwise()` as a shortcut to skip a case — add the missing `.with()`.

4. **No `class` in domain logic.** Use functions and discriminated unions. Classes are allowed only in `src/adapters/` when an external framework requires them.

5. **No `any`, `as unknown as X`, `@ts-ignore`, `@ts-expect-error`, or `!` (non-null assertion).** No exception without a `// sadist-exception: <ticket>` comment.

6. **Cyclomatic complexity ≤ 6, function length ≤ 20 lines, ≤ 3 parameters.** If it doesn't fit, decompose it — don't suppress the rule.

7. **No generic type parameter used only once.** If `<T>` appears in one place, delete it.

8. **Primitive IDs use branded types, never bare `string`/`number`.**
   ```ts
   type UserId = string & { readonly __brand: "UserId" };
   ```

## Before writing any function

Check: does this function throw, return null, use `any`, or exceed 20 lines? If yes, restructure before writing, not after the gate rejects it.

## When the gate rejects a commit

Read the `tsc`/ESLint error verbatim — it names the exact rule and location. Fix that, re-run `tsc --noEmit && eslint .` locally, don't guess and recommit blind.

## Scope

This gate catches structural bugs (null handling, unhandled cases, exceptions, unsafe casts). It does not catch business-logic errors — correct types with wrong logic still pass. Test logic separately.
