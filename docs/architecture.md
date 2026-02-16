# Architecture

This document describes the architecture of the Terraform Module Releaser GitHub Action.

## Execution Flow

The action is triggered by `pull_request` events and has two distinct flows:

### Entry Point

`src/index.ts` → calls `run()` from `src/main.ts`

### Initialization Phase

1. **`getConfig()`** — Reads all GitHub Action inputs via `@actions/core.getInput()`, validates them, and caches in a
   singleton. Uses a `Proxy` wrapper so imports at module scope don't trigger initialization until first property
   access.
2. **`getContext()`** — Reads GitHub environment variables (`GITHUB_REPOSITORY`, `GITHUB_EVENT_NAME`, etc.), parses the
   PR event payload, and creates an authenticated Octokit client using `config.githubToken`.

> **Critical**: Config must initialize before Context because Context reads `config.githubToken` for Octokit auth.

### Data Gathering Phase

Runs in parallel after initialization:

- **`getPullRequestCommits()`** — Fetches PR commits via Octokit, then cross-references with PR changed files to
  implement "effective change detection" (commits that modify then revert a file are excluded)
- **`getAllTags()`** — Paginated fetch of all repository tags
- **`getAllReleases()`** — Paginated fetch of all repository releases

### Module Parsing Phase (`parseTerraformModules()`)

Three-phase discovery in `src/parser.ts`:

1. **Discover** — Recursively find all directories containing `.tf` files in the workspace, filtering out paths matching
   `module-path-ignore` patterns
2. **Instantiate** — Create a `TerraformModule` instance per discovered directory, associating matching tags and
   releases
3. **Map commits** — Analyze each commit's changed files to determine which modules are affected

### Event Handling

After parsing, the flow branches on event type:

#### PR Open/Synchronize

`handlePullRequestEvent()`:

1. Check wiki status (clone wiki repository, test connectivity)
2. Post release plan comment — Rich Markdown table showing:
   - Modules with changes and their next version
   - Modules without changes
   - Tags/releases to be cleaned up (orphaned from deleted modules)
   - Wiki status indicator

#### PR Merged

`handlePullRequestMergedEvent()`:

1. **Idempotency check** — `hasReleaseComment()` looks for a hidden HTML comment marker in existing PR comments. If
   found, exits early (prevents duplicate releases on workflow re-runs)
2. **Create tagged releases** — For each module needing release:
   - Copy module files to temp directory (excluding configured patterns)
   - Copy `.git` directory
   - Create new commit + tag in temp directory
   - Push tag to remote
   - Create GitHub release via API with changelog body
3. **Post release comment** — Summary of created releases with marker for idempotency
4. **Delete legacy tags/releases** — Remove orphaned tags from deleted modules (if `delete-legacy-tags` is enabled)
5. **Generate wiki** — Clone wiki repository, generate/update all module pages, push changes

### Action Outputs

Six outputs are set via `core.setOutput()` before the merge/release operation:

| Output                 | Type        | Description                                                         |
| ---------------------- | ----------- | ------------------------------------------------------------------- |
| `changed-module-names` | JSON array  | Module names changed in the PR                                      |
| `changed-module-paths` | JSON array  | File system paths to changed modules                                |
| `changed-modules-map`  | JSON object | Module names → change details (current tag, next tag, release type) |
| `all-module-names`     | JSON array  | All discovered module names                                         |
| `all-module-paths`     | JSON array  | All discovered module paths                                         |
| `all-modules-map`      | JSON object | All module names → details (path, latest tag, version)              |

> **Note**: Outputs are set before `clearCommits()` is called during release, since `needsRelease()` checks commit
> presence.

## Core Modules

### `TerraformModule` (Domain Model)

File: `src/terraform-module.ts`

The central data structure, combining state and behavior:

- **State**: directory, name, commits, tags, releases
- **Computed**: `needsRelease()`, `getReleaseType()` (keyword scanning), `getReleaseTag()`, `getReleaseTagVersion()`
- **Static utilities**: Tag/release association, orphan detection, module name normalization

Key behaviors:

- `getReleaseType()` scans commit messages against major/minor/patch keywords from config
- `getReleaseTag()` constructs the next tag using the configured separator and version prefix
- Tag association normalizes all separators (`-`, `_`, `/`, `.`) to a common character before comparison
- Tags and releases are stored sorted by SemVer (not lexicographically)

### Config Singleton (`src/config.ts`)

