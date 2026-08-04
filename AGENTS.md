Before investigating or modifying code, read and apply the rules in the following files:

1. **[CONTRIBUTING.md](./CONTRIBUTING.md)**: Review the *Scope Filter* (Zero runtime dependencies, pure codecs) and conventional commit rules.
2. **[CHANGELOG.md](./CHANGELOG.md)**: Historical record of project changes; must be kept updated under `## [Unreleased]` for every new feature or bug fix following Keep a Changelog.

## Quality Protocol

- **Empirical Log-Based Diagnosis (No Guesswork)**:
  - When `tsc`, `eslint`, or `vitest` fail, your very first action must be to fetch and read the exact, un-truncated log or traceback. Never guess root causes or attempt blind fixes.
- **No Superficial Symptom Patches**:
  - Never swallow errors with empty `catch` blocks, force types using `@ts-ignore` / `as any`, introduce unspec'd fallback values to pass checks, or delete/comment out failing unit tests.
- **Cascading Contract Refactoring**:
  - If you alter a signature or exported type, search for and update all invocation sites across the repository.
