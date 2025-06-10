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
import { endGroup, info, setFailed, setOutput, startGroup } from '@actions/core';

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
 * Sets GitHub Action outputs with comprehensive information about Terraform modules.
 *
 * This function generates and sets the following outputs for consumption by subsequent
 * workflow steps or jobs:
 *
 * **Changed Module Outputs:**
 * - `changed-module-names`: Array of module names that need to be released
 * - `changed-module-paths`: Array of directory paths for modules that need to be released
 * - `changed-modules-map`: Object mapping module names to their release metadata
 *
 * **All Module Outputs:**
 * - `all-module-names`: Array of all detected module names in the workspace
 * - `all-module-paths`: Array of all detected module directory paths
 * - `all-modules-map`: Object mapping all module names to their current metadata
 *
 * The module map objects contain the following structure:
 * - `path`: The directory path of the module
 * - `latestTag`: The most recent git tag for the module
 * - `latestTagVersion`: The version with any prefixes (e.g., "v") preserved
 * - `releaseTag`: The tag that will be created for the release (changed modules only)
 * - `releaseType`: The type of release (major, minor, patch) (changed modules only)
 *
 * @param {TerraformModule[]} terraformModules - Array of all Terraform modules detected in the workspace
 * @returns {void} This function has no return value but sets GitHub Action outputs as side effects
 */
function setActionOutputs(terraformModules: TerraformModule[]): void {
  const modulesToRelease = TerraformModule.getModulesNeedingRelease(terraformModules);

  // Prepare changed module outputs
  const changedModuleNames = modulesToRelease.map((module) => module.name);
  const changedModulePaths = modulesToRelease.map((module) => module.directory);
  const changedModulesMap = Object.fromEntries(
    modulesToRelease.map((module) => [
      module.name,
      {
        path: module.directory,
        latestTag: module.getLatestTag(),
        releaseTag: module.getReleaseTag(),
        releaseType: module.getReleaseType(),
      },
    ]),
  );

  // Prepare all module outputs
  const allModuleNames = terraformModules.map((module) => module.name);
  const allModulePaths = terraformModules.map((module) => module.directory);
  const allModulesMap = Object.fromEntries(
    terraformModules.map((module) => [
      module.name,
      {
        path: module.directory,
        latestTag: module.getLatestTag(),
        latestTagVersion: module.getLatestTagVersion(), // Preserves any version prefixes (such as "v") that may be present or configured.
      },
    ]),
  );

  // Log the outputs for debugging purposes
  startGroup('GitHub Action Outputs');
  info(`Changed module names: ${JSON.stringify(changedModuleNames)}`);
  info(`Changed module paths: ${JSON.stringify(changedModulePaths)}`);
  info(`Changed modules map: ${JSON.stringify(changedModulesMap, null, 2)}`);
  info(`All module names: ${JSON.stringify(allModuleNames)}`);
  info(`All module paths: ${JSON.stringify(allModulePaths)}`);
  info(`All modules map: ${JSON.stringify(allModulesMap, null, 2)}`);
  endGroup();

  // Set GitHub Action outputs
  setOutput('changed-module-names', changedModuleNames);
  setOutput('changed-module-paths', changedModulePaths);
  setOutput('changed-modules-map', changedModulesMap);
  setOutput('all-module-names', allModuleNames);
  setOutput('all-module-paths', allModulePaths);
  setOutput('all-modules-map', allModulesMap);
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

    setActionOutputs(terraformModules);
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message);
    }
  }
}
