import { type ExecSyncOptions, execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTerraformModuleChangelog } from '@/changelog';
import { config } from '@/config';
import { context } from '@/context';
import { TerraformModule } from '@/terraform-module';
import type { GitHubRelease } from '@/types';
import { GITHUB_ACTIONS_BOT_NAME } from '@/utils/constants';
import { copyModuleContents } from '@/utils/file';
import { configureGitAuthentication, getGitHubActionsBotEmail } from '@/utils/github';
import { debug, endGroup, info, startGroup } from '@actions/core';
import type { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods';
import { RequestError } from '@octokit/request-error';
import which from 'which';

type ListReleasesParams = Omit<RestEndpointMethodTypes['repos']['listReleases']['parameters'], 'owner' | 'repo'>;

/**
 * Retrieves all releases from the specified GitHub repository.
 *
 * This function fetches the list of releases for the repository specified in the configuration.
 * It returns the releases as an array of objects containing the title, body, and tag name.
 *
 * @param {ListReleasesParams} options - Optional configuration for the API request
 * @returns {Promise<GitHubRelease[]>} A promise that resolves to an array of release details.
 * @throws {RequestError} Throws an error if the request to fetch releases fails.
 */
export async function getAllReleases(
  options: ListReleasesParams = { per_page: 100, page: 1 },
): Promise<GitHubRelease[]> {
  console.time('Elapsed time fetching releases'); // Start timing
  startGroup('Fetching repository releases');

  try {
    const {
      octokit,
      repo: { owner, repo },
    } = context;

    const releases: GitHubRelease[] = [];
    let totalRequests = 0;

    const iterator = octokit.paginate.iterator(octokit.rest.repos.listReleases, {
      ...options,
      owner,
      repo,
    });
    for await (const { data } of iterator) {
      totalRequests++;

      for (const release of data) {
        releases.push({
          id: release.id,
          title: release.name ?? '', // We'll keep release titles the same as tags for now
          body: release.body ?? '',
          tagName: release.tag_name,
        });
      }
    }

    debug(`Total page requests: ${totalRequests}`);
    info(`Found ${releases.length} release${releases.length !== 1 ? 's' : ''}.`);
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
    /* c8 ignore next */
  } finally {
    console.timeEnd('Elapsed time fetching releases');
    endGroup();
  }
}

/**
 * Creates a GitHub release and corresponding git tag for each Terraform modules that needs a release.
 *
 * Note: Requires GitHub action permissions > contents: write
 *
 * @param {TerraformModule[]} terraformModules - An array of Terraform module objects containing
 *  module metadata, version information, and release status.
 * @returns {Promise<TerraformModule[]>} Updated TerraformModule instances with new releases and tags
 */
export async function createTaggedReleases(terraformModules: TerraformModule[]): Promise<TerraformModule[]> {
  const terraformModulesToRelease = TerraformModule.getModulesNeedingRelease(terraformModules);

  // Check if there are any modules to process
  if (terraformModulesToRelease.length === 0) {
    info('No changed Terraform modules to process. Skipping tag/release creation.');
    return [];
  }

  // We can be sure based on our type definitions that each module now is a module that
  // needs to be released. It has GitHub commits.

  const {
    octokit,
    repo: { owner, repo },
    prBody,
    prTitle,
    workspaceDir,
  } = context;

  console.time('Elapsed time pushing new tags & release');
  startGroup('Creating releases & tags for modules');

  try {
    for (const module of terraformModulesToRelease) {
      const moduleName = module.name;
      const releaseTag = module.getReleaseTag() as string;
      const releaseTagVersion = module.getReleaseTagVersion() as string;
      info(`Processing module: ${moduleName}`);
      info(`Release type: ${module.getReleaseType()}`);
      info(`Next tag version: ${releaseTagVersion}`);

      // Create a temporary working directory
      // Replace '/' with '-' to create a valid directory name
      const fileSystemSafeModuleName = module.name.replace(/\//g, '-');
      const tmpDir = mkdtempSync(join(tmpdir(), `${fileSystemSafeModuleName}-`));
      info(`Created temp directory: ${tmpDir}`);

      // Copy the module's contents to the temporary directory, excluding specified patterns
      copyModuleContents(module.directory, tmpDir, config.moduleAssetExcludePatterns);

      // Copy the module's .git directory
      cpSync(join(workspaceDir, '.git'), join(tmpDir, '.git'), { recursive: true });

      // Git operations: commit the changes and tag the release
      const commitMessage = `${module.getReleaseTag()}\n\n${prTitle}\n\n${prBody}`.trim();
      const gitPath = await which('git');
      const githubActionsBotEmail = await getGitHubActionsBotEmail();

      // Execute git commands in temp directory without inheriting stdio to avoid output pollution
      const gitOpts: ExecSyncOptions = { cwd: tmpDir };

      // Configure Git authentication
      configureGitAuthentication(gitPath, gitOpts);

      for (const cmd of [
        ['config', '--local', 'user.name', GITHUB_ACTIONS_BOT_NAME],
        ['config', '--local', 'user.email', githubActionsBotEmail],
        ['checkout', '-b', `_branch/${moduleName}`],
        ['add', '.'],
        ['commit', '-m', commitMessage.trim()],
        ['push', '-f', 'origin', `_branch/${moduleName}`],
        ['tag', releaseTag],
        ['push', 'origin', releaseTag],
      ]) {
        info(`Executing git command: ${cmd.join(' ')}`);
        execFileSync(gitPath, cmd, gitOpts);
      }

      // Store the commit SHA that the tag points to (since it's not returned from the API via create release)
      const commitSHA = execFileSync(gitPath, ['rev-parse', 'HEAD'], gitOpts).toString().trim();

      // Create a GitHub release using the tag
      info(`Creating GitHub release for ${moduleName}@${releaseTagVersion}`);
      const body = createTerraformModuleChangelog(module);

      const response = await octokit.rest.repos.createRelease({
        owner,
        repo,
        tag_name: releaseTag, // For now we keep these the same with tagName
        name: releaseTag,
        body,
        draft: false,
        prerelease: false,
      });

      const release = {
        id: response.data.id,
        title: response.data.name ?? releaseTag,
        tagName: response.data.tag_name,
        body: response.data.body ?? body,
      };

      // Update the module with the new release and tag (with commit SHA from API response)
      module.setReleases([release, ...module.releases]);
      const newTag = {
        name: releaseTag,
        commitSHA,
      };
      module.setTags([newTag, ...module.tags]);

      // We also need to ensure that this module can't be released anymore. Thus, we need to clear existing commits
      // as this is the primary driver for determining release status.
      module.clearCommits();
    }

    return terraformModulesToRelease;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle GitHub permissions or any error related to pushing tags
    if (errorMessage.includes('The requested URL returned error: 403')) {
      throw new Error(
        [
          `Failed to create tags in repository: ${errorMessage}.`,
          'Ensure that the GitHub Actions workflow has the correct permissions to create tags.',
          'Update your workflow YAML file with the following block under "permissions":',
          '\n\npermissions:\n  contents: write',
        ].join(' '),
        { cause: error },
      );
    }

    throw new Error(`Failed to create tags in repository: ${errorMessage}`, { cause: error });

    //
    // There appears to be an issue with V8 coverage reporting. It shows the finally block as
    // not being covered in test coverage. However, we do explicitly have console and endGroup() as
    // being asserted. Thus, ignore for now.
    //

    /* c8 ignore next */
  } finally {
    console.timeEnd('Elapsed time pushing new tags & release');
    endGroup();
  }
}

/**
 * Deletes specified releases from the repository.
 *
 * This function takes an array of GitHub releases and deletes them from the repository.
 * It's a declarative approach where you simply specify which releases to delete.
 *
 * @param {GitHubRelease[]} releasesToDelete - Array of GitHub releases to delete from the repository
 * @returns {Promise<void>} A promise that resolves when all releases are deleted
 * @throws {Error} When release deletion fails due to permissions or API errors
 *
 * @example
 * ```typescript
 * await deleteReleases([
 *   { id: 123, title: 'v1.0.0', body: 'Release notes', tagName: 'v1.0.0' },
 *   { id: 456, title: 'legacy-release', body: 'Old release', tagName: 'legacy-release' }
 * ]);
 * ```
 */
export async function deleteReleases(releasesToDelete: GitHubRelease[]): Promise<void> {
  if (releasesToDelete.length === 0) {
    info('No releases found to delete. Skipping.');
    return;
  }

  startGroup('Deleting releases');

  info(`Deleting ${releasesToDelete.length} release${releasesToDelete.length !== 1 ? 's' : ''}`);
  info(
    JSON.stringify(
      releasesToDelete.map((release) => release.title),
      null,
      2,
    ),
  );

  console.time('Elapsed time deleting releases');

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
          `Failed to delete release: ${releaseTitle} - ${requestError.message}.`,
          'Ensure that the GitHub Actions workflow has the correct permissions to delete releases.',
          'Update your workflow YAML file with the following block under "permissions":',
          '\n\npermissions:\n  contents: write',
        ].join(' '),
        { cause: error },
      );
    }
    throw new Error(`Failed to delete release: [Status = ${requestError.status}] ${requestError.message}`, {
      cause: error,
    });
  } finally {
    console.timeEnd('Elapsed time deleting releases');
    endGroup();
  }
}
