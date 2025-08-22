# Terraform Module Releaser

A GitHub Action written in TypeScript that automates versioning, releases, and documentation for Terraform modules in GitHub monorepos. The action creates module-specific Git tags, GitHub releases, pull request comments, and generates comprehensive wiki documentation.

**Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.**

## Working Effectively

### Bootstrap and Build the Repository
- Install Node.js dependencies: `npm ci --no-fund` -- takes 3-15 seconds. NEVER CANCEL. Set timeout to 30+ seconds.
- Run TypeScript type checking: `npm run typecheck` -- takes ~4 seconds. NEVER CANCEL. Set timeout to 15+ seconds.
- Lint and format code: `npm run check:fix` -- takes <1 second. Set timeout to 15+ seconds.
- Build the action bundle: `npm run package` -- takes 6-8 seconds. NEVER CANCEL. Set timeout to 30+ seconds.
- Run the complete build pipeline: `npm run bundle` -- takes 7-8 seconds (runs check:fix + package). NEVER CANCEL. Set timeout to 45+ seconds.

### Testing
- Run core tests (without external dependencies): `npx vitest run --coverage=false __tests__/config.test.ts __tests__/parser.test.ts __tests__/terraform-module.test.ts` -- takes ~2 seconds. Set timeout to 30+ seconds.
- Run full test suite: `npm run test` -- takes ~5 seconds but REQUIRES GITHUB_TOKEN environment variable for some tests. NEVER CANCEL. Set timeout to 60+ seconds.
- Run tests in watch mode during development: `npm run test:watch`
- Test module parsing functionality: `npm run test:parse-modules` -- takes <1 second. Set timeout to 30+ seconds.

### Development and Local Testing
- The main entry point is `src/index.ts` which calls `src/main.ts`
- Key source files: `src/main.ts`, `src/config.ts`, `src/context.ts`, `src/parser.ts`, `src/terraform-module.ts`
- Wiki generation: `src/wiki.ts`, `src/terraform-docs.ts`
- GitHub API interactions: `src/releases.ts`, `src/tags.ts`, `src/pull-request.ts`
- Type definitions: `src/types/`
- Test files mirror source structure in `__tests__/`

## Validation

### Required Environment Variables for Full Testing
- `GITHUB_TOKEN` - Required for tests that interact with GitHub API. Without this, some tests will be skipped with clear error messages.

### External Dependencies
- **terraform-docs binary**: Required for wiki generation. The action downloads and installs it automatically from https://terraform-docs.io/dl/ during execution.
- **Internet access**: Required for downloading terraform-docs and running full integration tests.

### Manual Validation Scenarios
- **Always test module parsing**: Run `npm run test:parse-modules` to verify the core module discovery and parsing logic works correctly.
- **Always test configuration**: Run `npx vitest run --coverage=false __tests__/config.test.ts` to verify configuration parsing works.
- **Always validate TypeScript compilation**: Run `npm run typecheck` to catch type errors.
- **Always validate the action bundle**: Run `npm run package` to ensure the action can be built for GitHub Actions.
- **Always test core functionality**: Run the core test suite to verify basic operation without external dependencies.
- **Validate linting compliance**: Run `npm run check:fix` and then `npm run check` to ensure code meets style requirements.

### Comprehensive Validation Command
To validate the entire codebase quickly, run this sequence:
```bash
npm ci --no-fund && npm run typecheck && npm run check:fix && npm run package && npx vitest run --coverage=false __tests__/config.test.ts __tests__/parser.test.ts __tests__/terraform-module.test.ts && npm run test:parse-modules
```
This validates dependencies, types, linting, build, and core functionality in one command sequence.

## Common Tasks

### Build and Test Workflow
1. `npm ci --no-fund` -- Install dependencies (3-15 seconds)
2. `npm run typecheck` -- Type checking (4 seconds)  
3. `npm run check:fix` -- Lint and format code (<1 second)
4. `npm run package` -- Build action bundle (6-8 seconds)
5. `npx vitest run --coverage=false __tests__/config.test.ts __tests__/parser.test.ts __tests__/terraform-module.test.ts` -- Run core tests (2 seconds)

