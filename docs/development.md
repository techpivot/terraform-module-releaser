# Development Guide

This document covers the development environment, workflow, CI/CD pipeline, and release process for the Terraform Module
Releaser project.

## Development Environment

### DevContainer (Recommended)

The repository includes a pre-configured devcontainer with:

- **Image**: `mcr.microsoft.com/devcontainers/javascript-node:24-trixie` — Node baked into the image (no node feature;
  see [node.md](node.md) for why re-adding it is a silent failure mode)
- **Named volumes**: `node_modules` and the npm cache (`~/.npm`) persist across container rebuilds, so
  `npm ci --prefer-offline` rebuilds fast without re-downloading packages
- **Post-create script**: Sets Git safe directory, fixes volume ownership, runs `npm ci`
- **Visual Studio Code extensions**: Biome, Prettier, GitHub Actions, Markdown tools, GitHub PR extension
- **Formatting config**: Biome as default formatter for TS/JS/JSON; Prettier for markdown/YAML
- **Environment**: `GITHUB_TOKEN` forwarded from host automatically

### Manual Setup

1. Install the Node.js version pinned in `.node-version`; anything satisfying `engines.node` also works (see
   [node.md](node.md) for the version policy)
2. Run `npm ci --no-fund`
3. Export `GITHUB_TOKEN` for integration tests

## Development Workflow

### Making Changes

1. Create a feature branch from `main`
2. Make changes in `src/`
3. Add or update tests in `__tests__/`
4. Run validation:

   ```bash
   npm run fix             # Format everything, then autofix code and prose
   npm run lint            # All linters (code, types, prose, workflows)
   npm run test            # Full test suite with coverage
   ```

5. Commit using Conventional Commits format

### Conventional Commits

All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

| Prefix      | Purpose            | Example                                |
| ----------- | ------------------ | -------------------------------------- |
| `feat:`     | New feature        | `feat: add SSH source format option`   |
| `fix:`      | Bugfix             | `fix: handle empty module directory`   |
| `chore:`    | Maintenance        | `chore: update dependencies`           |
| `docs:`     | Documentation      | `docs: improve wiki generation guide`  |
| `refactor:` | Code restructuring | `refactor: simplify tag normalization` |
| `test:`     | Test changes       | `test: add coverage for edge cases`    |

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
- Run: `npm run lint:text` (or `npm run lint:text:fix` to autofix)

### TypeScript

- Strict mode with all strict checks enabled
- Target: ECMAScript 2024, Module: ECMAScript 2022, ModuleResolution: bundler — the target is bounded by the GitHub
  Actions runtime, not local Node (see [node.md](node.md))
- Path aliases configured in `tsconfig.json` and `vitest.config.ts`
- Type-check only: `npm run lint:types` (uses `--noEmit`)

