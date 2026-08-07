import { relative } from 'node:path';
import { getConfig } from '@/config';
import { context as actionContext, getContext } from '@/context';
import { parseTerraformModules } from '@/parser';
import { addPostReleaseComment, addReleasePlanComment, getPullRequestCommits } from '@/pull-request';
import { createTaggedReleases, deleteReleases, getAllReleases } from '@/releases';
import { deleteTags, getAllTags } from '@/tags';
import { installTerraformDocs } from '@/terraform-docs';
import { TerraformModule } from '@/terraform-module';
import type { ChangedModuleOutput, Config, Context, GitHubRelease, ReleaseOutcome } from '@/types';
import { isCheckoutCurrent, pathExistsOnBaseRef } from '@/utils/freshness';
import { matchesPrMarker } from '@/utils/markers';
import { checkoutWiki, commitAndPushWikiChanges, generateWikiFiles, getWikiStatus } from '@/wiki';
import { endGroup, info, setFailed, setOutput, startGroup, warning } from '@actions/core';

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
 * Handles pull request open/sync events: determines wiki status (including terraform-docs
 * pre-flight validation), posts a release plan comment, and re-throws wiki pre-flight
 * failures when present.
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
  const wikiStatusResult = await getWikiStatus(terraformModules);

  await addReleasePlanComment(terraformModules, releasesToDelete, tagsToDelete, wikiStatusResult);

  if (wikiStatusResult.errorMessage) {
    throw new Error(wikiStatusResult.errorMessage);
  }
}

/**
 * Withholds modules that would be "resurrected" by a stale checkout.
 *
 * Only an *initial* release can resurrect a deleted module: a module that still exists keeps its tags,
 * whereas one removed by a later pull request had its tags cleaned up and therefore reappears looking
 * brand new. On a stale checkout we confirm each such module still exists on the base branch before
 * releasing it.
 *
 * @param {TerraformModule[]} terraformModules - All modules detected in the (stale) workspace.
 * @returns {Promise<TerraformModule[]>} The modules that are safe to release.
 */
async function withholdResurrectedModules(terraformModules: TerraformModule[]): Promise<TerraformModule[]> {
  const { baseRef, workspaceDir } = actionContext;
  const safeModules: TerraformModule[] = [];

  for (const module of terraformModules) {
    const isInitialRelease = module.needsRelease() && module.getLatestTag() === null;
    if (!isInitialRelease || (await pathExistsOnBaseRef(relative(workspaceDir, module.directory)))) {
      safeModules.push(module);
      continue;
    }

    warning(
      `Module '${module.name}' no longer exists on '${baseRef}' and has no existing tags; it was most likely removed after this pull request merged. Skipping its release to avoid resurrecting a deleted module.`,
    );
  }

  return safeModules;
}

/**
 * Adds back modules this pull request released on an earlier run but did not process on this one.
 *
 * `createTaggedReleases()` only ever sees modules that currently `needsRelease()`. That set shrinks
 * between runs: a module released solely because it was an *initial* release has a tag afterwards, so
 * on a re-run it is neither an initial release nor directly changed and drops out entirely. Rendering
 * the post-release comment from this run's outcomes alone would therefore quietly delete such modules
 * from the comment, making the pull request's audit trail claim fewer releases than it actually
 * produced — and it would degrade further on each subsequent re-run.
 *
 * The release marker already records the truth durably, so we recover the missing entries from it. The
 * releases were fetched at the start of the run, so this costs nothing.
 *
 * @param {TerraformModule[]} terraformModules - Every module detected in the workspace.
 * @param {ReleaseOutcome[]} releaseOutcomes - What this run actually created, recovered, or skipped.
 * @returns {ReleaseOutcome[]} The full set of releases attributable to this pull request.
 */
function withPriorReleasesForThisPullRequest(
  terraformModules: TerraformModule[],
  releaseOutcomes: ReleaseOutcome[],
): ReleaseOutcome[] {
  const { prNumber } = actionContext;
  const processed = new Set(releaseOutcomes.map((outcome) => outcome.module.name));

  const priorOutcomes: ReleaseOutcome[] = [];
  for (const module of terraformModules) {
    if (processed.has(module.name)) {
      continue;
    }

    const priorRelease = module.releases.find((release) => matchesPrMarker(release.body, prNumber));
    if (priorRelease) {
      priorOutcomes.push({ module, action: 'skipped', releaseTag: priorRelease.tagName, release: priorRelease });
    }
  }

  return [...priorOutcomes, ...releaseOutcomes];
}

