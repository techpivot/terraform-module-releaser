# State Management

This document explains how `terraform-module-releaser` decides what to release on a merge, how it stays **idempotent and
self-healing** across re-runs, and **why** it stores the small amount of state it needs where it does. It is intended to
give AI agents and contributors a precise mental model before touching `src/releases.ts`, `src/pull-request.ts`,
`src/utils/markers.ts`, or `src/utils/freshness.ts`.

## The problem

The merge step (`createTaggedReleases` in `src/releases.ts`) creates a Git tag and a GitHub Release for each changed
module. Workflows get **re-run** — manually, after a transient failure, or after a user deletes a release. Without care,
a re-run would:

- **Over-bump** — re-bump from the tag it just created (`v1.1.0` → `v1.2.0`).
- **Double-release** — create a second release for the same change.
- **Fail to self-heal** — never restore a release a user deleted by hand.

So the merge step must **converge to the correct state** rather than blindly act. Three invariants:

- **R1 — Idempotency:** re-running a merge never over-bumps and never double-releases.
- **R2 — Concurrency-correctness:** two pull requests touching the same module both release at sequential versions;
  neither is silently lost.
- **R3 — Self-heal:** a deleted release is recreated at the right version; an orphan tag (a tag with no release) **that
  this pull request produced** gets its release created without bumping.

> R1 and R2 pull in opposite directions. R1 wants a frozen absolute target reconciled by "does it exist?". R2 needs the
> version computed at merge from the **live** latest tag, because a frozen target collides: if PR #5 froze
> `module-a → v1.1.0` and PR #6 (also touching `module-a`) merges first and creates `v1.1.0`, then
> reconcile-by-existence would skip #5 and **silently lose its release**.

## The design

We resolve the R1/R2 tension by **never freezing a version**:

1. **The set of modules to release is recomputed from the pull request's commits at merge** — the same mechanism used on
   every open-PR run. There is no stored "plan"; the module just does its thing, over and over.
2. **The version is always live-bumped** from the current latest tag (`TerraformModule.getReleaseTag()` reads `tags[0]`,
   and tags are fetched fresh each run). Never frozen.
3. **Idempotency is decided per-module from a durable marker** (below), not from a frozen target and not from a blind
   early-exit.

### The per-module algorithm (`createTaggedReleases`)

For each module the pull request changed:

1. **Already released for this PR?** A release body carries this PR's marker → **skip** (no bump, no create). Still
   reported so the post-release comment lists it. _(Normal re-run; partial retry already-done.)_
