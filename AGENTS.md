# Agent Instructions — Terraform Module Releaser

> This file is the canonical instruction source for all AI coding agents (GitHub Copilot, Claude Code, etc.).

A GitHub Action (TypeScript, strict mode) that automates versioning, releases, and wiki documentation for Terraform
modules in monorepos. Creates module-specific Git tags, GitHub releases, PR comments, and comprehensive wiki
documentation.

## Quick Reference

```bash
npm run check:fix       # Biome lint/format + Prettier (md/yml) — run before every commit
npm run textlint:fix    # Prose linting for markdown files
npm run typecheck       # TypeScript strict compilation check
npm run test            # Full Vitest test suite with V8 coverage (requires GITHUB_TOKEN)
npm run test:watch      # Watch mode for development
npm run package         # Build dist/ via ncc (auto-generated, never edit manually)
npm run update-deps     # Upgrade all dependencies within package.json ranges
```

## Tech Stack

- **TypeScript 5.9+** strict mode, ES modules (`"type": "module"` in package.json)
- **Node.js 26+** local dev (see `.node-version`); compiled output targets Node.js 24 for the Actions runtime
- **Vitest** for testing with V8 coverage
- **Biome** for linting/formatting — NOT ESLint/Prettier (except Prettier for Markdown/YAML only)
- **@actions/core** + **@octokit** for GitHub integration
- **minimatch** for glob pattern matching, **p-limit** for concurrency control

## Versioning

There are four separate Node.js version references in this repository. Each serves a distinct purpose. Always keep them
consistent and update them together when bumping.

| File                              | Current value     | Purpose                                                                                                                                                                                                           |
| --------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.node-version`                   | `26`              | Pins the local developer runtime. Read by nvm/fnm and by `node-version-file:` in all CI workflows. This is the version used for development, testing, and building.                                               |
| `.devcontainer/devcontainer.json` | `"version": "26"` | Devcontainer Node feature installs this version in the container. **Must always match `.node-version`.** Also sets the container `"name"` label for clarity.                                                      |
| `package.json` → `engines.node`   | `">=24"`          | **Locked at Node 24 support.** Declares the minimum required runtime to prevent Node 25/26 APIs from polluting compilation types, ensuring backward compatibility with consumer runtimes.                         |
| `action.yml` → `using:`           | `node24`          | **GitHub Actions production runtime.** This is the Node version GitHub uses to execute `dist/index.js` in consumer workflows. GitHub only supports `node20` and `node24` — do not change without a major release. |

### Bumping the local dev Node version

When upgrading the local Node version (`.node-version` / devcontainer):

1. Research latest stable Node LTS or current release at <https://nodejs.org/en/download/releases>
2. Update `.node-version` and `.devcontainer/devcontainer.json` (`name` label + feature `version`) together. **Do not
   bump `package.json` `engines.node` past `>=24`** unless raising the baseline runner version.
3. Update all documentation references (this file, `CONTRIBUTING.md`, `docs/development.md`)
4. Run `npm run update-deps` to verify all packages are compatible with the new engine
5. Run the full test suite (`npm test`) before committing

### Bumping the GitHub Actions runtime (`action.yml`)

This is a **breaking change for all consumers** and requires a new major version release:

1. Check GitHub's supported runtimes:
   <https://docs.github.com/en/actions/creating-actions/metadata-syntax-for-github-actions#runs-for-javascript-actions>
2. Verify the compiled `dist/` output is valid ECMAScript for the target runtime — review `tsconfig.json` `target` and
   `lib` fields and adjust if needed
3. Bump the action major version, tag a release, and announce in release notes
4. Update `action.yml` `using:` and all documentation references

## Environment

- **GITHUB_TOKEN** required for integration tests — tests skip gracefully without it; the devcontainer forwards it
  automatically from the host
- Path aliases: `@/` → `src/`, `@/tests/` → `__tests__/`, `@/mocks/` → `__mocks__/`

```bash
export GITHUB_TOKEN="ghp_your_token_here"
```

## Project Layout

```
src/                        # TypeScript source (ES modules)
├── index.ts                # Entry point → calls run() from main.ts
├── main.ts                 # Orchestrator: init → parse → release/comment
├── config.ts               # Singleton config (reads action inputs via Proxy)
├── context.ts              # Singleton context (repo, PR, Octokit via Proxy)
├── parser.ts               # Discovers Terraform modules, maps commits → modules
├── terraform-module.ts     # Central domain model (TerraformModule class)
├── commit-analyzer.ts      # Commit message analysis (keywords & conventional commits)
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
├── context.ts              # Proxy-based mock context with .set()/.resetDefaults()
└── @actions/core.ts        # Silenced logging, real getInput/getBooleanInput
tf-modules/                 # Example Terraform modules for integration tests
dist/                       # Compiled output (auto-generated, never edit manually)
docs/                       # Detailed documentation for humans and AI agents
```

## Architecture Essentials

The action runs on `pull_request` events with two flows:

1. **PR open/sync** → Parse modules → Post release plan comment → Check wiki status
2. **PR merged** → Create tagged releases → Post release comment → Clean up orphaned tags → Generate wiki

Key patterns:

- **Proxy singletons**: `config` and `context` use `Proxy` for lazy init — import at module scope safely; both expose
  `clearForTesting()`
- **Config before Context**: Config must initialize first (Context needs `config.githubToken` for Octokit auth)
- **Idempotency**: Hidden HTML comment marker in post-release PR comments prevents duplicate releases on re-runs
- **Effective change detection**: Commits that modify then revert a file within the same PR are excluded
- **Tag normalization**: All separator chars (`-`, `_`, `/`, `.`) normalized before tag-to-module matching
- **Wiki Unicode slugs**: `/` → `∕` (U+2215), `-` → `‒` (U+2012) in wiki page names (GitHub Wiki breaks otherwise)
- **Pure utilities**: `src/utils/` files must be pure — take all dependencies as parameters, no singleton imports.
  Service-layer files (`wiki.ts`, `releases.ts`, etc.) may use singletons and pass values down.
- **Naming conventions**: `get*` accessors/lookups · `generate*` producers that may do I/O · `render*` template/string
  assembly

## Code Conventions

- Naming: `camelCase` (functions/vars), `PascalCase` (types), `UPPER_SNAKE_CASE` (constants)
- All types/interfaces in `src/types/` — define in `*.types.ts`, re-export via `src/types/index.ts`
- All constants in `src/utils/constants.ts`
- Formatting: Biome for TS/JS/JSON; Prettier for Markdown/YAML only
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`)