/**
 * Handles merge-event-specific operations, including tagging new releases, deleting legacy resources,
 * and optionally generating Terraform Docs-based wiki documentation.
 *
 * Release creation always runs: it is idempotent and self-healing, so re-running it converges rather
 * than duplicating. The **destructive** steps — obsolete tag/release cleanup and wiki regeneration —
 * are gated on the checked-out tree still being current, because both derive their "what should exist"
 * set from that tree while comparing it against live tags, releases, and wiki pages. See
 * {@link isCheckoutCurrent}.
 *
 * @param {Config} config - The configuration object.
 * @param {TerraformModule[]} terraformModules - List of Terraform modules associated with this workspace.
 * @param {GitHubRelease[]} releasesToDelete - List of Terraform releases to delete.
 * @param {string[]} tagsToDelete - List of Terraform tags to delete.
 * @returns {Promise<ReleaseOutcome[]>} What was created, recovered, or skipped for each module.
 */
async function handlePullRequestMergedEvent(
  config: Config,
  terraformModules: TerraformModule[],
  releasesToDelete: GitHubRelease[],
  tagsToDelete: string[],
  changedModulesMap: Record<string, ChangedModuleOutput>,
): Promise<ReleaseOutcome[]> {
  const checkoutIsCurrent = await isCheckoutCurrent();
  const modulesToRelease = checkoutIsCurrent ? terraformModules : await withholdResurrectedModules(terraformModules);

  const releaseOutcomes = await createTaggedReleases(modulesToRelease);
  const reportedOutcomes = withPriorReleasesForThisPullRequest(terraformModules, releaseOutcomes);
  await addPostReleaseComment(reportedOutcomes);

  // Re-emit outputs as soon as the release outcomes are known, before the steps that can throw (wiki
  // generation in particular). Otherwise a wiki failure would leave the optimistic pre-release map —
  // with a releaseTag that may not exist — as the final value consumers read.
  setReleaseOutcomeOutputs(changedModulesMap, reportedOutcomes);

  if (!checkoutIsCurrent) {
    // A bump publishes whatever is in the workspace. On a stale checkout that tree is older than the
    // module's current state, so the new (highest) version can silently revert changes made after this
    // pull request merged. Name the affected modules — the run-level warning below does not.
    for (const { module, releaseTag } of releaseOutcomes.filter((outcome) => outcome.action === 'created')) {
      warning(
        `Module '${module.name}' was released as '${releaseTag}' from a checkout that is no longer current, so the published tree may be older than the module's latest state on '${actionContext.baseRef}'.`,
      );
    }

    warning(
      [
        "The base branch has advanced past this pull request's merge commit, so the checked-out tree is not current.",
        'Skipping obsolete tag/release cleanup and wiki regeneration to avoid deleting tags, releases, or wiki pages',
        'belonging to modules added after this pull request merged. Re-run the most recently merged pull request to',
        'perform cleanup and regenerate the wiki.',
      ].join(' '),
    );

    return reportedOutcomes;
  }

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
    checkoutWiki();
    const { moduleErrors } = await generateWikiFiles(terraformModules);
    if (moduleErrors.size > 0) {
      throw new Error(
        `terraform-docs generation failed for ${moduleErrors.size} module${moduleErrors.size > 1 ? 's' : ''} (see errors above)`,
      );
    }
    await commitAndPushWikiChanges();
  }

  return reportedOutcomes;
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
 * @returns {Record<string, ChangedModuleOutput>} The changed-modules map that was emitted, so the merge
 *  path can re-emit it with the tag that actually ended up being published.
 */
