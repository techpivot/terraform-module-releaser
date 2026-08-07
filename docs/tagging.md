# Tagging Strategy

This document describes how `terraform-module-releaser` creates, manages, and pushes Git tags and GitHub Releases for
Terraform modules in a monorepo. It is intended to give AI agents and contributors a precise mental model before
touching `src/releases.ts`, `src/tags.ts`, or anything related to the release pipeline.

## Overview

Every Terraform module in the monorepo gets its own **namespaced tag** (e.g., `aws/vpc/v1.2.0`) and a corresponding
**GitHub Release**. Tags are deliberately **tag-only** — they do not land on any branch — because each module release
contains only the files inside that module's directory. Putting these commits on a long-lived branch would pollute the
repo's branching model and mix unrelated module histories together.

## Key Files

| File                      | Role                                                                       |
| ------------------------- | -------------------------------------------------------------------------- |
| `src/releases.ts`         | `createTaggedReleases()` — the main release engine                         |
| `src/tags.ts`             | `getAllTags()`, `deleteTags()` — read/clean operations                     |
| `src/terraform-module.ts` | `TerraformModule` domain model, computes next tag/version                  |
| `src/utils/github.ts`     | `configureGitAuthentication()`, `getGitHubActionsBotEmail()`               |
| `src/utils/constants.ts`  | `GITHUB_ACTIONS_BOT_NAME`, `MODULE_TAG_REGEX`, tag separator constants     |
| `src/utils/file.ts`       | `copyModuleContents()` — excludes patterns before release commit           |
| `src/changelog.ts`        | `createTerraformModuleChangelog()` — release body generation               |
| `src/utils/markers.ts`    | `buildPrMarker()` / `matchesPrMarker()` — release + commit idempotency tie |

## Tag Naming Convention

A release tag takes the form:

```
<module-path><separator><version-prefix><semver>
```

Examples with default separator (`/`) and prefix (`v`):

```
aws/vpc/v1.0.0
aws/s3-bucket/v2.3.1
kms/v0.1.0
kms/examples/complete/v1.0.0
```

The separator is configurable via the `tag-directory-separator` input (`/`, `-`, `_`, or `.`). Version prefix is toggled
by `use-version-prefix`. Both affect `TerraformModule.getReleaseTag()` and `TerraformModule.getReleaseTagVersion()`.

### Tag-to-Module Matching (Normalization)

`TerraformModule.isModuleAssociatedWithTag()` normalizes **all** valid separator characters (`-`, `_`, `/`, `.`) to a
single canonical form before comparing a tag to a module path. This means tags created with one separator scheme are
still correctly attributed to their module even if the action's separator setting later changes.

The regular expression used is `MODULE_TAG_REGEX`:

```
/^(.+)([-_/.])(v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))$/
```

## Release Creation Flow (`createTaggedReleases`)

Before the per-module loop, a **legacy gate** runs: if the pull request was completed under a pre-marker version of the
action (its post-release comment uses `LEGACY_PR_RELEASE_COMMENT_MARKER`) and no release carries the current marker, the
function returns without releasing, preserving the old "don't double-release" behavior. Otherwise, for each module that
`needsRelease()` returns `true`, the action converges to the correct state:

- **Step 1 — already released for this PR?** A release body carries this PR's marker → skip (no bump, no create).
- **Step 1b — latest tag is ours and already released?** The tag's release commit carries this PR's marker but the
  release body no longer does (edited or regenerated notes) → skip.
- **Step 2 — orphan tag that is ours?** Searching tags without releases newest-first, the first one provably this PR's →
  recreate the release for that existing tag, no bump. Bounded by `MAX_ORPHAN_TAG_LOOKUPS`.
- **Step 3 — otherwise** → live-bump and perform the full release described below.

A tag that cannot be attributed to this pull request — one pushed by hand, predating adoption of this action, or left
behind by a different pull request that crashed after pushing — is **never** adopted. The run warns, bumps past it, and
leaves it for its owning pull request's re-run to heal.

The steps below detail **Step 3** (the bump path). See [state-management.md](state-management.md) for the full
idempotency/self-heal model. For each module released via Step 3, the action:

1. **Creates a temporary directory** (`mkdtempSync`) named after the module.
2. **Copies module files** into the temp dir using `copyModuleContents()`, respecting `module-asset-exclude-patterns`.
3. **Copies the primary `.git` directory** (`cpSync`) so the temp dir is a valid local Git repository with its own
   independent copy of the object database, separate from the checked-out workspace.
