import { debug, endGroup, info, startGroup } from '@actions/core';
import { RequestError } from '@octokit/request-error';
import { getPullRequestChangelog } from './changelog';
import { config } from './config';
import { PR_RELEASE_MARKER, PR_SUMMARY_MARKER } from './constants';
import { context } from './context';
import type { GitHubRelease } from './releases';
import type { TerraformChangedModule } from './terraform-module';
import { WikiStatus, getWikiLink } from './wiki';

export interface CommitDetails {
  /**
   * The commit message.
   */
  message: string;

  /**
   * The SHA-1 hash of the commit.
   */
  sha: string;

  /**
   * An array of relative file paths associated with the commit.
   */
  files: string[];
}

/**
 * Checks whether the pull request already has a comment containing the release marker.
 *
 * @param {string} releaseMarker - The release marker to look for in the comments (e.g., PR_RELEASE_MARKER).
 * @returns {Promise<boolean>} - Returns true if a comment with the release marker is found, false otherwise.
 */
export async function hasReleaseComment(): Promise<boolean> {
  try {
    const {
      octokit,
      repo: { owner, repo },
      issueNumber: issue_number,
    } = context;

    // Fetch all comments on the pull request
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number,
    });

    // Check if any comment contains the release marker
    return comments.some((comment) => comment.body?.includes(PR_RELEASE_MARKER));
  } catch (error) {
    const requestError = error as RequestError;
    // If we got a 403 because the pull request doesn't have permissions. Let's really help wrap this error
    // and make it clear to the consumer what actions need to be taken.
    if (requestError.status === 403) {
      throw new Error(
        `Unable to read and write pull requests due to insufficient permissions. Ensure the workflow permissions.pull-requests is set to "write".\n${requestError.message}`,
        { cause: error },
      );
    }

    throw new Error(`Error checking PR comments: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

/**
 * Retrieves the commits associated with a specific pull request.
 *
 * This function fetches the list of commits for the pull request specified in the configuration
 * (from the context), and then retrieves detailed information about each commit, including
 * the commit message, SHA, and the relative file paths associated with the commit.
 *
 * @returns {Promise<CommitDetails[]>} A promise that resolves to an array of commit details,
 *                                       each containing the message, SHA, and associated file paths.
 * @throws {RequestError} Throws an error if the request to fetch commits fails or if permissions
 *                       are insufficient to read the pull request.
 */
export async function getPullRequestCommits(): Promise<CommitDetails[]> {
  console.time('Elapsed time fetching commits'); // Start timing
  startGroup('Fetching pull request commits');

  try {
    const {
      octokit,
      repo: { owner, repo },
      prNumber: pull_number,
    } = context;

    const listCommitsResponse = await octokit.rest.pulls.listCommits({ owner, repo, pull_number });

    // Iterate over the fetched commits to retrieve details and files
    const commits = await Promise.all(
      listCommitsResponse.data.map(async (commit) => {
        const commitDetailsResponse = await octokit.rest.repos.getCommit({
          owner,
          repo,
          ref: commit.sha,
        });

        // Retrieve the list of files for the commit
        const files = commitDetailsResponse.data.files?.map((file) => file.filename) ?? [];

        return {
          message: commit.commit.message,
          sha: commit.sha,
          files,
        };
      }),
    );

    info(`Found ${commits.length} commit${commits.length !== 1 ? 's' : ''}.`);
    debug(JSON.stringify(commits, null, 2));

    return commits;
  } catch (error) {
    const requestError = error as RequestError;
    // If we got a 403 because the pull request doesn't have permissions. Let's really help wrap this error
    // and make it clear to the consumer what actions need to be taken.
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
 * including details about the release plan and any modules that will be removed from the Wiki.
 *
 * This function constructs a markdown table displaying the release plan for changed Terraform modules,
 * noting their release types and versions. It also handles modules that are no longer present in the source
 * and will be removed from the Wiki upon release.
 *
 * @param {TerraformChangedModule[]} terraformChangedModules - An array of objects representing the
 * changed Terraform modules. Each object should contain the following properties:
 *   - {string} moduleName - The name of the Terraform module.
 *   - {string | null} currentTagVersion - The previous version of the module (or null if this is the initial release).
 *   - {string} nextTagVersion - The new version of the module to be released.
 *   - {string} releaseType - The type of release (e.g., major, minor, patch).
 *
 * @param {string[]} terraformModuleNamesToRemove - An array of module names that should be removed if
 * specified to remove via config.
 *
 * @param {WikiStatus} wikiStatus - The status of the Wiki check (success, failure, or disabled) and
 *                                  any relevant error messages if applicable.
 *
 * @returns {Promise<void>} A promise that resolves when the comment has been posted and previous
 * comments have been deleted.
 *
 * @throws {Error} Throws an error if the GitHub API call to create a comment or delete existing comments fails.
 */
export async function addReleasePlanComment(
  terraformChangedModules: TerraformChangedModule[],
  terraformModuleNamesToRemove: string[],
  wikiStatus: { status: WikiStatus; errorMessage?: string | undefined },
): Promise<void> {
  console.time('Elapsed time commenting on pull request');
  startGroup('Adding pull request release plan comment');

  try {
    const {
      octokit,
      repo: { owner, repo },
      issueNumber: issue_number,
    } = context;

    // Initialize the comment body as an array of strings
    const commentBody: string[] = [PR_SUMMARY_MARKER, '\n# Release Plan\n'];

    // Changed Modules
    if (terraformChangedModules.length === 0) {
      commentBody.push('No terraform modules updated in this pull request.');
    } else {
      commentBody.push('| Module | Release Type | Latest Version | New Version |', '|--|--|--|--|');
      for (const { moduleName, latestTagVersion, nextTagVersion, releaseType } of terraformChangedModules) {
        const initialRelease = latestTagVersion == null;
        const existingVersion = initialRelease ? 'initial' : releaseType;
        const latestTagDisplay = initialRelease ? '' : latestTagVersion;
        commentBody.push(`| \`${moduleName}\` | ${existingVersion} | ${latestTagDisplay} | **${nextTagVersion}** |`);
      }
    }

    // Wiki Check
    switch (wikiStatus.status) {
      case WikiStatus.SUCCESS:
        commentBody.push(
          '\n> #### ✅ Wiki Check <sup><a href="#" title="Wiki enabled and CI can checkout wiki repo">ℹ️</a></sup>',
        );
        break;
      case WikiStatus.FAILURE:
        commentBody.push(
          `\n> #### ⚠️ Wiki Check: Failed to checkout wiki. ${wikiStatus.errorMessage}<br><br>Please consult the README for additional information and review logs in the latest GitHub workflow run.`,
        );
        break;
      case WikiStatus.DISABLED:
        commentBody.push('\n> ##### 🚫 Wiki Check: Generation is disabled.');
        break;
    }

    // Modules to Remove
    if (terraformModuleNamesToRemove.length > 0) {
      commentBody.push(
        `\n> **Note**: The following Terraform modules no longer exist in source; however, corresponding tags/releases exist.${
          config.deleteLegacyTags
            ? ' Automation tag/release deletion is **enabled** and corresponding tags/releases will be automatically deleted.<br>'
            : ' Automation tag/release deletion is **disabled** — **no** subsequent action will take place.<br>'
        }`,
      );
      commentBody.push(terraformModuleNamesToRemove.map((moduleName) => `\`${moduleName}\``).join(', '));
    }

    // Changelog
    if (terraformChangedModules.length > 0) {
      commentBody.push('\n# Changelog\n', getPullRequestChangelog(terraformChangedModules));
    }

    // Create new PR comment (Requires permission > pull-requests: write)
    const { data: newComment } = await octokit.rest.issues.createComment({
      issue_number,
      owner,
      repo,
      body: commentBody.join('\n').trim(),
    });
    info(`Posted comment ${newComment.id} @ ${newComment.html_url}`);

    // Filter out the comments that contain the PR summary marker and are not the current comment
    const { data: allComments } = await octokit.rest.issues.listComments({ issue_number, owner, repo });
    const commentsToDelete = allComments.filter(
      (comment) => comment.body?.includes(PR_SUMMARY_MARKER) && comment.id !== newComment.id,
    );

    // Delete all our previous comments
    for (const comment of commentsToDelete) {
      info(`Deleting previous PR comment from ${comment.created_at}`);
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
 * Posts a PR comment with details about the releases created for the Terraform modules.
 *
 * @param {Array<{ moduleName: string; release: GitHubRelease }>} updatedModules - An array of updated Terraform modules with release information.
 * @returns {Promise<void>}
 */
export async function addPostReleaseComment(
  updatedModules: { moduleName: string; release: GitHubRelease }[],
): Promise<void> {
  if (updatedModules.length === 0) {
    info('No updated modules. Skipping post release PR comment.');
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

    // Contruct the comment body as an array of strings
    const commentBody: string[] = [
      PR_RELEASE_MARKER,
      '\n## :rocket: Terraform Module Releases\n',
      'The following Terraform modules have been released:\n',
    ];

    for (const { moduleName, release } of updatedModules) {
      const extra = [`[Release Notes](${repoUrl}/releases/tag/${release.title})`];
      if (config.disableWiki === false) {
        extra.push(`[Wiki/Usage](${getWikiLink(moduleName, false)})`);
      }

      commentBody.push(`- **\`${release.title}\`** • ${extra.join(' • ')}`);
    }

    // Post the comment on the pull request
    const { data: newComment } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number,
      body: commentBody.join('\n').trim(),
    });
    info(`Posted comment ${newComment.id} @ ${newComment.html_url}`);
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
