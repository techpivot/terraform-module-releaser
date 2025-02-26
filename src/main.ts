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
 * Entry point for the GitHub Action. Determines the flow based on whether the event
 * is a pull request or a merge, and executes the appropriate operations.
 *
 * @returns {Promise<void>} Resolves when the action completes successfully or fails.
 */
export async function run(): Promise<void> {
  try {
    const { config, context } = initialize();

    if (await hasReleaseComment()) {
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
