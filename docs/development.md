# Development Guide

This document covers the development environment, workflow, CI/CD pipeline, and release process for the Terraform Module
Releaser project.

## Development Environment

### DevContainer (Recommended)

The repository includes a pre-configured devcontainer with:

- **Base image**: `mcr.microsoft.com/devcontainers/typescript-node:24` (Node.js 24)
- **Named volume**: `node_modules` volume persists across container rebuilds
- **Post-create script**: Sets Git safe directory, fixes node_modules ownership, runs `npm install`
- **Visual Studio Code extensions**: Biome, Prettier, GitHub Actions, Markdown tools, GitHub PR extension
- **Formatting config**: Biome as default formatter for TS/JS/JSON; Prettier for markdown/YAML
- **Environment**: `GITHUB_TOKEN` forwarded from host automatically

### Manual Setup

1. Install Node.js 24+ (see `.node-version`)
2. Run `npm ci --no-fund`
3. Export `GITHUB_TOKEN` for integration tests

## Development Workflow

### Making Changes

1. Create a feature branch from `main`
2. Make changes in `src/`
3. Add or update tests in `__tests__/`
4. Run validation:

```bash
npm run check:fix       # Biome lint/format + Prettier (md/yml)
npm run textlint:fix    # Prose linting for markdown
npm run typecheck       # TypeScript strict compilation check
npm run test            # Full test suite with coverage
```

5. Commit using Conventional Commits format

### Conventional Commits

All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

| Prefix | Purpose | Example |
| --- | --- | --- |
| `feat:` | New feature | `feat: add SSH source format option` |
| `fix:` | Bugfix | `fix: handle empty module directory` |
| `chore:` | Maintenance | `chore: update dependencies` |
| `docs:` | Documentation | `docs: improve wiki generation guide` |
| `refactor:` | Code restructuring | `refactor: simplify tag normalization` |
| `test:` | Test changes | `test: add coverage for edge cases` |

## Tooling

### Biome (Linting & Formatting)

- Handles all TS/JS/JSON formatting and linting
- Config: `biome.json`
- NOT ESLint or Prettier for TypeScript/JavaScript
- 120-char line width, 2-space indent, LF endings, single quotes, trailing commas, semicolons

### Prettier (Markdown & YAML only)

- Only used for `.md` and `.yml` files
- Config: `prettier` key in `package.json`
- 120-char print width for Markdown, prose wrap enabled

### Textlint (Prose Linting)

- Lints Markdown prose for terminology and style
- Config: `.github/linters/.textlintrc`
- Run: `npm run textlint:fix`

### TypeScript

- Strict mode with all strict checks enabled
- Target: ECMAScript 2022, Module: ECMAScript 2022, ModuleResolution: bundler
- Path aliases configured in `tsconfig.json` and `vitest.config.ts`
- Type-check only: `npm run typecheck` (uses `--noEmit`)

## CI/CD Pipeline

### Pull Request Workflows

When a PR is opened or updated against `main`, these workflows run:

| Workflow | File | Purpose |
| --- | --- | --- |
| **CI** | `ci.yml` | Builds the action (`npm run package`), runs it against the repository (`uses: ./`) |
| **Test** | `test.yml` | Runs Vitest suite (`npm run test`), then SonarQube coverage analysis |
| **Lint** | `lint.yml` | Biome check (`npm run check`) + GitHub Super-Linter |
| **CodeQL** | `codeql-analysis.yml` | Security analysis for TypeScript |

### Release Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| **Release Start** | `release-start.yml` | Manual dispatch | Validates version, bumps package.json, builds, generates AI changelog, creates release PR |
| **Check Dist** | `check-dist.yml` | Release PR | Verifies `dist/` matches `npm run package` output |
| **Release** | `release.yml` | Release PR merged | Creates Git tag + GitHub release with notes |

### Release Process

1. Maintainer manually triggers **Release Start** workflow with a version number
2. Workflow: validates version → bumps package.json → runs build + tests → generates changelog (via OpenAI in
   `scripts/changelog.js`) → creates PR titled `chore(release): vX.Y.Z`
3. The release PR triggers all standard CI workflows
4. After review and merge, **Release** workflow creates the Git tag and GitHub release

> **Important**: Contributors should never manually create releases, modify `dist/`, or check in bundle artifacts.

## Build

### Package for Distribution

```bash
npm run package     # Build dist/ via @vercel/ncc
```

This bundles `src/index.ts` and all dependencies into `dist/index.js` (single file) with source maps. The `dist/`
directory is only committed during the automated release process.

### Action Runtime

- `action.yml` specifies `node20` as the runtime
- The action runs on GitHub Actions runners (Ubuntu) with Node.js 20+
- Entry point: `dist/index.js`

## Key Scripts

| Script | Command | Purpose |
| --- | --- | --- |
| `check` | `biome check . && prettier -c ...` | Lint check (no changes) |
| `check:fix` | `biome check --write --unsafe . && prettier -w ...` | Autofix linting issues |
| `textlint` | `textlint -c ... **/*.md` | Check Markdown prose |
| `textlint:fix` | `textlint --fix ...` | Fix Markdown prose |
| `typecheck` | `tsc --noEmit` | TypeScript type checking |
| `test` | `vitest run --coverage` | Full test suite with coverage |
| `test:watch` | `vitest` | Watch mode for development |
| `package` | `ncc build src/index.ts -o dist` | Build distribution bundle |
| `coverage` | `make-coverage-badge --output-path ...` | Generate coverage badge SVG |
