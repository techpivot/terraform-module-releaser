import { getConfig } from '@/config';
import { getContext } from '@/context';
import { parseTerraformModules } from '@/parser';
import { addPostReleaseComment, addReleasePlanComment, getPullRequestCommits, hasReleaseComment } from '@/pull-request';
import { createTaggedReleases, deleteReleases, getAllReleases } from '@/releases';
import { deleteTags, getAllTags } from '@/tags';
import { ensureTerraformDocsConfigDoesNotExist, installTerraformDocs } from '@/terraform-docs';
import { TerraformModule } from '@/terraform-module';
import type { Config, Context, GitHubRelease } from '@/types';
import { checkoutWiki, commitAndPushWikiChanges, generateWikiFiles, getWikiStatus } from '@/wiki';
import { info, setFailed } from '@actions/core';

/**
 * Initializes and returns the configuration and context objects.
 * Config must be initialized before context due to dependency constraints.
 *
 * @returns {{ config: Config; context: Context }} Initialized config and context objects.
 */
function initialize(): { config: Config; context: Context } {
  const configInstance = getConfig();
  const contextInstance = getContext();

  return { config: configInstance, context: contextInstance };
}

/**
 * Handles wiki-related operations, including checkout, generating release plan comments,
 * and error handling for failures.
 *
 * @param {TerraformModule[]} terraformModules - List of Terraform modules associated with this workspace.
 * @param {GitHubRelease[]} releasesToDelete - List of Terraform releases to delete.
 * @param {string[]} tagsToDelete - List of Terraform tags to remove.
 * @returns {Promise<void>} Resolves when wiki-related operations are completed.
 */
async function handlePullRequestEvent(
  terraformModules: TerraformModule[],
  releasesToDelete: GitHubRelease[],
  tagsToDelete: string[],
): Promise<void> {
  const wikiStatusResult = getWikiStatus();
  await addReleasePlanComment(terraformModules, releasesToDelete, tagsToDelete, wikiStatusResult);

  if (wikiStatusResult.error) {
    throw wikiStatusResult.error;
  }
}

/**
 * Handles merge-event-specific operations, including tagging new releases, deleting legacy resources,
 * and optionally generating Terraform Docs-based wiki documentation.
 *
 * @param {Config} config - The configuration object.
 * @param {TerraformModule[]} terraformModules - List of Terraform modules associated with this workspace.
 * @param {GitHubRelease[]} releasesToDelete - List of Terraform releases to delete.
 * @param {string[]} tagsToDelete - List of Terraform tags to delete.
 * @returns {Promise<void>} Resolves when merge-event operations are complete.
 */
async function handlePullRequestMergedEvent(
  config: Config,
  terraformModules: TerraformModule[],
  releasesToDelete: GitHubRelease[],
  tagsToDelete: string[],
): Promise<void> {
  const releasedTerraformModules = await createTaggedReleases(terraformModules);
  await addPostReleaseComment(releasedTerraformModules);

  if (!config.deleteLegacyTags) {
    info('Deletion of legacy tags/releases is disabled. Skipping.');
  } else {
    await deleteReleases(releasesToDelete);
    await deleteTags(tagsToDelete); // Note: Ensure tag deletion takes place after release deletion
  }

  if (config.disableWiki) {
    info('Wiki generation is disabled.');
  } else {
    installTerraformDocs(config.terraformDocsVersion);
    ensureTerraformDocsConfigDoesNotExist();
    checkoutWiki();
    await generateWikiFiles(terraformModules);
    commitAndPushWikiChanges();
  }
}