> [!IMPORTANT] **TypeScript is frozen on 6.x.** TypeScript 7 ships no stable programmatic API — its main entry resolves
> to `lib/version.cjs`, which exports only `{version, versionMajorMinor}`, and the compiler API moved behind
> `./unstable/*`. [`@vercel/ncc`](https://github.com/vercel/ncc) bundles `ts-loader`, which calls `ts.sys.fileExists`,
> so `npm run package` fails with `Cannot read properties of undefined (reading 'fileExists')`. Tracked upstream as
> [vercel/ncc#1336](https://github.com/vercel/ncc/issues/1336) (open, `help wanted`).
>
> The trap is that nothing else catches it: `tsc --noEmit` and Vitest's typecheck both invoke the **CLI**, which works
> fine under 7.x — only the bundler consumes the API. **Always run `npm run package` when changing the TypeScript
> major.** Dependabot is configured to ignore `typescript` majors (`.github/dependabot.yml`); unfreeze only once the
> upstream issue closes and `npm run package` succeeds.

## CI/CD Pipeline

### Pull Request Workflows

When a PR is opened or updated against `main`, these workflows run:

| Workflow   | File         | Purpose                                                                            |
| ---------- | ------------ | ---------------------------------------------------------------------------------- |
| **CI**     | `ci.yml`     | Builds the action (`npm run package`), runs it against the repository (`uses: ./`) |
| **Test**   | `test.yml`   | Runs Vitest suite (`npm run test`), then SonarQube coverage analysis               |
| **Lint**   | `lint.yml`   | `npm run format:check` + `npm run lint`, then a CI-only gitleaks secret scan       |
| **CodeQL** | `codeql.yml` | Security analysis for TypeScript                                                   |

### Release Workflows

| Workflow          | File                | Trigger           | Purpose                                                                                   |
| ----------------- | ------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| **Release Start** | `release-start.yml` | Manual dispatch   | Validates version, bumps package.json, builds, generates AI changelog, creates release PR |
| **Check Dist**    | `check-dist.yml`    | Release PR        | Verifies `dist/` matches `npm run package` output                                         |
| **Release**       | `release.yml`       | Release PR merged | Creates Git tag + GitHub release with notes                                               |

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

- `action.yml` specifies `node24` as the runtime
- The action runs on GitHub Actions runners (Ubuntu) with Node.js 24+
- Entry point: `dist/index.js`

## Key Scripts

Names follow the [ESLint package.json conventions](https://eslint.org/docs/latest/contribute/package-json-conventions):
`lint*` analyzes, `format*` rewrites, `:fix` applies corrections, `:check` never mutates.

| Script          | Command                                      | Purpose                           |
| --------------- | -------------------------------------------- | --------------------------------- |
| `format`        | `biome format --write . && prettier -w ...`  | Rewrite files to match style      |
| `format:check`  | `biome format . && prettier -c ...`          | Verify formatting, change nothing |
| `fix`           | `format` + `lint:code:fix` + `lint:text:fix` | Every available autofix           |
| `lint`          | all `lint:*` below                           | Every linter                      |
| `lint:code`     | `biome lint .`                               | TS/JS/JSON static analysis        |
| `lint:code:fix` | `biome lint --write .`                       | Autofix code lint findings        |
| `lint:types`    | `tsc --noEmit`                               | TypeScript type checking          |
| `lint:text`     | `textlint -c ... <md>`                       | Markdown prose/terminology        |
| `lint:text:fix` | `textlint --fix ...`                         | Fix Markdown prose                |
| `lint:actions`  | `external-linter.mjs actionlint`             | Workflow correctness              |
| `test`          | `vitest run --coverage`                      | Full test suite with coverage     |
| `test:watch`    | `vitest`                                     | Watch mode for development        |
| `package`       | `ncc build src/index.ts -o dist`             | Build distribution bundle         |
| `coverage`      | `make-coverage-badge --output-path ...`      | Generate coverage badge SVG       |

`lint:actions` shells out to actionlint, a Go binary with no first-party npm package. A missing binary is skipped
locally with an install hint (`brew install actionlint`) so `npm run lint` works straight after `npm ci`; in CI the same
wrapper turns it into a hard failure, and `lint.yml` installs it.

### Secret scanning

[gitleaks](https://github.com/gitleaks/gitleaks) runs as a CI-only step in `lint.yml`, not as part of `npm run lint` —
contributors never need the binary. Two deliberate choices:

- **The CLI, not `gitleaks-action`.** The action gates on a `GITLEAKS_LICENSE` for organization-owned repositories and
  checks it _before_ scanning. Secrets are never exposed to workflows triggered from forked pull requests, so that gate
  fails every external contribution with an error the contributor cannot fix. The CLI needs no license.
- **`gitleaks dir .`, scanning the whole working tree.** The action scans only a pull request's own commit range, so a
  secret already on `main` would stop being reported. Scanning the tree keeps CI red until it is removed.

Exclusions live in `.gitleaks.toml`, which currently allowlists `dist/` — the generated ncc bundle inlines dependency
JSDoc, including an `@actions/core` example that reads as an API key.
