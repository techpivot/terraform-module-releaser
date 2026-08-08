---
paths:
  - "__tests__/**/*.ts"
  - "__mocks__/**/*.ts"
---

# Test and Mock Rules

Full guide: `docs/testing.md`. Global setup (`__tests__/_setup.ts`) auto-mocks `@actions/core`, `@/config`, and
`@/context`.

- Reset state in `beforeEach`: `config.resetDefaults()` and `context.resetDefaults()`
- Override values per test with `config.set({...})` / `context.set({...})`
- Stub the Octokit mock with `stubOctokitReturnData()` / `stubOctokitImplementation()` from `@/tests/helpers/octokit`
- Build fixtures with factories (`createMockTerraformModule()`, `createMockTag()`, `createMockTags()`) — don't
  hand-construct complex objects
- Gate integration tests behind `GITHUB_TOKEN` availability and switch with `context.useRealOctokit()`
- Wiki fixtures in `__tests__/fixtures/` use Unicode filename characters (`∕` U+2215, `‒` U+2012) — preserve them
  exactly
- Action inputs are driven by `INPUT_*` env vars via `setupTestInputs()`; defaults come from `action.yml` at test time
- Use dedicated matchers — `toHaveLength(n)` not `.length` comparisons, `toBeInstanceOf(X)` / `.not.toBeInstanceOf(X)`
  not `instanceof` booleans, `toBeNaN()` not `Number.isNaN` checks — they report clearer failures
- Fold structurally identical tests into one `it.each` table with a descriptive `name`/`reason` field rendered via
  `$name` in the title; keep tests with distinct setup or extra assertions separate
- Declare hooks (`beforeEach`, `afterEach`, …) at the top of their `describe` scope, before any tests or nested
  describes