/**
 * Executes the main process of the terraform-module-releaser action.
 *
 * This function handles the Terraform module release workflow by:
 * 1. Checking if a release comment already exists to prevent duplicate releases
 * 2. Collecting pull request commits, tags, and existing releases
 * 3. Identifying Terraform modules and which ones have changed
 * 4. Determining modules that need to be removed
 * 5. Handling either release planning (commenting on PR) or the actual merge event
 * 6. Setting GitHub Action outputs with information about changed and all modules
 *
 * The function sets the following outputs:
 * - changed-module-names: Names of modules that changed
 * - changed-module-paths: Paths to modules that changed
 * - changed-modules-map: Detailed map of changed modules with metadata
 * - all-module-names: Names of all detected modules
 * - all-module-paths: Paths to all detected modules
 * - all-modules-map: Detailed map of all modules with metadata
 *
 * @returns {Promise<void>} A promise that resolves when the process completes
 * @throws Will capture and report any errors through setFailed
 */
export async function run(): Promise<void> {
  try {
    const { config, context } = initialize();

    if (await hasReleaseComment()) {
      // Prevent duplicate releases by checking for existing release comments.
      // This serves as a lightweight state mechanism for the Terraform Release Action.
      // When a release is completed, a comment is added to the PR. If this comment exists,
      // it indicates the release has already been processed, preventing:
      // - Manual workflow re-runs from creating duplicate releases
      // - Automatic workflow retries from re-releasing the same modules
      // - Race conditions in concurrent workflow executions
      //
      // This approach is preferred over artifact storage as it requires no additional
      // dependencies, storage permissions, or cleanup - the comment persists with the PR
      // and provides a clear audit trail of release activity. Another potential solution
      // might be to add a label to the PR. However, these are easier modified by users
      // with write permissions while the comment modification would require an admin.
      info('Release comment found. Exiting.');
      return;
    }

    const commits = await getPullRequestCommits();
    const allTags = await getAllTags();
    const allReleases = await getAllReleases();
    const terraformModules = parseTerraformModules(commits, allTags, allReleases);
    const releasesToDelete = TerraformModule.getReleasesToDelete(allReleases, terraformModules);
    const tagsToDelete = TerraformModule.getTagsToDelete(allTags, terraformModules);

    if (context.isPrMergeEvent) {
      await handlePullRequestMergedEvent(config, terraformModules, releasesToDelete, tagsToDelete);
    } else {
      await handlePullRequestEvent(terraformModules, releasesToDelete, tagsToDelete);
    }

    /*
    // Set the outputs for the GitHub Action
    const changedModuleNames = terraformChangedModules.map((module) => module.moduleName);
    const changedModulePaths = terraformChangedModules.map((module) => module.directory);
    const changedModulesMap = Object.fromEntries(
      terraformChangedModules.map((module) => [
        module.moduleName,
        {
          path: module.directory,
          currentTag: module.latestTag,
          nextTag: module.nextTag,
          releaseType: module.releaseType,
        },
      ]),
    );

    // Add new outputs for all modules
    const allModuleNames = terraformModules.map((module) => module.moduleName);
    const allModulePaths = terraformModules.map((module) => module.directory);
    const allModulesMap = Object.fromEntries(
      terraformModules.map((module) => [
        module.moduleName,
        {
          path: module.directory,
          latestTag: module.latestTag,
          latestTagVersion: module.latestTagVersion,
        },
      ]),
    );

    // Log the changes for debugging
    startGroup('Outputs');
    info(`Changed module names: ${JSON.stringify(changedModuleNames)}`);
    info(`Changed module paths: ${JSON.stringify(changedModulePaths)}`);
    info(`Changed modules map: ${JSON.stringify(changedModulesMap, null, 2)}`);
    info(`All module names: ${JSON.stringify(allModuleNames)}`);
    info(`All module paths: ${JSON.stringify(allModulePaths)}`);
    info(`All modules map: ${JSON.stringify(allModulesMap, null, 2)}`);
    endGroup();

    setOutput('changed-module-names', changedModuleNames);
    setOutput('changed-module-paths', changedModulePaths);
    setOutput('changed-modules-map', changedModulesMap);
    setOutput('all-module-names', allModuleNames);
    setOutput('all-module-paths', allModulePaths);
    setOutput('all-modules-map', allModulesMap);
    */
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message);
    }
  }
}
