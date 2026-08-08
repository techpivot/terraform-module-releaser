import { getPullRequestChangelog } from '@/changelog';
import { config } from '@/config';
import { context } from '@/context';
import { TerraformModule } from '@/terraform-module';
import type { CommitDetails, GitHubRelease, ReleaseOutcome, WikiStatusResult } from '@/types';
import {
  BRANDING_COMMENT,
  LEGACY_PR_RELEASE_COMMENT_MARKER,
  PROJECT_URL,
  PR_RELEASE_COMMENT_MARKER,
  PR_SUMMARY_MARKER,
  WIKI_STATUS,
} from '@/utils/constants';

import { hasStandaloneMarkerLine } from '@/utils/markers';
import { getWikiLink, isWikiCheckFailure } from '@/wiki';
import { debug, endGroup, info, startGroup, warning } from '@actions/core';
import { RequestError } from '@octokit/request-error';

/**
 * GraphQL mutation to minimize (collapse) an issue/pull request comment as outdated.
 *
 * The GitHub REST API does not expose a way to collapse a comment, so we use the GraphQL
 * `minimizeComment` mutation. Minimizing edits the existing comment in place (it does not send a
 * new email notification) and keeps the comment expandable.
 */
const MINIMIZE_COMMENT_MUTATION = `
  mutation MinimizeComment($id: ID!) {
    minimizeComment(input: { classifier: OUTDATED, subjectId: $id }) {
      minimizedComment {
        isMinimized
      }
    }
  }
`;

/**
 * A pull request comment, reduced to the fields this module needs.
 */
interface PullRequestComment {
  /**
   * GitHub is migrating to identifiers that can exceed `Number.MAX_SAFE_INTEGER`, so the API types
   * widened these to `number | bigint`. Carried through verbatim rather than narrowed to `number`:
   * every `comment_id` parameter accepts the same union, and coercing would silently lose precision
   * on a large identifier.
   */
  id: number | bigint;
  nodeId: string;
  body: string;
  createdAt: string;
}

/**
 * Lists every comment on the pull request, following pagination to completion.
 *
 * Always requests `per_page: 100` (GitHub's default is 30), matching `getAllTags()`/`getAllReleases()`.
 * On a busy pull request this is the difference between ~16 requests and ~3 — directly relevant to the
 * rate-limit pressure reported for high-traffic monorepos.
 *
 * Note: we deliberately do **not** memoize across calls within a run. The two merge-path readers
 * (`hasLegacyPostReleaseComment` before releases, `findReleaseComments` after) are cheap at
 * `per_page: 100`, and a process-lifetime cache would be a silent staleness hazard for future callers.
 *
 * @returns {Promise<PullRequestComment[]>} All comments, oldest first (GitHub's listing order).
 * @throws {Error} If the comments cannot be read. Callers decide whether that is fatal.
 */
async function listAllPullRequestComments(): Promise<PullRequestComment[]> {
  const {
    octokit,
    repo: { owner, repo },
    issueNumber: issue_number,
  } = context;

  const comments: PullRequestComment[] = [];
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number,
    per_page: 100,
  });
  for await (const { data } of iterator) {
    for (const comment of data) {
      comments.push({
        id: comment.id,
        nodeId: comment.node_id,
        body: comment.body ?? '',
        createdAt: comment.created_at,
      });
    }
  }

  return comments;
}

/**
 * Finds existing post-release comments (current scheme) on the pull request, identified by
 * {@link PR_RELEASE_COMMENT_MARKER}. Comments are returned in the order GitHub lists them (oldest first), so
 * callers can take the most recent with `.at(-1)`.
 *
 * @returns {Promise<PullRequestComment[]>} The matching post-release comments.
 */
async function findReleaseComments(): Promise<PullRequestComment[]> {
  const comments = await listAllPullRequestComments();

  return comments.filter((comment) => hasStandaloneMarkerLine(comment.body, PR_RELEASE_COMMENT_MARKER));
}

