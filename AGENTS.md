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

Four Node.js version references must stay consistent. See the **`npm-versioning` skill**
(`.claude/skills/npm-versioning/SKILL.md`) for upgrade protocols and rules.

| File                              | Value             | Purpose                                                        |
| --------------------------------- | ----------------- | -------------------------------------------------------------- |
| `.node-version`                   | `26`              | Local dev runtime (nvm/fnm + CI `node-version-file:`)          |
| `.devcontainer/devcontainer.json` | `"version": "26"` | Devcontainer feature — **must match `.node-version`**          |
| `package.json` → `engines.node`   | `">=24"`          | Locked at Node 24; prevents post-24 API type bleed             |
| `action.yml` → `using:`           | `node24`          | GHA production runtime — do not change without a major release |

## Environment

- **GITHUB_TOKEN** required for integration tests — tests skip gracefully without it; the devcontainer forwards it
  automatically from the host
- Path aliases: `@/` → `src/`, `@/tests/` → `__tests__/`, `@/mocks/` → `__mocks__/`

```bash
export GITHUB_TOKEN="ghp_your_token_here"
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
- **Pure utilities**: `src/utils/` files must be pure — avoid importing the `config`/`context` singletons; pass required
  values as parameters. Service-layer files (`wiki.ts`, `releases.ts`, etc.) may use singletons and pass values down.
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
- `.github/agents/pr-writer.agent.md` — Generates a Conventional Commit PR title and reviewer-friendly description from
  branch commits; re-run after new commits