1. **Latest tag is ours and already released?** The tag's **release commit** carries this PR's marker but the release
   body no longer does → **skip**. _(A release body that was hand-edited or replaced by GitHub's "Generate release
   notes", which strips the marker. Without this the run would bump and publish a duplicate.)_
1. **Orphan tag that is ours?** Searching this module's tags without releases, newest-first, the first one provably this
   PR's → **(re)create the release for that existing tag**, at its existing version, no bump and no new tag/commit.
   _(Crash after tag push; a manually-deleted release whose tag remains; an orphan a later PR has already bumped past.)_
1. **Otherwise** → bump from the live latest tag, then commit + tag + push + create. _(First release; a tag we cannot
   attribute to this PR; release+tag both deleted → latest reverts → the bump reproduces the same version; live-bump
   under concurrency.)_

This needs no stored plan and no new state beyond the marker — everything else is derived from the tags, releases, and
commits already fetched.

### Provenance: why an orphan tag is not automatically ours

A tag with no release is **not** proof that this pull request created it. It could equally be:

- a tag pushed by hand, or one that predates adoption of this action;
- a tag left by a **different** pull request whose run died between `git push` and `createRelease`.

Adopting such a tag would attach this pull request's changelog to another commit's tree **and leave this pull request's
own changes unreleased forever** (step 1 would match on every subsequent re-run). That is a direct R2 violation and, for
pre-existing tags, a regression against the pre-self-healing behavior.

So every release commit this action creates carries the marker as its final line:

```
<module>/vX.Y.Z

<pull request title>

<pull request body>

<!-- techpivot/terraform-module-releaser:release-pr:1:<owner>/<repo>#<prNumber> -->
```

Before adopting a tag, `getTagProvenance` resolves that tag's commit and decides:

1. commit message carries **this** PR's marker → `marker` (**ours**);
1. commit message carries a marker naming a **different** PR → **definitively not ours**;
1. **no marker at all** (tag predates the marker scheme) → `heuristic`, and only if the commit matches the
   release-commit shape **exactly**: line 1 is the tag name and line 3 is this pull request's title.

Anything unresolvable — an annotated tag object, a deleted commit, a transient API error — is treated as **not
attributable**. Failing to adopt is always recoverable (the owning pull request's re-run heals it); wrongly adopting is
not.

Two deliberate strictnesses:

- The pre-marker fallback is **shape-exact, not a substring test**. `line 1 === tag` holds for every release commit this
  action has ever written, so a loose "message contains the title" check would leave the title as the only discriminator
  — and Renovate and Dependabot reuse titles byte-for-byte across pull requests, which would make a collision routine
  rather than theoretical.
- A `heuristic` result may **recover** an orphan tag but may never **skip** a release (step 1b requires a real
  `marker`). A wrong skip drops a genuine release forever; a wrong recovery leaves a state a re-run can still correct.

The marker is also **repository-scoped** (`<owner>/<repo>#<prNumber>`), because a fork or mirror clone copies tags but
not releases: every module's latest tag there is an orphan carrying the upstream marker, and fork pull request numbering
restarts at 1. A bare number would let a fork adopt an upstream tag on a collision.

Finally, a text carrying markers for **two different** pull requests is treated as naming none of them. Ambiguity means
something injected a marker, and the safe reading costs at most a version bump.

> **Cost.** The provenance lookup only runs when its answer can change the outcome: a tag has no release (step 2), or
> the latest tag's release carries no marker (step 1b). A release carrying any marker resolves for free. In the steady
> state — no orphan tags, every release body carrying our marker — it costs **zero** extra API requests. The step 2 scan
> is capped at `MAX_ORPHAN_TAG_LOOKUPS` (currently 3) per module so a repository full of hand-made tags cannot turn one
> merge into an unbounded number of lookups; when the cap truncates, the run logs it.

## Where state lives — and why not elsewhere

The only durable state is hidden HTML-comment markers we fully control. We deliberately do **not** introduce external or
platform state. The options considered and rejected:

| Mechanism                                                 | Verdict                                                                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Release body marker** (chosen tie)                      | Written **atomically with** the release by GitHub; non-expiring; the most crash-robust place to record "this PR released this module." |
| **Release commit marker** (chosen provenance proof)       | Immutable once pushed — unlike a release body, nobody can edit it — so it is the authoritative proof of tag ownership.                 |
| **Post-release PR comment marker** (chosen scheme signal) | Easy to read/write; survives; identifies the comment's scheme version.                                                                 |
| GitHub Actions **artifacts**                              | **Expire** (90-day default, run-scoped), and an action runs inside the consumer's workflow so it would pollute their run storage.      |
| GitHub Actions **cache**                                  | **Evicted** after 7 days since last access; not durable.                                                                               |
| Repository **custom properties**                          | Repository-level only — there is **no custom-metadata field on a pull request or issue**.                                              |
| Pull request **labels**                                   | A flat, length-limited string namespace; cannot hold a structured map.                                                                 |
| External KV (e.g. Cloudflare)                             | Rejected: this has worked well for 99% of users with no service; building one to cover a sub-1% edge is not worth it.                  |

### Marker (1): the release-body idempotency tie

Each release this action creates embeds a hidden, **schema-versioned** marker tying it to the producing pull request
(see `src/utils/markers.ts`):

```
<!-- techpivot/terraform-module-releaser:release-pr:1:<owner>/<repo>#<prNumber> -->
```

- It is built and matched only through `buildPrMarker` / `matchesPrMarker`, so the writer and the reader can never
  drift.
- Detection is **version-agnostic on the schema digit** — a body written by a future `:2:` schema is still recognized by
  current code, and vice versa. The trailing ` -->` terminator makes the PR-number match exact (`:12` never matches
  `:123`).
- Matching is **anchored to a standalone line**. We always write the marker as its own trailing line, so this is exact —
  and it means a marker sitting mid-sentence inside prose is never honored.
- The release body is **non-expiring but not immutable**: maintainers, bots, and GitHub's "Generate release notes"
  button can all rewrite it, which silently removes the marker. That is why the tie is corroborated by the release
  commit (step 1b above), which cannot be edited.
- We intentionally do **not** reuse the human-facing `[PR #n]` changelog link as the tie: that text is editable and its
  format may change. The dedicated marker is purpose-built and under our control.
- Because the marker lives in the release body, it is also included when release bodies are concatenated into the wiki
  "full changelog" (`getTerraformModuleFullReleaseChangelog`). This is harmless: it is an HTML comment, so it never
  renders on the Releases page or in the wiki.

#### Untrusted input is neutralized

Untrusted text reaches **two** places that the idempotency scheme trusts, and both must be neutralized:

1. the **release body**, via `src/changelog.ts` (pull request title and commit messages); and
2. the **release commit message**, via `createTaggedReleases` (pull request title and body).

The second is the one that matters most, and is easy to miss: it is the text the provenance check reads as proof of
ownership. `git commit -m` uses `cleanup=whitespace`, so a marker planted on its own line in a pull request description
survives into the commit verbatim — where the standalone-line anchoring below would _accept_ it. A merged pull request
whose description contained a marker naming some **other** pull request could therefore make that pull request adopt
this tag, or skip its own release entirely.

`neutralizePrMarkers` escapes the opening `<` of any marker-shaped sequence at both sites. Unrelated HTML comments a
user legitimately writes are untouched, and the escaped form renders visibly, so an attempted forgery is obvious rather
than silent. The standalone-line anchoring and the "two distinct markers means neither" rule are defense in depth behind
it.

### Marker (2): the post-release comment scheme signal

The post-release comment is identified by `PR_RELEASE_COMMENT_MARKER` (`…:release:1`), distinct from the previous
`LEGACY_PR_RELEASE_COMMENT_MARKER` (`… — release-marker —`). Their distinctness is the scheme signal.

## Backward / forward compatibility

A re-run does not "freeze" the action version: re-running a workflow replays it with the original commit's workflow
file, but the action code that executes is whatever the consumer's `uses:` ref resolves to **at re-run time**. A
SHA/immutable pin runs the original (old) code; a moving tag (`@v2`, `@main`) runs the **current** code against **old
data**. So the only compatibility burden is a moving-tag consumer re-running a pull request that was released **before**
they upgraded.

The **legacy gate** at the top of `createTaggedReleases` handles this by reading only our own markers:

```
legacy = (a post-release comment uses LEGACY_PR_RELEASE_COMMENT_MARKER) AND (no release carries our new marker)
if (legacy) → skip (preserve the old "don't double-release" behavior)
else        → run the per-module algorithm, stamping the new marker into every release we create
```

This is a clean two-way branch, not a chain, and it never parses editable release-note text. It yields a clear contract:

- **New pull requests** are protected by the durable per-release marker — robust even if the user deletes the comment.
- **Legacy pull requests** retain **exactly their original comment-based protection** — no regression.

> Because the post-release comment is itself versioned, a current-scheme PR whose only release was deleted is **not**
> mistaken for legacy: its comment carries the new marker, so the gate lets it self-heal.

**The gate fails closed.** If the comment list cannot be read, `hasLegacyPostReleaseComment` throws and the run fails
rather than assuming "not legacy". A transient 502 or secondary rate limit is indistinguishable from a genuine absence,
and guessing wrong on a legacy pull request produces an irreversible over-bump plus a duplicate release. Failing is
cheap precisely because of this refactor: the re-run is idempotent and creates nothing extra. (The comment lookup in
`addPostReleaseComment` stays best-effort — the worst case there is a duplicate comment.)

### Accepted limitations (rare; documented, not engineered around)

- **Deleted legacy release.** We do not recreate a release deleted from a _legacy_ (pre-marker) pull request — the old
  code could not either, so this is not a regression. Escape hatch: deleting the legacy post-release comment makes the
  PR look brand-new, so it will re-release.
- **Old-action partial failure then upgrade.** If an old version released some modules but crashed before writing its
  comment, then the action is upgraded and re-run, the already-released modules could re-release — identical to the old
  version's own behavior.
- **A foreign orphan tag is never adopted.** The current pull request bumps past it and warns; the tag's owning pull
  request must be re-run to heal it. This is deliberate — see
  [Provenance](#provenance-why-an-orphan-tag-is-not-automatically-ours).
- **Only the newest few orphan tags are healed.** Step 2 inspects at most `MAX_ORPHAN_TAG_LOOKUPS` (currently 3) of a
  module's tags-without-releases. A pull request whose orphan sits below that many newer orphans bumps instead of
  healing. The run logs when the cap truncates, so this is never silent. See [Concurrency](#concurrency).
- **Editing a release body removes the primary tie.** Mitigated by the release-commit corroboration, not eliminated: if
  both the body is edited _and_ the tag's commit is unresolvable, the module will bump again.
- **Re-running an old merged pull request does not clean up or regenerate the wiki.** By design — see below.
- **Action downgrade.** Downgrading the action after releasing under the new scheme is unsupported.

## Re-run side effects and the freshness guard

Removing the old blind early-exit means a merge re-run no longer returns immediately — it performs its normal read work
and then the per-module self-heal. Releases are safe to re-run. **Deletions computed from a stale tree are not.**

The merge handler mixes two sources of truth: the set of modules comes from the **checked-out tree**
(`parseTerraformModules` walks `context.workspaceDir`), while tags and releases are fetched **live**. On a re-run of an
older merged pull request, `actions/checkout` restores that pull request's merge commit, so every module added since is
absent from the tree. Left unguarded, the cleanup step would classify those modules' tags and releases as orphaned and
delete them, and wiki regeneration would rewrite the wiki from the stale module list — dropping pages for modules added
later. The wiki half is not covered by `delete-legacy-tags`, so disabling that input would not protect you.

`isCheckoutCurrent()` (`src/utils/freshness.ts`) resolves this with a single `repos.compareCommitsWithBasehead` call on
the merge path only. When the base branch has advanced past this pull request's merge commit, the run:

- **still** creates/recovers releases and updates the post-release comment (self-heal is the point of a re-run);
- **skips** obsolete tag/release cleanup and wiki regeneration, and emits a warning explaining why;
- **withholds** any module that would be an _initial_ release but no longer exists on the base branch, so a module
  deleted by a later pull request is not resurrected.

It **fails open**: a null merge commit or an API error assumes the checkout is current, preserving prior behavior rather
than becoming a new single point of failure.

> **Operator guidance.** To fix a failed wiki generation or to force tag/release cleanup, re-run the workflow of the
> **most recently merged** pull request. Re-running an older pull request only self-heals that pull request's own
> releases.

## Action outputs

Because a merge run may skip or recover rather than create, the optimistically computed `releaseTag` is frequently not
what gets published. `changed-modules-map` is therefore **re-emitted after releases are created** with the tag that
actually exists, plus an `action` field:

| `action`    | Meaning                                                   | `releaseTag`     |
| ----------- | --------------------------------------------------------- | ---------------- |
| `created`   | A new version was bumped, tagged, and released.           | the new tag      |
| `recovered` | A missing release was created for an existing tag.        | the existing tag |
| `skipped`   | This pull request had already released the module.        | the existing tag |
| `none`      | Nothing was released (legacy gate, or withheld as stale). | `null`           |

Consumers should branch on `action` before treating `releaseTag` as a newly published release. The pre-release map is
still emitted first, so outputs remain populated if the release step throws.

## Concurrency

There is **no concurrency enforcement**, and none is required for correctness — the design self-heals via re-run.
Releases are created sequentially within a run (see [tagging.md](tagging.md)). For two pull requests racing on the same
module:

> Both read latest `v1.0.0` and target `v1.1.0`. The first tag push wins; the second push is **rejected** (the ref
> already exists) → that run errors → its re-run reads the now-live `v1.1.0`, live-bumps to `v1.2.0`, and succeeds. No
> release is lost and nothing is over-bumped.

A non-racing second PR converges the same way: it finds `v1.1.0` already released by the other PR (its release cites the
_other_ PR, so step 1 does not match; the tag is not an orphan), so it live-bumps to `v1.2.0`.

The case provenance exists for: PR #5 pushes `v1.1.0` and dies **before** creating the release, then PR #6 merges
touching the same module. PR #6 sees an orphan tag, proves it belongs to #5, leaves it alone, and releases `v1.2.0` for
its own changes. **PR #6's changes are not lost, and #5's tag is not hijacked** — which is the property provenance buys.

Re-running #5 then heals `v1.1.0` at its original version, because step 2 searches **every orphan tag newest-first**,
not just the latest one:

> `v1.2.0` is the latest tag, but it already has a release carrying #6's marker — unambiguously not ours, and resolved
> without any API call. The next candidate, `v1.1.0`, has no release; its commit carries #5's marker, so it is recovered
> in place. No bump, no new tag.

Had step 2 only ever considered the latest tag, #5 would instead have bumped to `v1.3.0` and published its older
workspace tree as the module's newest version — silently reverting #6's changes to that module. Both pull requests end
up released, at the right versions, in either order.

The scan is bounded (`MAX_ORPHAN_TAG_LOOKUPS`, currently 3) and only considers tags that have **no** release, so a
healthy repository scans nothing and pays nothing. When the cap truncates, the run logs it rather than silently checking
fewer.

Optional hardening — a `concurrency:` group, branch-protection "Require branches to be up to date before merging", or
SHA-pinning the action — is documented as consumer guidance, not a requirement.

## Relevant files

| File                     | Role                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/releases.ts`        | `createTaggedReleases` — the legacy gate, provenance check, and per-module self-heal algorithm                                    |
| `src/main.ts`            | merge orchestration, the freshness gate on destructive steps, and outcome-based action outputs                                    |
| `src/utils/freshness.ts` | `isCheckoutCurrent` / `pathExistsOnBaseRef` — stale-checkout detection                                                            |
| `src/pull-request.ts`    | `addPostReleaseComment` (idempotent summary), `findReleaseComments`, `hasLegacyPostReleaseComment`                                |
| `src/utils/markers.ts`   | `buildPrMarker` / `matchesPrMarker` / `hasAnyPrMarker` / `neutralizePrMarkers` — the single source for the tie                    |
| `src/changelog.ts`       | neutralizes untrusted pull request and commit text before it enters a release body                                                |
| `src/utils/constants.ts` | `PR_RELEASE_COMMENT_MARKER`, `LEGACY_PR_RELEASE_COMMENT_MARKER`, `RELEASE_BODY_PR_MARKER_PREFIX`, `RELEASE_BODY_PR_MARKER_SCHEMA` |

See also [architecture.md](architecture.md) for the overall execution flow and [tagging.md](tagging.md) for the
tag/release mechanics.
