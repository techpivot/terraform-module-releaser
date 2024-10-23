import { execFileSync } from 'node:child_process';
import type { ExecSyncOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { debug, endGroup, info, startGroup } from '@actions/core';
import { RequestError } from '@octokit/request-error';
import { getModuleChangelog } from './changelog';
import { config } from './config';
import { GITHUB_ACTIONS_BOT_EMAIL, GITHUB_ACTIONS_BOT_NAME } from './constants';
import { context } from './context';
import type { TerraformChangedModule } from './terraform-module';

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

/**
 * Retrieves all releases from the specified GitHub repository.
 *
 * This function fetches the list of releases for the repository specified in the configuration.
 * It returns the releases as an array of objects containing the title, body, and tag name.
 *
 * @returns {Promise<GitHubRelease[]>} A promise that resolves to an array of release details.
 * @throws {RequestError} Throws an error if the request to fetch releases fails.
 */
export async function getAllReleases(): Promise<GitHubRelease[]> {
  console.time('Elapsed time fetching releases'); // Start timing
  startGroup('Fetching repository releases');

  try {
    const {
      octokit,
      repo: { owner, repo },
    } = context;

    const releases: GitHubRelease[] = [];

    for await (const response of octokit.paginate.iterator(octokit.rest.repos.listReleases, {
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

    info(`Found ${releases.length} releases${releases.length !== 1 ? 's' : ''}.`);
    debug(JSON.stringify(releases, null, 2));

    // Note: No need to sort currently as they by default return in indexed order with most recent first.
    return releases;
  } catch (error) {
    let errorMessage: string;
    if (error instanceof RequestError) {
      errorMessage = `Failed to fetch releases: ${error.message.trim()} (status: ${error.status})`;
    } else if (error instanceof Error) {
      errorMessage = `Failed to fetch releases: ${error.message.trim()}`;
    } else {
      errorMessage = String(error).trim();
    }

    throw new Error(errorMessage, { cause: error });
  } finally {
    console.timeEnd('Elapsed time fetching releases');
    endGroup();
  }
}

/**
 * Creates a GitHub release and corresponding git tag for the provided Terraform modules.
 *
 * Note: Requires GitHub action permissions > contents: write
 *
 * @param {TerraformChangedModule[]} terraformChangedModules - An array of changed Terraform modules to process and create a release.
 * @returns {Promise<{ moduleName: string; release: GitHubRelease }[]>}
 */
export async function createTaggedRelease(
  terraformChangedModules: TerraformChangedModule[],
): Promise<{ moduleName: string; release: GitHubRelease }[]> {
  // Check if there are any modules to process
  if (terraformChangedModules.length === 0) {
    info('No changed Terraform modules to process. Skipping tag/release creation.');
    return [];
  }

  const {
    octokit,
    repo: { owner, repo },
    prBody,
    prTitle,
    workspaceDir,
  } = context;

  console.time('Elapsed time pushing new tags & release');
  startGroup('Creating releases & tags for modules');

  const updatedModules: { moduleName: string; release: GitHubRelease }[] = [];

  try {
    for (const module of terraformChangedModules) {
      const { moduleName, directory, releaseType, nextTag, nextTagVersion } = module;
      const tmpDir = path.join(process.env.RUNNER_TEMP || '', 'tmp', moduleName);

      info(`Release type: ${releaseType}`);
      info(`Next tag version: ${nextTag}`);

      // Create a temporary working directory
      fs.mkdirSync(tmpDir, { recursive: true });
      info(`Creating temp directory: ${tmpDir}`);

      // Copy the module's contents to the temporary directory (along with .git)
      fs.cpSync(directory, tmpDir, { recursive: true });
      fs.cpSync(path.join(workspaceDir, '.git'), path.join(tmpDir, '.git'), { recursive: true });

      const gitOpts: ExecSyncOptions = { cwd: tmpDir }; // Lots of adds and deletions here so don't inherit

      // Git operations: commit the changes and tag the release
      const commitMessage = `${nextTag}\n\n${prTitle}\n\n${prBody}`.trim();

      execFileSync('/usr/bin/git', ['config', '--local', 'user.name', GITHUB_ACTIONS_BOT_NAME], gitOpts);
      execFileSync('/usr/bin/git', ['config', '--local', 'user.email', GITHUB_ACTIONS_BOT_EMAIL], gitOpts);
      execFileSync('/usr/bin/git', ['add', '.'], gitOpts);
      execFileSync('/usr/bin/git', ['commit', '-m', commitMessage.trim()], gitOpts);
      execFileSync('/usr/bin/git', ['tag', nextTag], gitOpts);
      execFileSync('/usr/bin/git', ['push', 'origin', nextTag], gitOpts);

      // Create a GitHub release using the tag
      info(`Creating GitHub release for ${moduleName}@${nextTag}`);
      const body = getModuleChangelog(module);
      const response = await octokit.rest.repos.createRelease({
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
      const release = {
        id: response.data.id,
        title: nextTag,
        body,
      };
      module.releases.unshift(release);

      updatedModules.push({ moduleName, release });
    }

    return updatedModules;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle GitHub permissions or any error related to pushing tags
    if (errorMessage.includes('The requested URL returned error: 403')) {
      throw new Error(
        [
          `Failed to create tags in repository: ${errorMessage} - Ensure that the`,
          'GitHub Actions workflow has the correct permissions to create tags. To grant the required permissions,',
          'update your workflow YAML file with the following block under "permissions":\n\npermissions:\n',
          ' contents: write',
        ].join(' '),
        { cause: error },
      );
    }

    throw new Error(`Failed to create tags in repository: ${errorMessage}`, { cause: error });
  } finally {
    // Cleanup: remove the temp directory
    console.timeEnd('Elapsed time pushing new tags & release');
    endGroup();
  }
}

/**
 * Deletes legacy Terraform module releases.
 *
 * This function takes an array of module names and all releases,
 * and deletes the releases that match the format {moduleName}/vX.Y.Z.
 *
 * @param {string[]} terraformModuleNames - Array of Terraform module names to delete.
 * @param {GitHubRelease[]} allReleases - Array of all releases in the repository.
 * @returns {Promise<void>}
 */
export async function deleteLegacyReleases(
  terraformModuleNames: string[],
  allReleases: GitHubRelease[],
): Promise<void> {
  if (!config.deleteLegacyTags) {
    info('Deletion of legacy tags/releases is disabled. Skipping.');
    return;
  }

  startGroup('Deleting legacy Terraform module releases');

  // Filter releases that match the format {moduleName} or {moduleName}/vX.Y.Z
  const releasesToDelete = allReleases.filter((release) => {
    return terraformModuleNames.some((name) => new RegExp(`^${name}(?:/v\\d+\\.\\d+\\.\\d+)?$`).test(release.title));
  });

  if (releasesToDelete.length === 0) {
    info('No legacy releases found to delete. Skipping.');
    endGroup();
    return;
  }

  info(`Found ${releasesToDelete.length} legacy release${releasesToDelete.length !== 1 ? 's' : ''} to delete.`);
  info(
    JSON.stringify(
      releasesToDelete.map((release) => release.title),
      null,
      2,
    ),
  );

  console.time('Elapsed time deleting legacy releases');

  const {
    octokit,
    repo: { owner, repo },
  } = context;

  let releaseTitle = '';
  try {
    for (const { title, id: release_id } of releasesToDelete) {
      releaseTitle = title;
      info(`Deleting release: ${title}`);
      await octokit.rest.repos.deleteRelease({ owner, repo, release_id });
    }
  } catch (error) {
    const requestError = error as RequestError;
    if (requestError.status === 403) {
      throw new Error(
        [
          `Failed to delete release: ${releaseTitle} ${requestError.message}.\nEnsure that the`,
          'GitHub Actions workflow has the correct permissions to delete releases by ensuring that',
          'your workflow YAML file has the following block under "permissions":\n\npermissions:\n',
          ' contents: write',
        ].join(' '),
        { cause: error },
      );
    }
    throw new Error(`Failed to delete release: [Status = ${requestError.status}] ${requestError.message}`, {
      cause: error,
    });
  } finally {
    console.timeEnd('Elapsed time deleting legacy releases');
    endGroup();
  }
}
