import { info, setFailed } from '@actions/core';
import { config } from './config';
import { context } from './context';
import { addPostReleaseComment, addReleasePlanComment, getPullRequestCommits, hasReleaseComment } from './pull-request';
import { createTaggedRelease, deleteLegacyReleases, getAllReleases } from './releases';
import { deleteLegacyTags, getAllTags } from './tags';
import { installTerraformDocs } from './terraform-docs';
import { getAllTerraformModules, getTerraformChangedModules, getTerraformModulesToRemove } from './terraform-module';
import { checkoutWiki, updateWiki } from './wiki';
import { WikiStatus } from './wiki';

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    if (await hasReleaseComment()) {
      info('Release comment found. Exiting.');
      return;
    }

    // Fetch all commits along with associated files in this PR
    const commits = await getPullRequestCommits();

    // Fetch all tags associated with this PR
    const allTags = await getAllTags();

    // Fetch all releases associated with this PR
    const allReleases = await getAllReleases();

    // Get all Terraform modules in this repository including changed metadata
    const terraformModules = getAllTerraformModules(context.workspaceDir, commits, allTags, allReleases);

    // Create a new array of only changed Terraform modules
    const terraformChangedModules = getTerraformChangedModules(terraformModules);
    info(
      `Found ${terraformChangedModules.length} changed Terraform module${terraformChangedModules.length !== 1 ? 's' : ''}.`,
    );

    // Get an array of terraform module names to remove based on existing tags
    const terraformModuleNamesToRemove = getTerraformModulesToRemove(allTags, terraformModules);

    if (!context.isPrMergeEvent) {
      let wikiStatus = WikiStatus.DISABLED;
      let failure: string | undefined;
      let error: Error | undefined;

      try {
        if (!config.disableWiki) {
          checkoutWiki();
          wikiStatus = WikiStatus.SUCCESS;
        }
      } catch (err) {
        // Capture error message if the checkout fails
        const errorMessage = (err as Error).message.split('\n')[0] || 'Unknown error during wiki checkout';
        wikiStatus = WikiStatus.FAILURE;
        failure = errorMessage;
        error = err as Error;
      } finally {
        await addReleasePlanComment(terraformChangedModules, terraformModuleNamesToRemove, {
          status: wikiStatus,
          errorMessage: failure,
        });
      }

      // If we have an error, let's throw it so that the action fails after we've successfully commented on the PR.
      if (error !== undefined) {
        throw error;
      }
    } else {
      // Create the tagged release and post a comment to the PR
      const updatedModules = await createTaggedRelease(terraformChangedModules);
      await addPostReleaseComment(updatedModules);

      // Delete legacy releases and tags (Ensure we delete releases first)
      await deleteLegacyReleases(terraformModuleNamesToRemove, allReleases);
      await deleteLegacyTags(terraformModuleNamesToRemove, allTags);

      if (config.disableWiki) {
        info('Wiki generation is disabled.');
      } else {
        installTerraformDocs(config.terraformDocsVersion);
        checkoutWiki();
        updateWiki(terraformModules);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message);
    }
  }
}