### Full CI Validation (requires GITHUB_TOKEN)
1. Follow build workflow above
2. `npm run test` -- Run full test suite including GitHub API integration tests (5 seconds)

### Development
- Use `npm run test:watch` for continuous testing during development
- Use `npm run check` to check linting without fixing
- The action is packaged into `dist/index.js` using ncc - always run `npm run package` after code changes
- Always run `npm run check:fix` before committing or the CI (.github/workflows/lint.yml) will fail

### Working with the Action Locally
- The action can be tested locally using the CI workflow configuration in `.github/workflows/ci.yml`
- Test terraform modules are located in `tf-modules/` directory
- Use GitHub Codespaces or Dev Containers for a consistent development environment (configuration in `.devcontainer/`)

## Key Repository Structure

```
/home/runner/work/terraform-module-releaser/terraform-module-releaser/
├── .devcontainer/          # Dev container configuration
├── .github/workflows/      # CI/CD workflows (ci.yml, test.yml, lint.yml)
├── __mocks__/             # Test mocks
├── __tests__/             # Test files (mirror src/ structure)
├── action.yml             # GitHub Action metadata and inputs
├── dist/                  # Compiled action bundle (generated)
├── package.json           # Dependencies and scripts
├── scripts/               # Utility scripts (changelog.js, parse-modules-test.ts)
├── src/                   # TypeScript source code
│   ├── index.ts          # Action entry point
│   ├── main.ts           # Main action logic
│   ├── config.ts         # Configuration handling
│   ├── context.ts        # GitHub Actions context
│   ├── parser.ts         # Terraform module discovery
│   ├── terraform-module.ts # Module representation
│   ├── wiki.ts           # Wiki generation
│   ├── terraform-docs.ts # Terraform documentation
│   ├── releases.ts       # GitHub releases
│   ├── tags.ts           # Git tags
│   ├── pull-request.ts   # PR comments
│   └── types/            # TypeScript type definitions
├── tf-modules/            # Example Terraform modules for testing
├── biome.json            # Biome linter/formatter configuration
├── tsconfig.json         # TypeScript configuration
└── vitest.config.ts      # Test configuration
```

## Critical Build Information

### Timeout Requirements
- **npm ci**: NEVER CANCEL - takes 3-15 seconds, set timeout to 30+ seconds
- **npm run test**: NEVER CANCEL - takes 5 seconds, set timeout to 60+ seconds (includes external API calls)
- **npm run package**: NEVER CANCEL - takes 6-8 seconds, set timeout to 30+ seconds
- **npm run bundle**: NEVER CANCEL - takes 7-8 seconds, set timeout to 45+ seconds

### Linting and Formatting
- Uses **Biome** (not Prettier or ESLint) for TypeScript linting and formatting
- Configuration in `biome.json`
- Always run `npm run check:fix` before committing
- Super Linter runs in CI but defers TypeScript formatting to Biome

### Testing Framework
- Uses **Vitest** for testing with TypeScript support
- Configuration in `vitest.config.ts`
- Tests include both unit tests and integration tests with real GitHub API calls
- Coverage reporting with V8 provider
- Path aliases configured: `@/` points to `src/`, `@/tests/` to `__tests__/`

### Known Limitations
- Some tests require `GITHUB_TOKEN` environment variable - they will be skipped with clear messages if not provided
- Some tests require internet access to download terraform-docs binary
- Tests that fail due to missing terraform-docs binary are expected in offline environments
- The action is designed to run in GitHub Actions environment with appropriate permissions

### Troubleshooting
- If terraform-docs tests fail with "Could not resolve host": This is expected without internet access
- If API tests fail with "GITHUB_TOKEN environment variable must be set": Provide a valid GitHub token or skip integration tests
- If build fails: Ensure Node.js 22 is installed (specified in `.node-version`)
- If linting fails: Run `npm run check:fix` to auto-fix formatting issues