function setActionOutputs(terraformModules: TerraformModule[]): Record<string, ChangedModuleOutput> {
  const modulesToRelease = TerraformModule.getModulesNeedingRelease(terraformModules);

  // Prepare changed module outputs
  const changedModuleNames = modulesToRelease.map((module) => module.name);
  const changedModulePaths = modulesToRelease.map((module) => module.directory);
  const changedModulesMap: Record<string, ChangedModuleOutput> = Object.fromEntries(
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

  return changedModulesMap;
}

/**
 * Re-emits `changed-modules-map` after a merge so it reflects what was actually published.
 *
 * The map emitted before releases run carries the optimistically computed next version for every
 * changed module. That is the right value to expose if the release step then fails — but once releases
 * are self-healing it is frequently not what gets published: a re-run may skip a module that this pull
 * request already released, or recover a release onto an existing tag, in both cases leaving
 * `releaseTag` naming a ref that does not exist. Downstream jobs that check out `releaseTag` would fail.
 *
 * Each entry gains an `action` field so consumers can distinguish a fresh release from a skip or a
 * heal. Modules with no outcome (the legacy gate skipped the pull request, or the module was withheld
 * on a stale checkout) are reported as `action: 'none'` with a `null` `releaseTag`.
 *
 * @param {Record<string, ChangedModuleOutput>} changedModulesMap - The pre-release map.
 * @param {ReleaseOutcome[]} releaseOutcomes - What actually happened per module.
 * @returns {void}
 */
function setReleaseOutcomeOutputs(
  changedModulesMap: Record<string, ChangedModuleOutput>,
  releaseOutcomes: ReleaseOutcome[],
): void {
  const outcomesByModuleName = new Map(releaseOutcomes.map((outcome) => [outcome.module.name, outcome]));

  const resolvedModulesMap: Record<string, ChangedModuleOutput> = Object.fromEntries(
    Object.entries(changedModulesMap).map(([moduleName, entry]) => {
      const outcome = outcomesByModuleName.get(moduleName);

      return [
        moduleName,
        outcome
          ? { ...entry, releaseTag: outcome.releaseTag, action: outcome.action }
          : { ...entry, releaseTag: null, action: 'none' as const },
      ];
    }),
  );

  startGroup('GitHub Action Outputs (post-release)');
  info(`Changed modules map: ${JSON.stringify(resolvedModulesMap, null, 2)}`);
  endGroup();

  setOutput('changed-modules-map', resolvedModulesMap);
}

/**
 * Executes the main process of the terraform-module-releaser action.
 *
 * This function handles the Terraform module release workflow by:
 * 1. Collecting pull request commits, tags, and existing releases
 * 2. Identifying Terraform modules and which ones have changed
 * 3. Determining modules that need to be removed
 * 4. Handling either release planning (commenting on PR) or the actual merge event
 * 5. Setting GitHub Action outputs with information about changed and all modules
 *
 * Idempotency is handled per-module during release creation (see createTaggedReleases), so re-runs
 * converge to the correct state without over-bumping or duplicating releases.
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

    // Note: We intentionally do NOT short-circuit when a post-release comment already exists. Releases
    // are made idempotent and self-healing per-module in createTaggedReleases(), which detects what has
    // already been released for this pull request and only (re)creates what is missing. This is required
    // so that a re-run can restore a release that was manually deleted (deleting a release does not
    // remove the post-release comment, so a blind comment-based guard would miss it). The post-release
    // comment remains as an audit trail; it simply no longer gates control flow.

    const commits = await getPullRequestCommits();
    const allTags = await getAllTags();
    const allReleases = await getAllReleases();
    const terraformModules = parseTerraformModules(commits, allTags, allReleases);
    const releasesToDelete = TerraformModule.getReleasesToDelete(allReleases, terraformModules);
    const tagsToDelete = TerraformModule.getTagsToDelete(allTags, terraformModules);

    // Important: Let's set the action outputs prior to performing the closed/merge request release.
    // This is because the changed modules filters on [module.needsRelease()] which will be false
    // after the release is created. By setting the outputs here, we ensure they accurately reflect
    // the modules that were changed and needed release at this point in time (and that outputs still
    // exist if the release step throws).
    const changedModulesMap = setActionOutputs(terraformModules);

    if (context.isPrMergeEvent) {
      await handlePullRequestMergedEvent(config, terraformModules, releasesToDelete, tagsToDelete, changedModulesMap);
    } else {
      await handlePullRequestEvent(terraformModules, releasesToDelete, tagsToDelete);
    }
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message);
    }
  }
}
