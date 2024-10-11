import { execFileSync } from 'node:child_process';
import type { ExecSyncOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { endGroup, info, startGroup } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import type { RequestError } from '@octokit/request-error';
import { getModuleChangelog, getPullRequestChangelog } from './changelog';
import { config } from './config';
import type { TerraformChangedModule } from './terraform-module';
import { WikiStatus } from './wiki';

export const GITHUB_ACTIONS_BOT_NAME = 'GitHub Actions';
export const GITHUB_ACTIONS_BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';

const github = getOctokit(config.githubToken);

export interface GitHubRelease {
  /**
   * The release ID
   */
  id: number;

  /**
   * The title of the release.
   */
  title: string;

  /**
   * The body content of the release.
   */
  body: string;
}

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
  const { owner, repo } = context.repo;

  try {
    const listCommitsResponse = await github.rest.pulls.listCommits({
      owner,
      repo,
      pull_number: config.prNumber,
    });

    // Iterate over the fetched commits to retrieve details and files
    return await Promise.all(
      listCommitsResponse.data.map(async (commit) => {
        const commitDetailsResponse = await github.rest.repos.getCommit({
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
  } catch (error) {
    const requestError = error as RequestError;
    // If we got a 403 because the pull request doesn't have permissions. Let's really help wrap this error
    // and make it clear to the consumer what actions need to be taken.
    if (requestError.status === 403) {
      throw new Error(
        `Unable to read and write pull requests due to insufficient permissions. ${
          config.isDefaultGithubActionsToken
            ? 'When using the default GITHUB_TOKEN, ensure the workflow permissions.pull-requests is set to "write".'
            : 'When using a Personal Access Token (PAT), ensure `repo` scope is specified.'
        }\n${requestError.message}`,
      );
    }

    throw error;
  }
};

/**
 * Fetches all tags from the specified GitHub repository.
 *
 * This function utilizes pagination to retrieve all tags, returning them as an array of strings.
 *
 * @returns {Promise<string[]>} A promise that resolves to an array of tag names.
 * @throws {RequestError} Throws an error if the request to fetch tags fails.
 */
export const getAllTags = async (): Promise<string[]> => {
  const { owner, repo } = context.repo;
  const tags: string[] = [];

  try {
    for await (const response of github.paginate.iterator(github.rest.repos.listTags, {
      owner,
      repo,
    })) {
      for (const tag of response.data) {
        tags.push(tag.name);
      }
    }
  } catch (error) {
    const requestError = error as RequestError;
    throw new Error(`Failed to fetch tags: ${requestError.message}`);
  }

  return tags;
};

/**
 * Retrieves all releases from the specified GitHub repository.
 *
 * This function fetches the list of releases for the repository specified in the configuration.
 * It returns the releases as an array of objects containing the title, body, and tag name.
 *
 * @returns {Promise<GitHubRelease[]>} A promise that resolves to an array of release details.
 * @throws {RequestError} Throws an error if the request to fetch releases fails.
 */
export const getAllReleases = async (): Promise<GitHubRelease[]> => {
  const { owner, repo } = context.repo;
  const releases: GitHubRelease[] = [];

  try {
    for await (const response of github.paginate.iterator(github.rest.repos.listReleases, {
      owner,
      repo,
    })) {
      for (const release of response.data) {
        releases.push({
          id: release.id,
          title: release.name || '', // same as tag as defined in our pull request for now (no need for tag)
          body: release.body || '',
        });
      }
    }
  } catch (error) {
    const requestError = error as RequestError;
    throw new Error(`Failed to fetch releases: ${requestError.message}`);
  }

  // Note: No need to sort currently as they by default return in indexed order with most recent first.

  return releases;
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
  startGroup('Commenting on pull request');

  const { owner, repo } = context.repo;
  const { number: issue_number } = context.issue;

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
  const { data: newComment } = await github.rest.issues.createComment({ issue_number, owner, repo, body: body.trim() });
  info(`Posted comment ${newComment.id} @ ${newComment.html_url}`);

  // Delete all our previous comments
  const { data: allComments } = await github.rest.issues.listComments({ issue_number, owner, repo });
  const ourComments = allComments
    .filter((comment) => comment.user?.login === 'github-actions[bot]')
    .filter((comment) => comment.body?.includes('Release Plan'));

  for (const comment of ourComments) {
    if (comment.id === newComment.id) {
      continue;
    }
    info(`Deleting previous PR comment from ${comment.created_at}`);
    await github.rest.issues.deleteComment({ comment_id: comment.id, owner, repo });
  }

  endGroup();
}

/**
 * Creates a GitHub release and corresponding git tag for the provided Terraform modules.
 *
 * Note: Requires GitHub action permissions > contents: write
 *
 * @param {TerraformChangedModule[]} terraformModules - An array of changed Terraform modules to process and create a release.
 * @returns {Promise<void>}
 */
export async function createTaggedRelease(terraformModules: TerraformChangedModule[]) {
  // Check if there are any modules to process
  if (terraformModules.length === 0) {
    info('No changed Terraform modules to process. Skipping tag/release creation.');
    return;
  }

  const { owner, repo } = context.repo;
  const { prBody, prTitle } = config;

  for (const module of terraformModules) {
    const { moduleName, directory, releaseType, nextTag, nextTagVersion } = module;
    const tmpDir = path.join(process.env.RUNNER_TEMP || '', 'tmp', moduleName);

    startGroup(`Creating release & tag for module: ${moduleName}`);
    info(`Release type: ${releaseType}`);
    info(`Next tag version: ${nextTag}`);

    // Create a temporary working directory
    fs.mkdirSync(tmpDir, { recursive: true });
    info(`Creating temp directory: ${tmpDir}`);

    // Copy the module's contents to the temporary directory (along with .git)
    fs.cpSync(directory, tmpDir, { recursive: true });
    fs.cpSync(path.join(config.workspaceDir, '.git'), path.join(tmpDir, '.git'), { recursive: true });

    // Switch to the temporary directory
    // process.chdir(tmpDir);
    const gitOpts: ExecSyncOptions = { cwd: tmpDir }; // Lots of adds and deletions here so don't inherit

    // Git operations: commit the changes and tag the release. Wrap the error message here
    try {
      const commitMessage = `${nextTag}\n\n${prTitle}\n\n${prBody}`.trim();

      execFileSync('git', ['config', '--local', 'user.name', GITHUB_ACTIONS_BOT_NAME], gitOpts);
      execFileSync('git', ['config', '--local', 'user.email', GITHUB_ACTIONS_BOT_EMAIL], gitOpts);
      execFileSync('git', ['add', '.'], gitOpts);
      execFileSync('git', ['commit', '-m', commitMessage.trim()], gitOpts);
      execFileSync('git', ['tag', nextTag], gitOpts);
      execFileSync('git', ['push', 'origin', nextTag], gitOpts);

      // Create a GitHub release using the tag
      info(`Creating GitHub release for ${moduleName}@${nextTag}`);
      const body = getModuleChangelog(module);
      const response = await github.rest.repos.createRelease({
        owner,
        repo,
        tag_name: nextTag,
        name: nextTag,
        body,
        draft: false,
        prerelease: false,
      });

      // Now update the module with latest tag and release information
      module.latestTag = nextTag;
      module.latestTagVersion = nextTagVersion;
      module.tags.unshift(nextTag); // Prepend the latest tag
      module.releases.unshift({
        id: response.data.id,
        title: nextTag,
        body,
      });

      endGroup();
    } catch (error) {
      const gitError = error as Error;

      if (gitError.message.includes('The requested URL returned error: 403')) {
        throw new Error(
          `Unable to create repository tag due to insufficient permissions. ${
            config.isDefaultGithubActionsToken
              ? 'When using the default GITHUB_TOKEN, ensure the workflow permissions.contents is set to "write".'
              : 'When using a Personal Access Token (PAT), ensure `repo` scope is specified.'
          }\n${gitError.message}`,
        );
      }

      throw gitError;
    } finally {
      // Let's clean up the temp directory to help with any security concerns
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

/**
 * Deletes legacy Terraform module tags and releases.
 *
 * This function takes an array of Terraform module names, all tags, and all releases,
 * and deletes the tags and releases that match the format {moduleName}/vX.Y.Z.
 *
 * @param {string[]} terraformModuleNames - An array of Terraform module names to delete.
 * @param {string[]} allTags - An array of all tags in the repository.
 * @param {GitHubRelease[]} allReleases - An array of all releases in the repository.
 * @returns {Promise<void>}
 */
export async function deleteLegacyTerraformModuleTagsAndReleases(
  terraformModuleNames: string[],
  allTags: string[],
  allReleases: GitHubRelease[],
) {
  startGroup('Deleting legacy Terraform module tags and releases');

  if (!config.deleteLegacyTags) {
    info('Deletion of legacy tags and releases is disabled. Skipping.');
    endGroup();
    return;
  }

  const { owner, repo } = context.repo;

  // Filter tags that match the format {moduleName} or {moduleName}/vX.Y.Z
  const tagsToDelete = allTags.filter((tag) => {
    return terraformModuleNames.some((name) => new RegExp(`^${name}(?:/v\\d+\\.\\d+\\.\\d+)?$`).test(tag));
  });

  // Filter releases that match the format {moduleName} or {moduleName}/vX.Y.Z
  const releasesToDelete = allReleases.filter((release) => {
    return terraformModuleNames.some((name) => new RegExp(`^${name}(?:/v\\d+\\.\\d+\\.\\d+)?$`).test(release.title));
  });

  // Note: We could parallelize this; however, due to Github limits it's probably best to just
  // do this serially as it's also indepoendent of the other operations and can be re-ran
  // as necessary.

  // Delete tags
  for (const tag of tagsToDelete) {
    info(`Deleting tag: ${tag}`);
    try {
      await github.rest.git.deleteRef({
        owner,
        repo,
        ref: `tags/${tag}`,
      });
    } catch (error) {
      const requestError = error as RequestError;
      throw new Error(`Failed to delete tag: ${requestError.message}`);
    }
  }

  // Delete releases
  for (const release of releasesToDelete) {
    info(`Deleting release: ${release.title}`);
    try {
      await github.rest.repos.deleteRelease({
        owner,
        repo,
        release_id: release.id,
      });
    } catch (error) {
      const requestError = error as RequestError;
      throw new Error(`Failed to delete release: ${requestError.message}`);
    }
  }

  endGroup();
}