## Rules

**Always:**

- Run `npm run check:fix` and `npm run textlint:fix` before committing
- Add/update tests for all code changes
- Follow TypeScript strict mode; use existing patterns
- When adding/removing/changing inputs in `action.yml`, update `src/utils/metadata.ts` (`ACTION_INPUTS`) and
  `__tests__/utils/metadata.test.ts` in the same change; also update the input table and config example in `README.md`
- For third-party Actions in `uses:` steps, pin to a full commit SHA with an adjacent `# vX.Y.Z` comment; resolve the
  SHA by fetching all upstream tags and selecting the latest semantic version

**Never:**

- Modify `dist/` manually or check in bundle artifacts (handled by release automation)
- Bypass TypeScript strict checks
- Commit without running lint/tests

**Ask first:**

- Adding new dependencies
- Changing build config or tsconfig targets
- Modifying GitHub Actions workflows

## Detailed Documentation

Before making significant changes, read the relevant docs:

- `docs/architecture.md` — Execution flow, module relationships, design decisions
- `docs/testing.md` — Test patterns, mock strategy, writing new tests
- `docs/development.md` — Development workflow, CI/CD, release process

## Built-in Chat Agents

- `.github/agents/implementation-planner.agent.md` — Creates implementation plans and task breakdowns
- `.github/agents/test-specialist.agent.md` — Focuses on test design, coverage, and mock usage
- `.github/agents/pr-writer.agent.md` — Generates Markdown PR title/description from branch commits

### PR Writer Agent Usage

Use the PR writer agent when preparing pull requests, especially for branches with many commits.

- Input: Ask for a PR title and description from current branch commits
- Output: Markdown-only result with a Conventional Commit PR title and reviewer-friendly summary sections
- Regeneration: Re-run after new commits are pushed to refresh content
