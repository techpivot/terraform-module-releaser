import { debug, endGroup, info, startGroup } from '@actions/core';
import { RequestError } from '@octokit/request-error';
import { getPullRequestChangelog } from './changelog';
import { config } from './config';
import { context } from './context';
import type { TerraformChangedModule } from './terraform-module';
import { WikiStatus } from './wiki';

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
 * Retrieves the commits associated with a specific pull request.
 *
 * This function fetches the list of commits for the pull request specified in the configuration.
 * It then retrieves detailed information about each commit, including the commit message, SHA,
 * and the relative file paths associated with the commit.
 *
 * @returns {Promise<CommitDetails[]>} A promise that resolves to an array of commit details,
 *                                       each containing the message, SHA, and associated file paths.
 * @throws {RequestError} Throws an error if the request to fetch commits fails or if permissions
 *                       are insufficient to read the pull request.
 */
export const getPullRequestCommits = async (): Promise<CommitDetails[]> => {
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
      );
    }
    throw error;
  } finally {
    console.timeEnd('Elapsed time fetching commits');
    endGroup();
  }
};

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
 *   - {string | null} currentTagVersion - The previous version of the module (or null if initial).
 *   - {string} nextTagVersion - The new version of the module to be released.
 *   - {string} releaseType - The type of release (e.g., major, minor, patch).
 *
 * @param {string[]} terraformModuleNamesToRemove - An array of module names that should be removed if
 * specified to remove via config.
 *
 * @returns {Promise<void>} A promise that resolves when the comment has been posted and previous
 * comments have been deleted.
 *
 * @throws {Error} Throws an error if the GitHub API call to create a comment or delete existing comments fails.
 */
export async function commentOnPullRequest(
  terraformChangedModules: TerraformChangedModule[],
  terraformModuleNamesToRemove: string[],
  wikiStatus: { status: WikiStatus; errorMessage?: string | undefined },
): Promise<void> {
  console.time('Elapsed time commenting on pull request');
  startGroup('Commenting on pull request');

  try {
    const {
      octokit,
      repo: { owner, repo },
      issueNumber: issue_number,
    } = context;

    const lines = ['# Release Plan', '', '| Module | Release Type | Latest Version | New Version |', '|--|--|--|--|'];

    for (const { moduleName, latestTagVersion, nextTagVersion, releaseType } of terraformChangedModules) {
      lines.push(
        `| ${[`\`${moduleName}\``, latestTagVersion == null ? 'initial' : releaseType, latestTagVersion, `**${nextTagVersion}**`].join(' | ')} |`,
      );
    }

    // Get the modules to remove
    let modulesToRemove = '';
    if (terraformModuleNamesToRemove.length > 0) {
      modulesToRemove =
        '> **Note**: The following Terraform modules no longer exist in source; howevever corresponding tags/releases exist.';
      if (config.deleteLegacyTags) {
        modulesToRemove +=
          ' Automation tag/release deletion is **enabled** and corresponding tags/releases will be automatically deleted.';
      } else {
        modulesToRemove += ' Automation tag/release deletion is **disabled** and no subsequent action will take place.';
      }
      modulesToRemove += `\n${terraformModuleNamesToRemove.map((moduleName) => `> - \`${moduleName}\``).join('\n')}`;
      modulesToRemove += '\n\n';
    }

    let wikiMessage = '';
    switch (wikiStatus.status) {
      case WikiStatus.SUCCESS:
        wikiMessage = '> ###### ✅ Wiki Check\n\n';
        break;
      case WikiStatus.FAILURE:
        wikiMessage = `> ##### ⚠️ Wiki Check: Failed to checkout wiki. ${wikiStatus.errorMessage}<br><br>Please consult the README for additional information and review logs in the latest GitHub workflow run.\n\n`;
        break;
      case WikiStatus.DISABLED:
        wikiMessage = '> ###### 🚫 Wiki Check: Generation is disabled.\n\n';
        break;
    }

    let body: string;
    // Let's update the body depending on how many modules we have
    if (terraformChangedModules.length === 0) {
      body = `# Release Plan\n\nNo terraform modules updated in this pull request.\n\n${wikiMessage}${modulesToRemove}`;
    } else {
      const changelog = getPullRequestChangelog(terraformChangedModules);
      body = `${lines.join('\n')}\n\n${wikiMessage}${modulesToRemove}# Changelog\n\n${changelog}`;
    }

    // Create new PR comment (Requires permission > pull-requests: write)
    const { data: newComment } = await octokit.rest.issues.createComment({
      issue_number,
      owner,
      repo,
      body: body.trim(),
    });
    info(`Posted comment ${newComment.id} @ ${newComment.html_url}`);

    // Delete all our previous comments
    const { data: allComments } = await octokit.rest.issues.listComments({ issue_number, owner, repo });
    const ourComments = allComments
      .filter((comment) => comment.user?.login === 'github-actions[bot]')
      .filter((comment) => comment.body?.includes('Release Plan'));

    for (const comment of ourComments) {
      if (comment.id === newComment.id) {
        continue;
      }
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
      );
    }

    const errorMessage = error instanceof Error ? error.message.trim() : String(error).trim();
    throw new Error(`Failed to create a comment on the pull request: ${errorMessage}`);
  } finally {
    console.timeEnd('Elapsed time commenting on pull request');
    endGroup();
  }
}