- Reads GitHub Action inputs via `@actions/core.getInput()` and `getBooleanInput()`
- Validates: tag separator (must be `/`, `-`, `_`, or `.`), SemVer level, module ref mode
- Exposes `getConfig()` for direct access and `config` (Proxy) for ergonomic module-scope imports
- `clearForTesting()` resets the cached instance

### Context Singleton (`src/context.ts`)

- Reads: `GITHUB_REPOSITORY`, `GITHUB_EVENT_NAME`, `GITHUB_EVENT_PATH`, `GITHUB_WORKSPACE`, `GITHUB_SERVER_URL`
- Parses PR event payload from `GITHUB_EVENT_PATH` JSON file
- Creates authenticated Octokit client with paginate + REST plugins
- Exposes `getContext()` and `context` (Proxy)
- `clearForTesting()` resets

### Parser (`src/parser.ts`)

- `parseTerraformModules(commits, tags, releases)` — Main entry point
- Uses `findTerraformModuleDirectories()` for recursive `.tf` file discovery
- Applies `module-path-ignore` patterns via minimatch
- Deduplicates commits to modules (a commit may touch files in multiple modules)

### Release Creation (`src/releases.ts`)

- `createTaggedReleases()` — Per module:
  1. Copy module contents to temp dir (respecting `module-asset-exclude-patterns`)
  2. Copy `.git` directory
  3. Configure Git authentication (HTTP extraheader with base64-encoded token)
  4. Commit + tag + push
  5. Create GitHub release via `octokit.rest.repos.createRelease()`
- Tags point to commits containing only the module's files (clean release artifacts)

### Wiki Generation (`src/wiki.ts`)

- Full lifecycle: checkout → generate → commit → push
- Module pages include: Usage (templated), Attributes (terraform-docs output), Changelog
- Sidebar: Grouped by module with recent changelog entries
- Uses `p-limit` for concurrency control during parallel page generation
- Unicode slug substitution for GitHub Wiki compatibility

## Key Design Patterns

### Proxy-Based Lazy Singletons

Both `config` and `context` use this pattern:

```typescript
let instance: Config | undefined;
export const config = new Proxy({} as Config, {
  get: (_, prop) => {
    if (!instance) instance = getConfig();
    return instance[prop];
  },
});
```

Benefits: Import at module scope without triggering initialization. Test-friendly via `clearForTesting()`.

### Effective Change Detection

The action filters commits to exclude "phantom" changes — when a file is modified and then reverted within the same PR.
This prevents unnecessary version bumps from commits that have no net effect on a module.

### Idempotency via PR Comments

A hidden HTML comment (`<!-- techpivot/terraform-module-releaser — release-marker -->`) is embedded in post-release
comments. On re-runs, `hasReleaseComment()` checks for this marker and exits early if found.

### Tag Normalization

`TerraformModule.isModuleAssociatedWithTag()` normalizes all valid separators to a common character before comparison.
This handles repositories that may have changed their tagging scheme over time (e.g., from `/` to `-`).

### Wiki Unicode Slugs

GitHub Wiki can't handle `/` or `-` in page filenames without breaking navigation. The action replaces these with
Unicode lookalikes:

- `/` → `∕` (U+2215, DIVISION SLASH)
- `-` → `‒` (U+2012, FIGURE DASH)

These substitutions are defined in `WIKI_TITLE_REPLACEMENTS` in `src/utils/constants.ts`.

## Module Dependency Graph

```
index.ts
  └── main.ts
        ├── config.ts          (singleton, reads action inputs)
        ├── context.ts         (singleton, creates Octokit)
        ├── parser.ts          (discovers modules)
        │     ├── terraform-module.ts  (domain model)
        │     └── utils/file.ts        (filesystem discovery)
        ├── tags.ts            (CRUD operations)
        ├── releases.ts        (create releases, push tags)
        │     └── utils/github.ts      (git auth, bot email)
        ├── pull-request.ts    (PR comments, commit fetching)
        ├── changelog.ts       (changelog generation)
        ├── wiki.ts            (wiki lifecycle)
        │     ├── terraform-docs.ts    (binary install + exec)
        │     └── utils/string.ts      (template rendering)
        └── utils/constants.ts (shared constants)
```

## Configuration

All action inputs are defined in `action.yml` and mapped in `src/utils/metadata.ts`. The `ACTION_INPUTS` constant
provides type-safe metadata for each input, used by `createConfigFromInputs()` to dynamically build the config object.