4. **Configures Git identity** (GitHub Actions bot name + dynamically fetched bot email via API).
5. **Configures HTTPS authentication** via `http.extraheader` (base64-encoded token) — same method used by the official
   `actions/checkout` action.
6. **Runs a sequence of Git commands** in the temp dir:
   ```
   git config --local user.name  "GitHub Actions"
   git config --local user.email "<id>+github-actions[bot]@users.noreply.github.com"
   git add .
   git commit -m "<releaseTag>\n\n<prTitle>\n\n<prBody>\n\n<hidden PR marker>"
   git tag <releaseTag>
   git push origin <releaseTag>
   ```
7. **Reads the commit SHA** via `git rev-parse HEAD` immediately after the push (the GitHub API for `createRelease` does
   not return the underlying commit SHA).
8. **Creates a GitHub Release** via `octokit.rest.repos.createRelease()` using the tag name and a fully rendered
   changelog body **with the hidden PR marker appended** (`buildPrMarker`), so subsequent re-runs detect that this
   module was already released for this pull request.
9. **Updates the in-memory `TerraformModule`** with the new release and tag objects, then calls `clearCommits()` to
   prevent re-releasing the same module in the same run.

### Why a Temp Dir?

The temp dir approach allows each module's release commit to contain **only that module's files**, not the entire
monorepo. This has real performance benefits for Terraform consumers — `terraform init` only downloads the tag's tree,
which is small and module-scoped, rather than a full monorepo snapshot.

### Why Branchless Release Commits?

The release commits are created on a detached `HEAD` in the temp clone. They have a parent commit (the workspace `HEAD`
at the time the `.git` directory is copied) but are reachable only via the pushed tag — no long-lived branch pointer is
ever created on the remote. This is intentional:

- **No branch pollution**: branches represent active development lines; release snapshots are not development.
- **Minimal trees**: each tag points to a commit whose tree contains only that module's files.
- **Git stores them correctly**: even though these commits are not reachable from any branch, Git object storage keeps
  the commit/tree/blob objects reachable from the tag ref; the tag itself is sufficient to fetch the full content.
- **Terraform works perfectly**: Terraform's Git source protocol resolves `?ref=<tag>` directly against the remote's
  advertised ref list. GitHub serves tags over the standard Git smart HTTP/SSH protocol. The Terraform CLI runs
  `git fetch` followed by `git checkout`, referencing the tag — this is entirely standard and functions without any
  branch being present.

## How Terraform Consumers Reference Tags

The action generates wiki usage blocks (customizable via `wiki-usage-template`) in the format:

```hcl
module "my_module" {
  source = "git::https://github.com/<owner>/<repo>.git//<module-path>?ref=<module-path>/v1.2.3"
}
```

Or, when `use-ssh-source-format: true`:

```hcl
module "my_module" {
  source = "git::ssh://git@github.com/<owner>/<repo>.git//<module-path>?ref=<module-path>/v1.2.3"
}
```

The `ref=` query parameter is the released tag name. Terraform's `git` source type passes this directly to
`git fetch --tags origin <ref>`, which resolves correctly as long as the tag exists in the remote. **The commit does not
need to be on any branch.**

An alternate `module-ref-mode: sha` is supported: the `ref=` value becomes the commit SHA instead of the tag name, which
further guarantees immutability even if someone force-pushes a tag.

## Tag Lifecycle: Orphan Cleanup

When modules are **deleted** from the monorepo, their orphaned tags and releases become stale. If
`delete-legacy-tags: true` is configured, the action:

1. Calls `TerraformModule.getTagsToDelete(allTags, terraformModules)` — finds tags that match `MODULE_TAG_REGEX` but
   have no corresponding module directory in the workspace.
2. Calls `TerraformModule.getReleasesToDelete(allReleases, terraformModules)` — finds releases whose tag names have no
   corresponding module directory in the workspace.
3. Calls `deleteTags()` (`src/tags.ts`) which issues `DELETE /repos/{owner}/{repo}/git/refs/tags/{tag}` per tag.
4. Calls `deleteReleases()` (`src/releases.ts`) which issues `DELETE /repos/{owner}/{repo}/releases/{id}` per release.

## Tag Fetching (`getAllTags`)

