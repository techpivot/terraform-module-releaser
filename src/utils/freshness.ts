import { context } from '@/context';
import { info, warning } from '@actions/core';

/**
 * Determines whether the checked-out workspace still represents the current tip of the base branch.
 *
 * **Why this exists.** The merge handler mixes two sources of truth. The set of Terraform modules is
 * derived from the **checked-out tree** (`parseTerraformModules` walks `context.workspaceDir`), while
 * tags and releases are fetched **live** from the API. That asymmetry is harmless on a normal merge,
 * because the checkout *is* the current tree. It is destructive on a re-run of an older merged pull
 * request: `actions/checkout` restores that pull request's merge commit, so every module added since is
 * absent from the tree, and the cleanup step then classifies their tags and releases as orphaned and
 * deletes them. Wiki regeneration has the same problem — it rewrites the wiki from the stale module
 * list, removing pages for modules added later — and is not covered by `delete-legacy-tags`.
 *
 * Previously this was masked by an unconditional early-exit whenever a post-release comment existed.
 * That exit was removed so that releases could self-heal, which is what exposed the hazard; releases
 * are safe to re-run, but deletions computed from a stale tree are not.
 *
 * **Failure policy: fails open.** A null merge commit or any API error returns `true`, preserving the
 * pre-existing behavior rather than silently disabling wiki generation and cleanup on a transient blip.
 * The guard exists to prevent a rare, destructive mistake, not to become a new single point of failure.
 *
 * @returns {Promise<boolean>} `true` when the checkout is current (or freshness cannot be determined).
 */
export async function isCheckoutCurrent(): Promise<boolean> {
  const {
    octokit,
    repo: { owner, repo },
    baseRef,
    mergeCommitSha,
  } = context;

  if (mergeCommitSha === null) {
    warning(
      "Unable to determine this pull request's merge commit; assuming the checkout is current. Obsolete tag/release cleanup and wiki regeneration will proceed.",
    );
    return true;
  }

  try {
    const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${mergeCommitSha}...${baseRef}`,
    });

    // 'identical' means the base branch tip is exactly this pull request's merge commit, so the tree we
    // checked out is the current tree. Anything else ('ahead', 'behind', 'diverged') means it is not.
    if (data.status === 'identical') {
      return true;
    }

    info(
      `Base branch '${baseRef}' has advanced ${data.ahead_by} commit(s) beyond this pull request's merge commit (${mergeCommitSha}); status: ${data.status}.`,
    );

    return false;
  } catch (error) {
    warning(
      `Unable to compare this pull request's merge commit against '${baseRef}'; assuming the checkout is current: ${error instanceof Error ? error.message : String(error)}`,
    );

    return true;
  }
}

/**
 * Returns whether a repository-relative path still exists on the base branch.
 *
 * Used only on the stale-checkout path, to avoid "resurrecting" a module that was deleted by a later
 * pull request. On a stale checkout such a module reappears in the tree with no tags (its tags were
 * cleaned up when it was removed), which reads as a brand-new module and would otherwise be released
 * afresh — and, because cleanup is skipped on that same run, the resurrected tag would survive.
 *
 * Fails open (`true`) on anything other than a definitive 404, so a transient error never silently
 * suppresses a legitimate initial release.
 *
 * @param {string} relativePath - The module directory, relative to the workspace root.
 * @returns {Promise<boolean>} Whether the path exists on the base branch.
 */
export async function pathExistsOnBaseRef(relativePath: string): Promise<boolean> {
  const {
    octokit,
    repo: { owner, repo },
    baseRef,
  } = context;

  try {
    await octokit.rest.repos.getContent({ owner, repo, path: relativePath, ref: baseRef });

    return true;
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      return false;
    }

    warning(
      `Unable to verify whether '${relativePath}' still exists on '${baseRef}'; assuming it does: ${error instanceof Error ? error.message : String(error)}`,
    );

    return true;
  }
}
