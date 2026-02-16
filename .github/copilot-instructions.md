# Terraform Module Releaser

A GitHub Action (TypeScript) that automates versioning, releases, and documentation for Terraform modules in monorepos.
Creates module-specific Git tags, GitHub releases, PR comments, and comprehensive wiki documentation.

For detailed architecture, testing patterns, and design context, see the `docs/` folder.

## Tech Stack

- **TypeScript 5.9+** strict mode, ES modules (`"type": "module"` in package.json)
- **Node.js 24+** local dev (`.node-version`); compiles to Node.js 20+ for GitHub Actions runtime (`action.yml` →
  `node20`)
- **Vitest** for testing with V8 coverage
- **Biome** for linting/formatting — NOT ESLint/Prettier (except Prettier for Markdown/YAML only)
- **@actions/core** + **@octokit** for GitHub integration
- **minimatch** for glob pattern matching, **p-limit** for concurrency control

## Commands — Run Before Every Commit

```bash
npm run check:fix       # Biome lint/format + Prettier for md/yml
npm run textlint:fix    # Prose linting for markdown
npm run typecheck       # TypeScript strict compilation check
npm run test            # Full Vitest suite with coverage (requires GITHUB_TOKEN)
```

Additional commands: `npm run test:watch` (dev mode), `npm run package` (build dist/).

## GITHUB_TOKEN

Integration tests require a valid GitHub token. Tests without it are automatically skipped.

```bash
export GITHUB_TOKEN="ghp_your_token_here"
```

The devcontainer forwards `GITHUB_TOKEN` from the host automatically.

## Project Layout

```
src/                        # TypeScript source (ES modules)
├── index.ts                # Entry point → calls run() from main.ts
├── main.ts                 # Orchestrator: init → parse → release/comment
├── config.ts               # Singleton config (reads action inputs via Proxy)
├── context.ts              # Singleton context (repo, PR, Octokit via Proxy)
├── parser.ts               # Discovers Terraform modules, maps commits → modules
├── terraform-module.ts     # Central domain model (TerraformModule class)
├── tags.ts                 # Git tag CRUD operations
├── releases.ts             # GitHub release creation, tag pushing
├── pull-request.ts         # PR comment management, commit fetching
├── changelog.ts            # Changelog generation (per-module and aggregated)
├── wiki.ts                 # Wiki generation lifecycle (clone, generate, push)
├── terraform-docs.ts       # terraform-docs binary install and execution
├── types/                  # TypeScript type definitions
└── utils/                  # Constants, file ops, GitHub helpers, string utils
__tests__/                  # Tests mirror src/ structure
├── _setup.ts               # Global test setup (mocks config/context/@actions/core)
├── helpers/                # Test utilities (mock factories, Octokit stubs)
├── fixtures/               # Wiki fixture files (use Unicode slug chars)
└── utils/                  # Utility function tests
__mocks__/                  # Vitest module mocks
├── config.ts               # Proxy-based mock config with .set()/.resetDefaults()
├── context.ts              # Proxy-based mock context with .set()/.reset()
└── @actions/core.ts        # Silenced logging, real getInput/getBooleanInput
tf-modules/                 # Example Terraform modules for integration tests
dist/                       # Compiled output (auto-generated, never edit manually)
docs/                       # Detailed documentation for humans and AI agents
```

## Architecture — Key Patterns

- **Proxy-based singletons**: `config` and `context` use `Proxy` for lazy initialization; import at module scope without
  triggering init until first property access. Both have `clearForTesting()` methods.
- **Config before Context**: Config must initialize first — Context reads `config.githubToken` for Octokit auth.
- **Idempotency**: A hidden HTML comment marker in post-release PR comments prevents duplicate releases on re-runs.
- **Effective change detection**: Commits that modify then revert a file within the same PR are excluded.
- **Tag normalization**: All separator chars (`-`, `_`, `/`, `.`) are normalized before tag-to-module matching.
- **Wiki Unicode slugs**: `/` and `-` in wiki page names are replaced with Unicode lookalikes (`∕` U+2215, `‒` U+2012)
  because GitHub Wiki breaks with those characters. Test fixtures use these chars in filenames.
- **Path aliases**: `@/` → `src/`, `@/tests/` → `__tests__/`, `@/mocks/` → `__mocks__/` (configured in tsconfig.json and
  vitest.config.ts).

## Code Standards

- **Functions/variables**: `camelCase` — **Types/interfaces**: `PascalCase` — **Constants**: `UPPER_SNAKE_CASE`
- Biome enforces all TS/JS formatting. Prettier handles Markdown/YAML only.
- Use Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`

## Boundaries

**Always**: Run `npm run check:fix` before committing. Add/update tests for all code changes. Follow TypeScript strict
mode. Use existing patterns.

**Ask first**: Adding new dependencies. Changing build config. Modifying GitHub Actions workflows.

**Never**: Commit without running lint/tests. Modify `dist/` manually. Bypass TypeScript strict checks. Check in bundle
artifacts (handled by release automation).