/**
 * Returns true if the pull request has a post-release comment written by a PRE-marker-scheme version of
 * the action (identified by {@link LEGACY_PR_RELEASE_COMMENT_MARKER}).
 *
 * Used by the self-heal gate in `createTaggedReleases` to recognize a pull request that completed its
 * release under an older version of the action — so we preserve the old "don't double-release" behavior
 * instead of re-releasing. This reads only our own marker, never the editable release-note text.
 *
 * **Fails closed.** Any error reading the comment list propagates and fails the run. Returning `false`
 * on a transient error would be indistinguishable from "not legacy" and would convert a single 502 or
 * secondary-rate-limit response into an irreversible over-bump plus a duplicate release on a legacy
 * pull request. Failing is cheap precisely because of this refactor: the re-run is idempotent and
 * self-healing, so it creates nothing extra.
 *
 * @returns {Promise<boolean>} Whether a legacy post-release comment exists.
 * @throws {Error} If the pull request comments cannot be read.
 */
export async function hasLegacyPostReleaseComment(): Promise<boolean> {
  try {
    const comments = await listAllPullRequestComments();

    return comments.some((comment) => hasStandaloneMarkerLine(comment.body, LEGACY_PR_RELEASE_COMMENT_MARKER));
  } catch (error) {
    const requestError = error as RequestError;
    // Wrap a permissions failure with actionable remediation, matching the other readers in this module.
    if (requestError.status === 403) {
      throw new Error(
        `Unable to read and write pull requests due to insufficient permissions. Ensure the workflow permissions.pull-requests is set to "write".\n${requestError.message}`,
        { cause: error },
      );
    }

    throw new Error(
      `Failed to check for a legacy release comment: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Retrieves the list of changed files in the pull request and returns them as a Set.
 *
 * @returns {Promise<Set<string>>} A promise that resolves to a Set of filenames representing the changed files.
 * @throws {RequestError} Throws an error if the request to fetch files fails or if permissions are insufficient.
 */
async function getChangedFilesInPullRequest(): Promise<Set<string>> {
  try {
    const {
      octokit,
      repo: { owner, repo },
      prNumber: pull_number,
    } = context;

    const iterator = octokit.paginate.iterator(octokit.rest.pulls.listFiles, { owner, repo, pull_number });

    const changedFiles = new Set<string>();
    for await (const { data } of iterator) {
      for (const file of data) {
        changedFiles.add(file.filename);
      }
    }

    return changedFiles;
  } catch (error) {
    const requestError = error as RequestError;
    // Handle 403 error specifically for permission issues
    if (requestError.status === 403) {
      throw new Error(
        `Unable to read and write pull requests due to insufficient permissions. Ensure the workflow permissions.pull-requests is set to "write".\n${requestError.message}`,
        { cause: error },
      );
    }

    throw new Error(`Error getting changed files in PR: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

/**
 * Retrieves the commits associated with a specific pull request, ensuring that only true, effective file changes are tracked.
 *
 * This function first queries the entire set of changed files within the pull request, which includes files modified across
 * all commits within the PR. It then filters and processes the changes to ensure that modifications reverted by subsequent
 * commits are not tracked as effective changes. This approach helps avoid tracking transient changes that cancel each other out.
 *
 * If a pull request contains two commits, where one modifies a Terraform module and a subsequent commit reverts that modification,
 * both commits would normally be detected as changes to the module. However, the final result may not reflect any actual changes
 * if the second commit effectively reverts the first.
 *
 * To address this, we ensure that only effective file changes are tracked—ignoring changes that cancel each other out.
 *
 * First observed in this Pull Request where earlier commits triggered changes to a test Terraform module and later commits
 * reverted it: #21
 *
 * @returns {Promise<CommitDetails[]>} A promise that resolves to an array of commit details,
 *                                       each containing the message, SHA, and associated file paths.
 * @throws {RequestError} Throws an error if the request to fetch commits fails or if permissions
 *                       are insufficient to read the pull request.
 */
export async function getPullRequestCommits(): Promise<CommitDetails[]> {
  console.time('Elapsed time fetching commits');
  startGroup('Fetching pull request commits');

  try {
    const {
      octokit,
      repo: { owner, repo },
      prNumber: pull_number,
    } = context;

    const prChangedFiles = await getChangedFilesInPullRequest();
    info(`Found ${prChangedFiles.size} file${prChangedFiles.size !== 1 ? 's' : ''} changed in pull request.`);
    info(JSON.stringify(Array.from(prChangedFiles), null, 2));

    const iterator = octokit.paginate.iterator(octokit.rest.pulls.listCommits, { owner, repo, pull_number });

    // Iterate over the fetched commits to retrieve details and files
    const commits = [];
    for await (const { data } of iterator) {
      for (const commit of data) {
        const commitDetailsResponse = await octokit.rest.repos.getCommit({
          owner,
          repo,
          ref: commit.sha,
        });

        // Filter files to only include those that are part of prChangedFiles
        const files =
          commitDetailsResponse.data.files
            ?.map((file) => file.filename)
            .filter((filename) => prChangedFiles.has(filename)) ?? [];

        commits.push({
          message: commit.commit.message,
          sha: commit.sha,
          files,
        });
      }
    }

    info(`Found ${commits.length} commit${commits.length !== 1 ? 's' : ''}.`);
    debug(JSON.stringify(commits, null, 2));

    return commits;
  } catch (error) {
    const requestError = error as RequestError;

    if (requestError.status === 403) {
      throw new Error(
        `Unable to read and write pull requests due to insufficient permissions. Ensure the workflow permissions.pull-requests is set to "write".\n${requestError.message}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    console.timeEnd('Elapsed time fetching commits');
    endGroup();
  }
}

/**
 * Comments on a pull request with a summary of the changes made to Terraform modules,
 * including details about the release plan and any modules that will be removed.
 *
 * This function constructs a markdown table displaying the release plan for changed Terraform modules,
 * noting their release types and versions. It also handles tags belonging to modules that are
 * no longer present in the source and will be removed upon release.
 *
 * @param {TerraformModule[]} terraformModules - An array of Terraform module objects containing
 * module metadata, version information, and release status.
 * @param {GitHubRelease[]} releasesToDelete - List of Terraform releases to delete.
 * @param {string[]} tagsToDelete - List of Terraform tags to remove.
 * @param {WikiStatusResult} wikiStatus - Object containing the status of the Wiki and any relevant
 * error information if the Wiki check failed.
 * @returns {Promise<void>} A promise that resolves when the comment has been posted and previous
 * summary comments have been deleted.
 * @throws {Error} Throws an error if there are permission issues or other failures when posting
 * to the GitHub API.
 */
export async function addReleasePlanComment(
  terraformModules: TerraformModule[],
  releasesToDelete: GitHubRelease[],
  tagsToDelete: string[],
  wikiStatus: WikiStatusResult,
): Promise<void> {
  console.time('Elapsed time commenting on pull request');
  startGroup('Adding pull request release plan comment');

  try {
    const {
      octokit,
      repo: { owner, repo },
      issueNumber: issue_number,
    } = context;

    const terraformModulesToRelese = TerraformModule.getModulesNeedingRelease(terraformModules);

    // Initialize the comment body as an array of strings with appropriate header based on wiki status
    const commentBody: string[] = [PR_SUMMARY_MARKER];

    if (isWikiCheckFailure(wikiStatus.status)) {
      commentBody.push('\n# ⚠️ Release Plan\n', '> ⚠️ **IMPORTANT**: _See Wiki Status error below._\n');
    } else {
      commentBody.push('\n# 📋 Release Plan\n');
    }

    // Changed Modules
    if (terraformModulesToRelese.length === 0) {
      commentBody.push('No terraform modules updated in this pull request.');
    } else {
      commentBody.push(
        '| Module | Type | Latest<br>Version | New<br>Version | Release<br>Details |',
        '|--|--|--|--|--|',
      );
      for (const module of terraformModulesToRelese) {
        // Prevent module name from wrapping on hyphens in table cells (Doesn't work reliably)
        const name = `<nobr><code>${module.name}</code></nobr>`;
        const type = module.getReleaseType();
        const latestVersion = module.getLatestTagVersion() ?? '';
        const releaseTagVersion = module.getReleaseTagVersion();

        // Generate simple reason labels with emojis
        const reasonLabels = [];

        for (const reason of module.getReleaseReasons()) {
          switch (reason) {
            case 'initial': {
              reasonLabels.push('🆕 Initial Release');
              break;
            }
            case 'direct-changes': {
              reasonLabels.push('📝 Changed Files');
              break;
            }
            //case 'local-dependency-update': {
            //  reasonLabels.push('🔗 Local Dependency Updated');
            //  break;
            //}
          }
        }

        commentBody.push(
          `| ${name} | ${type} | ${latestVersion} | **${releaseTagVersion}** | ${reasonLabels.join('<br>')} |`,
        );
      }
    }

    // Changelog
    if (terraformModulesToRelese.length > 0) {
      commentBody.push('\n# 📝 Changelog\n', getPullRequestChangelog(terraformModules));
    }

    // Wiki Status
    commentBody.push(
      '\n<h2><sub>Wiki Status<sup title="Checks to ensure that the Wiki is enabled and properly initialized">ℹ️</sup></sub></h2>\n',
    );
    switch (wikiStatus.status) {
      case WIKI_STATUS.DISABLED:
        commentBody.push('🚫 Wiki generation **disabled** via `disable-wiki` flag.');
        break;
      case WIKI_STATUS.SUCCESS:
        commentBody.push('✅ Enabled');
        break;

      case WIKI_STATUS.FAILURE_CHECKOUT:
        commentBody.push(
          '**⚠️ Failed to checkout wiki:**',
          '```',
          `${wikiStatus.errorMessage}`,
          '```',
          `Please consult the [README.md](${PROJECT_URL}/blob/main/README.md#getting-started) for additional information (**Ensure the Wiki is initialized**).`,
        );
        break;
      case WIKI_STATUS.FAILURE_TERRAFORM_DOCS_INSTALL:
        commentBody.push(
          '**⚠️ terraform-docs installation failed:**',
          '```',
          `${wikiStatus.errorMessage}`,
          '```',
          `Please consult the [README.md](${PROJECT_URL}/blob/main/README.md#terraform-docs-installation) for troubleshooting terraform-docs installation on the runner.`,
        );
        break;
      case WIKI_STATUS.FAILURE_TERRAFORM_DOCS_RUN: {
        const terraformDocsErrors = wikiStatus.terraformDocsErrors;
        if (!terraformDocsErrors || terraformDocsErrors.size === 0) {
          const errorMessage = wikiStatus.errorMessage ?? 'Unknown terraform-docs validation failure.';
          commentBody.push('**⚠️ terraform-docs validation failed:**', '```', errorMessage, '```');
          break;
        }

        const count = terraformDocsErrors.size;
        const terraformDocsValidationLines = [
          `⚠️ Wiki enabled, but terraform-docs validation failed for **${count}** module${count > 1 ? 's' : ''}:\n`,
          '| Module | Error |',
          '|--|--|',
        ];
        for (const [moduleName, errorMessage] of terraformDocsErrors) {
          const sanitized = errorMessage
            .replaceAll('|', String.raw`\|`)
            .replaceAll('\r', ' ')
            .replaceAll('\n', ' ')
            .trim();
          terraformDocsValidationLines.push(`| \`${moduleName}\` | ${sanitized} |`);
        }
        terraformDocsValidationLines.push(
          '\nPlease fix the terraform-docs errors above (often caused by `.terraform-docs.yml`) before merging to avoid broken wiki pages.',
        );
        commentBody.push(...terraformDocsValidationLines);
        break;
      }
    }

    // Automated Tag Cleanup
    commentBody.push(
      '\n<h2><sub>Automated Tag/Release Cleanup<sup title="Controls whether obsolete tags and releases will be automatically deleted">ℹ️</sup></sub></h2>\n',
    );

    // Modules to Remove
    if (!config.deleteLegacyTags) {
      commentBody.push(
        '⏸️ Existing tags and releases will be **preserved** as the `delete-legacy-tags` flag is disabled.',
      );
    } else if (tagsToDelete.length === 0 && releasesToDelete.length === 0) {
      commentBody.push('✅ All tags and releases are synchronized with the codebase. No cleanup required.');
    } else {
      if (releasesToDelete.length > 0) {
        const releaseText = releasesToDelete.length === 1 ? 'release is' : 'releases are';
        const pronounText = releasesToDelete.length === 1 ? 'It' : 'They';
        const releaseList = releasesToDelete.map((release) => `\`${release.title}\``).join(', ');

        commentBody.push(
          `**⚠️ The following ${releaseText} no longer referenced by any source Terraform modules. ${pronounText} will be automatically deleted.**`,
          ` - ${releaseList}`,
        );
      }

      if (tagsToDelete.length > 0) {
        // Add an extra newline if we already added releases content
        if (releasesToDelete.length > 0) {
          commentBody.push('');
        }

        const tagText = tagsToDelete.length === 1 ? 'tag is' : 'tags are';
        const pronounText = tagsToDelete.length === 1 ? 'It' : 'They';
        const tagList = tagsToDelete.map((tag) => `\`${tag}\``).join(', ');

        commentBody.push(
          `**⚠️ The following ${tagText} no longer referenced by any source Terraform modules. ${pronounText} will be automatically deleted.**`,
          ` - ${tagList}`,
        );
      }
    }

    // Branding
    if (config.disableBranding === false) {
      commentBody.push(`\n${BRANDING_COMMENT}`);
    }

    // When `hide-no-changes-pr-comment` is enabled and this pull request has nothing to report,
    // avoid spamming reviewers with a "Release Plan" comment. A pull request has "nothing to report"
    // when no modules need a release, no tag/release cleanup is pending, and the wiki check did not fail.
    const wikiCheckFailed = isWikiCheckFailure(wikiStatus.status);
    const hasPendingCleanup = config.deleteLegacyTags && (releasesToDelete.length > 0 || tagsToDelete.length > 0);
    const nothingToReport = terraformModulesToRelese.length === 0 && !hasPendingCleanup && !wikiCheckFailed;

    if (config.hideNoChangesPrComment && nothingToReport) {
      const allComments = await listAllPullRequestComments();
      const existingSummaryComments = allComments.filter((comment) =>
        hasStandaloneMarkerLine(comment.body, PR_SUMMARY_MARKER),
      );

      // Keep the most recent existing Release Plan comment, if any. `.at(-1)` returns undefined when
      // none exist, in which case we post nothing (no comment, no email notification).
      const commentToKeep = existingSummaryComments.at(-1);
      if (!commentToKeep) {
        info('Hide no-changes PR comment enabled and nothing to report. Skipping comment creation.');
        return;
      }

      // An existing Release Plan comment is present (e.g. an earlier push had changes that were later
      // removed). Update it in place and minimize/collapse it. Editing rather than recreating avoids
      // sending a new email notification while keeping the comment expandable. Keep the most recent
      // comment and remove any older duplicates.
      const body = commentBody.join('\n').trim();
      info(
        `Hide no-changes PR comment enabled and nothing to report. Minimizing existing comment ${commentToKeep.id}.`,
      );

      // Best-effort: update + minimize should never fail the action.
      try {
        await octokit.rest.issues.updateComment({ owner, repo, comment_id: commentToKeep.id, body });
      } catch (error) {
        warning(
          `Failed to update release plan comment ${commentToKeep.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      try {
        await octokit.graphql(MINIMIZE_COMMENT_MUTATION, { id: commentToKeep.nodeId });
      } catch (error) {
        warning(
          `Failed to minimize release plan comment ${commentToKeep.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // Remove any older summary comments so only the single minimized comment remains.
      for (const comment of existingSummaryComments.slice(0, -1)) {
        info(`Deleting previous PR comment from ${comment.createdAt}`);
        await octokit.rest.issues.deleteComment({ comment_id: comment.id, owner, repo });
      }

      return;
    }

    // Create new PR comment (Requires permission > pull-requests: write)
    const { data: newComment } = await octokit.rest.issues.createComment({
      issue_number,
      owner,
      repo,
      body: commentBody.join('\n').trim(),
    });
    info(`Posted comment ${newComment.id} @ ${newComment.html_url}`);

    // Filter out the comments that contain the PR summary marker and are not the current comment.
    // Identity is compared as a string because comment ids are typed `number | bigint`: `1n !== 1` is
    // true in JavaScript, so a mixed representation would mark the comment we just posted as stale and
    // delete it. Comparing the decimal rendering is exact for integer ids and immune to that mismatch.
    const allComments = await listAllPullRequestComments();
    const newCommentId = String(newComment.id);
    const commentsToDelete = allComments.filter(
      (comment) => hasStandaloneMarkerLine(comment.body, PR_SUMMARY_MARKER) && String(comment.id) !== newCommentId,
    );

    // Delete all our previous comments
    for (const comment of commentsToDelete) {
      info(`Deleting previous PR comment from ${comment.createdAt}`);
      await octokit.rest.issues.deleteComment({ comment_id: comment.id, owner, repo });
    }
  } catch (error) {
    if (error instanceof RequestError) {
      throw new Error(
        [
          `Failed to create a comment on the pull request: ${error.message} - Ensure that the`,
          'GitHub Actions workflow has the correct permissions to write comments. To grant the required permissions,',
          'update your workflow YAML file with the following block under "permissions":\n\npermissions:\n',
          ' pull-requests: write',
        ].join(' '),
        { cause: error },
      );
    }

    const errorMessage = error instanceof Error ? error.message.trim() : String(error).trim();
    throw new Error(`Failed to create a comment on the pull request: ${errorMessage}`, { cause: error });
  } finally {
    console.timeEnd('Elapsed time commenting on pull request');
    endGroup();
  }
}

/**
 * Renders the post-release comment body: one line per released module, each linking its release notes
 * and (unless the wiki is disabled) its wiki page.
 *
 * @param {ReleaseOutcome[]} releaseOutcomes - What was created, recovered, or skipped for each module.
 * @param {string} repoUrl - The repository URL used to build release-notes links.
 * @returns {string} The rendered comment body.
 */
function renderPostReleaseCommentBody(releaseOutcomes: ReleaseOutcome[], repoUrl: string): string {
  // Construct the comment body as an array of strings
  const commentBody: string[] = [
    PR_RELEASE_COMMENT_MARKER,
    '\n## :rocket: Terraform Module Releases\n',
    'The following Terraform modules have been released:\n',
  ];

  for (const { module, release } of releaseOutcomes) {
    const extra = [`[Release Notes](${repoUrl}/releases/tag/${release.tagName})`];
    if (config.disableWiki === false) {
      extra.push(`[Wiki/Usage](${getWikiLink(module.name, false)})`);
    }

    commentBody.push(`- **\`${release.title}\`** • ${extra.join(' • ')}`);
  }

  // Branding
  if (config.disableBranding === false) {
    commentBody.push(`\n${BRANDING_COMMENT}`);
  }

  return commentBody.join('\n').trim();
}

/**
 * Best-effort lookup of this pull request's existing post-release comments.
 *
 * A listing failure is not fatal: the caller falls back to creating a new comment rather than failing
 * the merge over a comment that is only informational.
 *
 * @returns {Promise<PullRequestComment[]>} The matching comments, or an empty list if listing failed.
 */
async function findExistingPostReleaseComments(): Promise<PullRequestComment[]> {
  try {
    return await findReleaseComments();
  } catch (error) {
    warning(
      `Failed to list existing post-release comments; will create a new one: ${error instanceof Error ? error.message : String(error)}`,
    );

    return [];
  }
}

/**
 * Consolidates the post-release comment thread by removing older duplicates so only the most recent
 * remains.
 *
 * Each deletion is independent and best-effort: failing to remove a stale duplicate is cosmetic, so it
 * is warned about rather than allowed to fail the merge.
 *
 * @param {PullRequestComment[]} duplicates - The older comments to remove.
 * @returns {Promise<void>}
 */
async function deleteDuplicatePostReleaseComments(duplicates: PullRequestComment[]): Promise<void> {
  const {
    octokit,
    repo: { owner, repo },
  } = context;

  for (const comment of duplicates) {
    info(`Deleting duplicate post-release comment ${comment.id}`);
    try {
      await octokit.rest.issues.deleteComment({ owner, repo, comment_id: comment.id });
    } catch (error) {
      warning(
        `Failed to delete duplicate post-release comment ${comment.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * Adds a comment to the pull request with details about the releases attributed to this pull request.
 *
 * Takes {@link ReleaseOutcome}s rather than modules because a module's highest release is not
 * necessarily *this* pull request's release: once releases are self-healing, a re-run may skip a module
 * that a later pull request has since bumped past. Reporting `module.releases[0]` in that situation
 * would rewrite this pull request's own comment to cite another pull request's version, tag link and
 * release notes — and would do so again on every subsequent re-run, since the body never converges.
 *
 * @param {ReleaseOutcome[]} releaseOutcomes - What was created, recovered, or skipped for each module.
 * @returns {Promise<void>}
 */
export async function addPostReleaseComment(releaseOutcomes: ReleaseOutcome[]): Promise<void> {
  if (releaseOutcomes.length === 0) {
    info('No released modules. Skipping post release PR comment.');
    return;
  }

  console.time('Elapsed time commenting on pull request');
  startGroup('Adding pull request post-release comment');

  try {
    const {
      octokit,
      repo: { owner, repo },
      repoUrl,
      issueNumber: issue_number,
    } = context;

    const body = renderPostReleaseCommentBody(releaseOutcomes, repoUrl);

    // Idempotent: update the existing post-release comment in place rather than posting a duplicate on a
    // re-run. Editing keeps the comment's timeline position and sends no new email notification. The body
    // must reflect the full set of this pull request's released modules — note that the caller is
    // responsible for that completeness, since a re-run only processes modules that still need a
    // release (see `withPriorReleasesForThisPullRequest` in src/main.ts).
    const existingComments = await findExistingPostReleaseComments();
    const commentToKeep = existingComments.at(-1);

    if (!commentToKeep) {
      const { data: newComment } = await octokit.rest.issues.createComment({ owner, repo, issue_number, body });
      info(`Posted comment ${newComment.id} @ ${newComment.html_url}`);

      return;
    }

    if (commentToKeep.body.trim() === body) {
      info(`Post-release comment ${commentToKeep.id} is already up to date. Nothing to do.`);
    } else {
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: commentToKeep.id, body });
      info(`Updated post-release comment ${commentToKeep.id} in place.`);
    }

    await deleteDuplicatePostReleaseComments(existingComments.slice(0, -1));
  } catch (error) {
    if (error instanceof RequestError) {
      throw new Error(
        [
          `Failed to create a comment on the pull request: ${error.message} - Ensure that the`,
          'GitHub Actions workflow has the correct permissions to write comments. To grant the required permissions,',
          'update your workflow YAML file with the following block under "permissions":\n\npermissions:\n',
          ' pull-requests: write',
        ].join(' '),
        { cause: error },
      );
    }

    const errorMessage = error instanceof Error ? error.message.trim() : String(error).trim();
    throw new Error(`Failed to create a comment on the pull request: ${errorMessage}`, { cause: error });
  } finally {
    console.timeEnd('Elapsed time commenting on pull request');
    endGroup();
  }
}
