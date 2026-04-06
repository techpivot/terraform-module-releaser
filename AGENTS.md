# Agent Instructions — Terraform Module Releaser

A GitHub Action (TypeScript, strict mode) that automates versioning, releases, and wiki documentation for Terraform
modules in monorepos.

## Quick Reference

```bash
npm run check:fix       # Biome lint/format + Prettier (md/yml) — run before every commit
npm run textlint:fix    # Prose linting for markdown files
npm run typecheck       # TypeScript strict compilation check
npm run test            # Full Vitest test suite with V8 coverage (requires GITHUB_TOKEN)
npm run test:watch      # Watch mode for development
npm run package         # Build dist/ via ncc (auto-generated, never edit manually)
```

## Environment

- **Node.js 25+** locally (`.node-version`); compiled output targets Node.js 24+ (`action.yml` → `node24`)
- **GITHUB_TOKEN** required for integration tests — tests skip gracefully without it
- Path aliases: `@/` → `src/`, `@/tests/` → `__tests__/`, `@/mocks/` → `__mocks__/`

## Project Structure

- `src/` — TypeScript source (ES modules). Entry: `index.ts` → `main.ts` orchestrator
- `src/types/` — Type definitions (`Config`, `Context`, `TerraformModule`, etc.)
- `src/utils/` — Constants, file ops, GitHub helpers, string utilities
- `__tests__/` — Tests mirror `src/` structure. Setup: `_setup.ts` (mocks config/context/core)
- `__tests__/helpers/` — Mock factories, Octokit stubs, test input helpers
- `__mocks__/` — Module-level Vitest mocks (config/context use Proxy pattern with `.set()`/`.resetDefaults()`)
- `tf-modules/` — Example Terraform modules for integration tests
- `docs/` — Detailed architecture, testing, and development documentation
- `dist/` — Auto-generated build output (never edit)

## Architecture Essentials

The action runs on `pull_request` events with two flows:

1. **PR open/sync** → Parse modules → Post release plan comment → Check wiki status
2. **PR merged** → Create tagged releases → Post release comment → Clean up orphaned tags → Generate wiki

Key patterns:

- **Proxy singletons**: `config` and `context` use `Proxy` for lazy init — import at module scope safely
- **Config before Context**: Config must initialize first (Context needs `config.githubToken`)
- **Idempotency**: Hidden HTML marker in PR comments prevents duplicate releases on re-runs
- **Wiki Unicode slugs**: `/` → `∕` (U+2215), `-` → `‒` (U+2012) in wiki page names
- **Tag normalization**: All separators (`-`, `_`, `/`, `.`) normalized for tag-to-module matching

## Code Conventions

- Naming: `camelCase` (functions/vars), `PascalCase` (types), `UPPER_SNAKE_CASE` (constants)
- All types/interfaces live in `src/types/` — define in `*.types.ts` files, re-export via `src/types/index.ts`
- All constants live in `src/utils/constants.ts`
- Formatting: Biome for TS/JS/JSON; Prettier for Markdown/YAML only
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`)

## Rules

- Always run `npm run check:fix` and `npm run textlint:fix` before committing
- Always add/update tests for code changes
- Never modify `dist/` manually or check in bundle artifacts
- Never bypass TypeScript strict checks
- Ask before adding new dependencies or changing build configuration

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