Uses `octokit.paginate.iterator` against `repos.listTags` with `per_page: 100`. Returns `GitHubTag[]` (name +
commitSHA). Tags are not sorted at fetch time — sorting happens in `TerraformModule` when associating tags to a module
(sorted by SemVer: major → minor → patch descending).

## Error Handling

- **403 on push**: A missing `contents: write` permission in the workflow YAML is detected by the error message and
  re-thrown with an actionable fix suggestion.
- **Other push failures**: Re-thrown with full status and message context.
- **Tag deletion 403**: Same pattern — detected by status code and re-thrown with the required permissions block.

## GitHub Actions Bot Identity

The bot email is resolved at runtime to handle both GitHub.com and GitHub Enterprise Server:

```
<user_id>+github-actions[bot]@users.noreply.github.com
```

`getGitHubActionsBotEmail()` calls `octokit.rest.users.getByUsername({ username: 'github-actions[bot]' })` to get the
numeric user ID, making this compatible with any GitHub server.

## Concurrency and Idempotency

- Releases are created **sequentially** (one module at a time) to avoid concurrent `git push` and GitHub API calls
  across modules. Each module gets its own temp dir and `.git` copy, but running releases in parallel would increase the
  risk of API rate limiting and add significant error-handling complexity with no meaningful throughput benefit.
- **Idempotency and self-healing on re-runs**: `createTaggedReleases()` is idempotent and self-healing **per module**.
  Each release we create embeds a hidden, schema-versioned marker tying it to the pull request — in both the release
  **body** and the release **commit message** (see `src/utils/markers.ts`). On a re-run the function skips modules
  already released for this PR, recreates a deleted release for an orphan tag **it can prove it created**, and otherwise
  live-bumps — so re-runs converge instead of over-bumping or double-releasing. There is **no blind early-exit for
  releases**; a legacy gate preserves the old "don't double-release" behavior for pull requests released by pre-marker
  versions of the action.
- **Destructive steps are gated on checkout freshness**: obsolete tag/release cleanup and wiki regeneration derive their
  "what should exist" set from the checked-out tree while comparing it against live tags, releases, and wiki pages. On a
  re-run of an older merged pull request that tree is stale, so both steps are skipped (with a warning) when the base
  branch has advanced past the pull request's merge commit. See `src/utils/freshness.ts`.
- See [state-management.md](state-management.md) for the full model, the provenance rules, the
  backward/forward-compatibility contract, and the concurrency analysis.

## Relationship to `TerraformModule`

`createTaggedReleases()` consumes `TerraformModule` instances but also **mutates** them:

- `module.setReleases([newRelease, ...module.releases])` — prepends the new release.
- `module.setTags([newTag, ...module.tags])` — prepends the new tag.
- `module.clearCommits()` — marks the module as no longer needing a release within the same run.

These mutations allow downstream code (e.g., action outputs, PR comment generation) to see the freshly released state
immediately, without re-fetching from the API.

## Relevant Tests

| Test file                            | Coverage focus                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `__tests__/releases.test.ts`         | `createTaggedReleases` (self-healing steps 1–3, legacy gate), `getAllReleases`, `deleteReleases` |
| `__tests__/tags.test.ts`             | `getAllTags`, `deleteTags`, pagination, 403 error paths                                          |
| `__tests__/terraform-module.test.ts` | `getReleaseTag`, `getReleaseTagVersion`, `isModuleAssociatedWithTag`, tag normalization          |
| `__tests__/utils/markers.test.ts`    | `buildPrMarker` / `matchesPrMarker` (version-agnostic marker match)                              |

## Design Decisions and Trade-offs

| Decision                           | Rationale                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| Branchless release commits         | Avoids polluting repository branches; each release tree is module-scoped and minimal |
| Temp dir with `.git` copy          | Isolates module files per release without touching the workspace checkout            |
| Sequential releases (not parallel) | Shared `.git` object store in temp dirs; avoids race conditions                      |
| Runtime bot email resolution       | Compatible with GitHub.com and GHES without hardcoding IDs                           |
| HTTPS extraheader auth             | Same mechanism as `actions/checkout`; avoids SSH key management                      |
| Tag-only push (no branch push)     | Keeps repository branches clean; standard Git tag resolution works for all consumers |
| Tag name normalization on match    | Handles repositories that changed separator schemes over time                        |
