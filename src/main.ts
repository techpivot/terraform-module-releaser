import { getConfig } from '@/config';
import { getContext } from '@/context';
import { addPostReleaseComment, addReleasePlanComment, getPullRequestCommits, hasReleaseComment } from '@/pull-request';
import { createTaggedRelease, deleteLegacyReleases, getAllReleases } from '@/releases';
import { deleteLegacyTags, getAllTags } from '@/tags';
import { ensureTerraformDocsConfigDoesNotExist, installTerraformDocs } from '@/terraform-docs';
import { getAllTerraformModules, getTerraformChangedModules, getTerraformModulesToRemove } from '@/terraform-module';
import type {
  Config,
  Context,
  GitHubRelease,
  ReleasePlanCommentOptions,
  TerraformChangedModule,
  TerraformModule,
} from '@/types';
import { WikiStatus, checkoutWiki, commitAndPushWikiChanges, generateWikiFiles } from '@/wiki';
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
 * @param {Config} config - The configuration object containing wiki and Terraform Docs settings.
 * @param {TerraformChangedModule[]} terraformChangedModules - List of changed Terraform modules.
 * @param {string[]} terraformModuleNamesToRemove - List of Terraform module names to remove.
 * @returns {Promise<void>} Resolves when wiki-related operations are completed.
 */
async function handleReleasePlanComment(
  config: Config,
  terraformChangedModules: TerraformChangedModule[],
  terraformModuleNamesToRemove: string[],
): Promise<void> {
  let wikiStatus: WikiStatus = WikiStatus.DISABLED;
  let failure: string | undefined;
  let error: Error | undefined;

  try {
    if (!config.disableWiki) {
      checkoutWiki();
      wikiStatus = WikiStatus.SUCCESS;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message.split('\n')[0] : String(err).split('\n')[0];
    wikiStatus = WikiStatus.FAILURE;
    failure = errorMessage;
    error = err as Error;
  } finally {
    const commentOptions: ReleasePlanCommentOptions = {
      status: wikiStatus,
      errorMessage: failure,
    };
    await addReleasePlanComment(terraformChangedModules, terraformModuleNamesToRemove, commentOptions);
  }

  if (error) {
    throw error;
  }
}

/**
 * Handles merge-event-specific operations, including tagging new releases, deleting legacy resources,
 * and optionally generating Terraform Docs-based wiki documentation.
 *
 * @param {Config} config - The configuration object.
 * @param {TerraformChangedModule[]} terraformChangedModules - List of changed Terraform modules.
 * @param {string[]} terraformModuleNamesToRemove - List of Terraform module names to remove.
 * @param {TerraformModule[]} terraformModules - List of all Terraform modules in the repository.
 * @param {GitHubRelease[]} allReleases - List of all GitHub releases in the repository.
 * @param {string[]} allTags - List of all tags in the repository.
 * @returns {Promise<void>} Resolves when merge-event operations are complete.
 */
async function handleMergeEvent(
  config: Config,
  terraformChangedModules: TerraformChangedModule[],
  terraformModuleNamesToRemove: string[],
  terraformModules: TerraformModule[],
  allReleases: GitHubRelease[],
  allTags: string[],
): Promise<void> {
  const updatedModules = await createTaggedRelease(terraformChangedModules);
  await addPostReleaseComment(updatedModules);

  await deleteLegacyReleases(terraformModuleNamesToRemove, allReleases);
  await deleteLegacyTags(terraformModuleNamesToRemove, allTags);

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
    const terraformModules = getAllTerraformModules(commits, allTags, allReleases);
    const terraformChangedModules = getTerraformChangedModules(terraformModules);
    const terraformModuleNamesToRemove = getTerraformModulesToRemove(allTags, terraformModules);

    if (!context.isPrMergeEvent) {
      await handleReleasePlanComment(config, terraformChangedModules, terraformModuleNamesToRemove);
    } else {
      await handleMergeEvent(
        config,
        terraformChangedModules,
        terraformModuleNamesToRemove,
        terraformModules,
        allReleases,
        allTags,
      );
    }

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
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message);
    }
  }
}
