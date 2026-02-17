# Testing Guide

This document covers the test infrastructure, mock architecture, and patterns for writing tests in the Terraform Module
Releaser project.

## Overview

- **Framework**: Vitest with V8 coverage
- **Test location**: `__tests__/` mirrors `src/` structure
- **Mock location**: `__mocks__/` for module-level mocks
- **Coverage scope**: `src/` only (excludes tests, mocks, `src/types/`)

## Running Tests

```bash
npm run test            # Full suite with coverage report
npm run test:watch      # Watch mode for development (re-runs on file changes)
```

Some tests require the `GITHUB_TOKEN` environment variable for real API calls. Tests without it skip gracefully.

## Test Setup (`__tests__/_setup.ts`)

The global setup file runs before every test file:

1. **Auto-mocks**: `vi.mock('@actions/core')`, `vi.mock('@/config')`, `vi.mock('@/context')`
2. **Environment variables**: Sets required GitHub env vars (`GITHUB_EVENT_NAME`, `GITHUB_REPOSITORY`, etc.)
3. **Input setup**: Calls `setupTestInputs()` in `beforeEach` to set `INPUT_*` env vars from action.yml defaults
4. **Console silencing**: Stubs `console.time`/`console.timeEnd` to reduce noise

## Mock Architecture

The project uses a sophisticated 3-tier mock system:

### Tier 1: `__mocks__/@actions/core.ts`

Replaces the `@actions/core` package globally. All functions are `vi.fn()` spies.

- **Silenced**: `info`, `debug`, `warning`, `error`, `notice`, `startGroup`, `endGroup`, `group`
- **Real implementations**: `getInput` and `getBooleanInput` delegate to actual implementations (read `INPUT_*` env
  vars), enabling tests to control action inputs via environment variables
- **`setFailed`**: Throws an error in tests for easier assertion

### Tier 2: `__mocks__/config.ts`

Proxy-based mock config singleton with two helper methods:

- **`.set({...})`** — Override specific config values for a test
- **`.resetDefaults()`** — Restore all values to action.yml defaults

The mock loads real defaults by calling `createConfigFromInputs()` from `src/utils/metadata.ts`, which reads `INPUT_*`
env vars set by `setupTestInputs()`.

```typescript
// In a test:
import { config } from "@/config";
config.set({ deleteLegacyTags: false, disableWiki: true });
// ... run test ...
config.resetDefaults(); // restore in beforeEach/afterEach
```

### Tier 3: `__mocks__/context.ts`

Proxy-based mock context with helper methods:

- **`.set({...})`** — Override specific context values
- **`.reset()`** — Restore defaults
- **`.useRealOctokit()`** — Switch to real authenticated Octokit client (requires `GITHUB_TOKEN`)
- **`.useMockOctokit()`** — Switch back to mock Octokit (default)

Default context provides: mock repository info (`techpivot/terraform-module-releaser`), PR number 1, workspace
directory, and a mock Octokit instance.

## Test Helpers (`__tests__/helpers/`)

### `action-defaults.ts`

Reads `action.yml` at test time to extract input defaults. Ensures tests always match production defaults even when
action.yml changes.

When action inputs are added, removed, or renamed in `action.yml`, update both `src/utils/metadata.ts` (`ACTION_INPUTS`)
and `__tests__/utils/metadata.test.ts` in the same change.

### `inputs.ts`

- **`setupTestInputs(overrides?)`** — Sets `INPUT_*` env vars from action.yml defaults, with optional overrides
- Exports categorized arrays: `requiredInputs`, `optionalInputs`, `booleanInputs`, `arrayInputs`, `stringInputs`,
  `numberInputs`
- Used in `_setup.ts` beforeEach to ensure clean input state

### `octokit.ts`

Sophisticated Octokit mock system:

- **`MockStore`** — Internal store for mock return values and implementations
- **`stubOctokitReturnData(path, method, data)`** — Set mock return value for a specific API call
- **`stubOctokitImplementation(path, method, fn)`** — Set mock implementation for complex scenarios
- **`createRealOctokit()`** — Creates real authenticated Octokit (for integration tests)

```typescript
// Mock a specific API call:
stubOctokitReturnData('repos', 'listTags', [{ name: 'module/v1.0.0', ... }]);

// Mock with custom logic:
stubOctokitImplementation('repos', 'listTags', async (params) => {
  return { data: [...], status: 200 };
});
```

### `terraform-module.ts`

Factory functions for test fixtures:

- **`createMockTerraformModule(overrides?)`** — Creates a `TerraformModule` instance with sensible defaults
- **`createMockTag(overrides?)`** — Creates a mock `GitHubTag`
- **`createMockTags(count, overrides?)`** — Creates an array of mock tags

## Writing New Tests

### Structure

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { config } from "@/config";
import { context } from "@/context";

describe("featureName", () => {
  beforeEach(() => {
    config.resetDefaults();
    context.reset();
  });

  it("should describe expected behavior clearly", async () => {
    // Arrange
    config.set({ someOption: "value" });
    stubOctokitReturnData("repos", "listTags", mockTags);

    // Act
    const result = await functionUnderTest();

    // Assert
    expect(result).toBe(expectedValue);
  });
});
```

### Best Practices

1. **Descriptive test names** — Use `it('should ...')` format that explains expected behavior
2. **Reset state** — Always reset config/context in `beforeEach`
3. **Minimal mocking** — Only mock what's necessary; let real code run where possible
4. **Isolated tests** — Each test should be independent; no shared mutable state between tests
5. **Use factories** — Prefer `createMockTerraformModule()` over manual object construction
6. **Integration tests** — Gate behind `GITHUB_TOKEN` check:

```typescript
const describeWithToken = process.env.GITHUB_TOKEN ? describe : describe.skip;
describeWithToken("integration tests", () => {
  beforeEach(() => {
    context.useRealOctokit();
  });
  // ...
});
```

### Wiki Test Fixtures

Wiki fixture files in `__tests__/fixtures/` use Unicode characters in filenames to match the wiki slug behavior:

- `∕` (U+2215) replaces `/` in paths
- `‒` (U+2012) replaces `-` in module names

Handle these carefully when creating or modifying fixtures.

## Path Aliases

Configured in both `tsconfig.json` and `vitest.config.ts`:

| Alias      | Maps to      |
| ---------- | ------------ |
| `@/`       | `src/`       |
| `@/tests/` | `__tests__/` |
| `@/mocks/` | `__mocks__/` |

## Coverage

V8 coverage is collected on `src/` with these exclusions:

- `__tests__/` — Test files
- `__mocks__/` — Mock files
- `src/types/` — Type-only files (no runtime code)

Coverage reporters: `json-summary`, `text` (console), `lcov` (HTML + SonarQube).
