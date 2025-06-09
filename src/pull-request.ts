import { getPullRequestChangelog } from '@/changelog';
import { config } from '@/config';
import { context } from '@/context';
import { TerraformModule } from '@/terraform-module';
import type { CommitDetails, GitHubRelease, WikiStatusResult } from '@/types';
import {
  BRANDING_COMMENT,
  GITHUB_ACTIONS_BOT_USER_ID,
  PROJECT_URL,
  PR_RELEASE_MARKER,
  PR_SUMMARY_MARKER,
  WIKI_STATUS,
} from '@/utils/constants';

import { getWikiLink } from '@/wiki';
import { debug, endGroup, info, startGroup } from '@actions/core';
import { RequestError } from '@octokit/request-error';

/**
 * Checks whether the pull request already has a comment containing the release marker.
 *
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
    const iterator = octokit.paginate.iterator(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number,
    });

    for await (const { data } of iterator) {
      for (const comment of data) {
        if (comment.user?.id === GITHUB_ACTIONS_BOT_USER_ID && comment.body?.includes(PR_RELEASE_MARKER)) {
          return true;
        }
      }
    }

    return false;
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
    /* c8 ignore next */
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

    if (wikiStatus.status === WIKI_STATUS.FAILURE) {
      commentBody.push('\n# ⚠️ Release Plan\n');
      commentBody.push('> ⚠️ **IMPORTANT**: _See Wiki Status error below._\n');
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
        // Prevent module name from wrapping on hyphens in table cells (Doesn't work reliabily)
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
      case WIKI_STATUS.FAILURE:
        commentBody.push('**⚠️ Failed to checkout wiki:**');
        commentBody.push('```');
        commentBody.push(`${wikiStatus.errorSummary}`);
        commentBody.push('```');
        commentBody.push(
          `Please consult the [README.md](${PROJECT_URL}/blob/main/README.md#getting-started) for additional information (**Ensure the Wiki is initialized**).`,
        );
        break;
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
        commentBody.push(
          `**⚠️ The following ${releasesToDelete.length === 1 ? 'release is' : 'releases are'} no longer referenced by any source Terraform modules. ${releasesToDelete.length === 1 ? 'It' : 'They'} will be automatically deleted.**`,
        );
        commentBody.push(` - ${releasesToDelete.map((release) => `\`${release.title}\``).join(', ')}`);
      }

      if (tagsToDelete.length > 0) {
        // Add an extra newline if we already added releases content
        if (releasesToDelete.length > 0) {
          commentBody.push('');
        }

        commentBody.push(
          `**⚠️ The following ${tagsToDelete.length === 1 ? 'tag is' : 'tags are'} no longer referenced by any source Terraform modules. ${tagsToDelete.length === 1 ? 'It' : 'They'} will be automatically deleted.**`,
        );
        commentBody.push(` - ${tagsToDelete.map((tag) => `\`${tag}\``).join(', ')}`);
      }
    }

    // Branding
    if (config.disableBranding === false) {
      commentBody.push(`\n${BRANDING_COMMENT}`);
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
 * Adds a comment to the pull request with details about the releases created as specified via the
 * releasedTerraformModules.
 *
 * @param {TerraformModule[]} releasedTerraformModules - Array of released/updated Terraform modules.
 * @returns {Promise<void>}
 */
export async function addPostReleaseComment(releasedTerraformModules: TerraformModule[]): Promise<void> {
  if (releasedTerraformModules.length === 0) {
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

    // Contruct the comment body as an array of strings
    const commentBody: string[] = [
      PR_RELEASE_MARKER,
      '\n## :rocket: Terraform Module Releases\n',
      'The following Terraform modules have been released:\n',
    ];

    for (const terraformModule of releasedTerraformModules) {
      const latestRelease: GitHubRelease = terraformModule.releases[0];
      const extra = [`[Release Notes](${repoUrl}/releases/tag/${latestRelease.tagName})`];
      if (config.disableWiki === false) {
        extra.push(`[Wiki/Usage](${getWikiLink(terraformModule.name, false)})`);
      }

      commentBody.push(`- **\`${latestRelease.title}\`** • ${extra.join(' • ')}`);
    }

    // Branding
    if (config.disableBranding === false) {
      commentBody.push(`\n${BRANDING_COMMENT}`);
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
