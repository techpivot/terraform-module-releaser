import { debug, info, setFailed } from '@actions/core';
import { config } from './config';
import {
  commentOnPullRequest,
  createTaggedRelease,
  deleteLegacyTerraformModuleTagsAndReleases,
  getAllReleases,
  getAllTags,
  getPullRequestCommits,
} from './github';
import { installTerraformDocs } from './terraform-docs';
import {
  getAllTerraformModulesWithChanges,
  getTerraformChangedModules,
  getTerraformModulesToRemove,
} from './terraform-module';
import { checkoutWiki, updateWiki } from './wiki';
import { WikiStatus } from './wiki';

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const {
      majorKeywords,
      minorKeywords,
      patchKeywords,
      defaultFirstTag,
      githubToken,
      isDefaultGithubActionsToken,
      terraformDocsVersion,
      isPrMergeEvent,
      workspaceDir,
      repoUrl,
      disableWiki,
      wikiSidebarChangelogMax,
      deleteLegacyTags,
    } = config;

    // Debug logs for inputs
    debug(`Major keywords: ${majorKeywords}`);
    debug(`Minor keywords: ${minorKeywords}`);
    debug(`Patch keywords: ${patchKeywords}`);
    debug(`Default first tag: ${defaultFirstTag}`);
    debug(`Terraform Docs Version: ${terraformDocsVersion}`);
    debug(`GitHub Token provided: ${githubToken ? 'Yes' : 'No'}`);
    debug(`Is Pull Request Merge Event: ${isPrMergeEvent ? 'Yes' : 'No'}`);
    debug(`Is using default GitHub Actions Token: ${isDefaultGithubActionsToken ? 'Yes' : 'No'}`);
    debug(`Workspace Directory: ${workspaceDir}`);
    debug(`Repository URL: ${repoUrl}`);
    debug(`Is Wiki generation disabled?: ${disableWiki ? 'Yes' : 'No'}`);
    debug(`Wiki sidebar changelog max count: ${wikiSidebarChangelogMax}`);
    debug(`Delete Legacy Tags: ${deleteLegacyTags ? 'Yes' : 'No'}`);

    info(isPrMergeEvent ? 'Merge event detected.' : 'Non-merge event detected (pull-request).');

    // Fetch all commits along with associated files in this PR
    const commits = await getPullRequestCommits();
    info(`Found ${commits.length} commit${commits.length !== 1 ? 's' : ''}.`);
    debug(JSON.stringify(commits, null, 2));

    // Fetch all tags associated with this PR
    const allTags = await getAllTags();
    info(`Found ${allTags.length} tag${allTags.length !== 1 ? 's' : ''}.`);
    debug(JSON.stringify(allTags, null, 2));

    // Fetch all releases associated with this PR
    const allReleases = await getAllReleases();
    info(`Found ${allReleases.length} releases${allReleases.length !== 1 ? 's' : ''}.`);
    debug(JSON.stringify(allReleases, null, 2));

    // Fetch all Terraform modules that are changed with respect to this pull request
    const terraformModules = await getAllTerraformModulesWithChanges(
      config.workspaceDir,
      commits,
      allTags,
      allReleases,
    );
    const terraformChangedModules = getTerraformChangedModules(terraformModules);
    info(`Found ${terraformModules.length} Terraform module${terraformModules.length !== 1 ? 's' : ''}.`);
    info(
      `Found ${terraformChangedModules.length} changed Terraform module${terraformChangedModules.length !== 1 ? 's' : ''}.`,
    );

    const terraformModuleNamesToRemove = getTerraformModulesToRemove(allTags, terraformModules);
    info(
      `Found ${terraformModuleNamesToRemove.length} Terraform module${terraformModuleNamesToRemove.length !== 1 ? 's' : ''} to remove.`,
    );

    if (!isPrMergeEvent) {
      let wikiStatus = WikiStatus.DISABLED;
      let failure: string | undefined;
      let error: Error | undefined;
      try {
        if (!disableWiki) {
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
        await commentOnPullRequest(terraformChangedModules, terraformModuleNamesToRemove, {
          status: wikiStatus,
          errorMessage: failure,
        });
      }

      // If we have an error, let's throw it so that the action fails after we've successfully commented on the PR.
      if (error !== undefined) {
        throw error;
      }
    } else {
      console.log('>>');
      /*
      await createTaggedRelease(terraformChangedModules);
      await deleteLegacyTerraformModuleTagsAndReleases(terraformModuleNamesToRemove, allTags, allReleases);

      if (config.disableWiki) {
        info('Wiki generation is disabled.');
      } else {
        installTerraformDocs(terraformDocsVersion);
        checkoutWiki();
        updateWiki(terraformModules);
      }*/
    }
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message);
    }
  }
}
