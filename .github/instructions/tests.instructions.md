---
applyTo: "__tests__/**/*.ts,__mocks__/**/*.ts"
---

## Test and Mock Guidelines

Tests use **Vitest** with V8 coverage. Test files mirror `src/` structure in `__tests__/`.

### Test Setup

- Global setup in `__tests__/_setup.ts` — auto-mocks `@actions/core`, `@/config`, `@/context`
- Path aliases: `@/tests/` → `__tests__/`, `@/mocks/` → `__mocks__/`, `@/` → `src/`
- Some tests require `GITHUB_TOKEN` env var — tests skip gracefully without it

### Mock Architecture (3-tier system)

1. **`__mocks__/@actions/core.ts`** — Replaces `@actions/core` globally. Logging silenced, `getInput`/`getBooleanInput`
   use real implementations (read `INPUT_*` env vars)
2. **`__mocks__/config.ts`** — Proxy mock with `.set({...})` to override config values and `.resetDefaults()` to
   restore. Loads real defaults from `action.yml`
3. **`__mocks__/context.ts`** — Proxy mock with `.set({...})`, `.reset()`, `.useRealOctokit()`, `.useMockOctokit()`.
   Defaults to mock Octokit

### Test Helpers (`__tests__/helpers/`)

- `action-defaults.ts` — Reads `action.yml` to extract input defaults
- `inputs.ts` — `setupTestInputs()` sets `INPUT_*` env vars. Exports categorized input arrays
- `octokit.ts` — Mock Octokit: `stubOctokitReturnData()`, `stubOctokitImplementation()`, `createRealOctokit()`
- `terraform-module.ts` — `createMockTerraformModule()`, `createMockTag()`, `createMockTags()` factories

### Writing Tests

- Always use `describe`/`it` blocks with descriptive names explaining expected behavior
- Reset mocks in `beforeEach` — use `config.resetDefaults()` and `context.reset()` when needed
- Use `stubOctokitReturnData()` for simple mock return values
- Use `stubOctokitImplementation()` for complex mock behavior
- For integration tests needing real GitHub API, use `context.useRealOctokit()` (requires `GITHUB_TOKEN`)
- Wiki test fixtures in `__tests__/fixtures/` use Unicode chars in filenames (U+2215, U+2012) — handle carefully
- When adding/removing/changing inputs in `action.yml`, also update `src/utils/metadata.ts` (`ACTION_INPUTS`) and
  `__tests__/utils/metadata.test.ts` in the same change

### Coverage

- V8 coverage on `src/` only (excludes tests, mocks, types)
- Run `npm run test` for full suite with coverage report
