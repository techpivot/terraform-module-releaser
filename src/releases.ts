import { type ExecSyncOptions, execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTerraformModuleChangelog, createTerraformModuleChangelogEntry } from '@/changelog';
import { config } from '@/config';
import { context } from '@/context';
import { hasLegacyPostReleaseComment } from '@/pull-request';
import { TerraformModule } from '@/terraform-module';
import type { GitHubRelease, GitHubTag, ReleaseOutcome } from '@/types';
import { GITHUB_ACTIONS_BOT_NAME } from '@/utils/constants';
import { copyModuleContents } from '@/utils/file';
import { configureGitAuthentication, getGitHubActionsBotEmail } from '@/utils/github';
import { buildPrMarker, hasAnyPrMarker, matchesPrMarker, neutralizePrMarkers } from '@/utils/markers';
import { debug, endGroup, info, startGroup, warning } from '@actions/core';
import type { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods';
import { RequestError } from '@octokit/request-error';
import which from 'which';

type ListReleasesParams = Omit<RestEndpointMethodTypes['repos']['listReleases']['parameters'], 'owner' | 'repo'>;

/**
 * How many of a module's orphan tags (tags with no release) are checked for recoverability on a merge.
 *
 * Each check costs one Git Data API request, and only tags without a release are candidates — so in a
 * healthy repository this is zero. The cap bounds the worst case (a repository full of hand-made tags)
 * so one merge cannot fan out into an unbounded number of lookups. When it truncates, the run says so
 * rather than silently checking fewer.
 */
const MAX_ORPHAN_TAG_LOOKUPS = 3;

/**
 * Retrieves all releases from the specified GitHub repository.
 *
 * This function fetches the list of releases for the repository specified in the configuration.
 * It returns the releases as an array of objects containing the title, body, and tag name.
 *
 * @param {ListReleasesParams} options - Optional pagination overrides, merged over the defaults
 *   (`per_page: 100, page: 1`)
 * @returns {Promise<GitHubRelease[]>} A promise that resolves to an array of release details.
 * @throws {RequestError} Throws an error if the request to fetch releases fails.
 */
export async function getAllReleases(options?: ListReleasesParams): Promise<GitHubRelease[]> {
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
      per_page: 100,
      page: 1,
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
  } finally {
    console.timeEnd('Elapsed time fetching releases');
    endGroup();
  }
}

/**
 * How strongly an existing tag can be tied to the current pull request.
 *
 * - `marker` — the tag's release commit carries this pull request's marker. Cryptographically boring
 *   but authoritative: the commit message is immutable once pushed, and untrusted text is neutralized
 *   before it is written.
 * - `heuristic` — the commit carries no marker at all (it predates the marker scheme) but matches the
 *   exact shape this action writes. Good enough to *recover* an orphan tag, never good enough to
 *   *skip* a release.
 * - `unknown` — not ours, or not provable.
 */
type TagProvenance = 'marker' | 'heuristic' | 'unknown';

/**
 * Determines how confidently an existing git tag can be attributed to the **current** pull request.
 *
 * This is the provenance check that makes self-healing safe. A tag with no release is not
 * automatically ours: it may be a tag pushed by hand, a tag that predates adoption of this action, or
 * a tag left behind by a *different* pull request whose run died between `git push` and
 * `createRelease`. Adopting such a tag would attach this pull request's changelog to another commit's
 * tree and, worse, leave this pull request's own changes unreleased forever.
 *
 * Resolution order, most certain first:
 * 1. The tag's commit message carries **this** pull request's marker → `marker`.
 * 2. The tag's commit message carries a marker naming a **different** pull request → `unknown`.
 * 3. No marker at all (the tag predates the marker scheme) → require the exact shape this action
 *    writes: line 1 is the tag name and line 3 is this pull request's title → `heuristic`.
 *
 * The pre-marker case is deliberately shape-exact rather than a substring test. `line 1 === tagName`
 * holds for *every* release commit this action has ever written, so a loose `includes(prTitle)` would
 * leave the pull request title as the only discriminator — and bots such as Renovate and Dependabot
 * reuse titles byte-for-byte across pull requests, which would make a collision routine rather than
 * theoretical.
 *
 * Any failure to resolve the commit (a tag pointing at an annotated tag object, a deleted commit, a
 * transient API error) is treated as **not attributable**. Failing to adopt is always recoverable —
 * the owning pull request's own re-run will heal it — whereas wrongly adopting is not.
 *
 * @param {string} tagName - The tag being considered for adoption.
 * @param {string | null} commitSHA - The commit the tag points at.
 * @returns {Promise<TagProvenance>} How strongly the tag ties to the current pull request.
 */
async function getTagProvenance(tagName: string, commitSHA: string | null): Promise<TagProvenance> {
  // No resolvable commit means no proof of ownership. Treat an empty SHA the same as a missing one.
  if (!commitSHA) {
    return 'unknown';
  }

  const {
    octokit,
    repo: { owner, repo },
    prNumber,
    prTitle,
  } = context;

  let commitMessage: string;
  try {
    // Use the Git Data API rather than repos.getCommit: we only need the message, and a release commit
    // is built in a temp directory with `git add .`, so its diff nominally deletes every other file in
    // the repository. repos.getCommit would return that entire `files[]` array (with patches) to read
    // one string.
    const { data } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: commitSHA });
    commitMessage = data.message ?? '';
  } catch (error) {
    warning(
      `Could not resolve commit ${commitSHA} for tag '${tagName}' to verify ownership; treating it as not belonging to this pull request: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 'unknown';
  }

  if (matchesPrMarker(commitMessage, prNumber)) {
    return 'marker';
  }

  if (hasAnyPrMarker(commitMessage)) {
    return 'unknown';
  }

  // Pre-marker fallback: the release commit shape this action has always written, matched exactly.
  const lines = commitMessage.split('\n');
  const shapeMatches = lines[0]?.trim() === tagName && prTitle.length > 0 && lines[2]?.trim() === prTitle;

  return shapeMatches ? 'heuristic' : 'unknown';
}

/**
 * Legacy gate: was this pull request already completed under the pre-marker scheme?
 *
 * True when its post-release comment uses LEGACY_PR_RELEASE_COMMENT_MARKER and none of its releases carry
 * our marker, in which case the old "don't double-release" behavior is preserved by skipping. This reads
 * only our own markers — never the editable release-note text — so it is robust and unambiguous. A pull
 * request released under the current scheme carries the new comment marker, so it is not treated as
 * legacy and continues to self-heal.
 *
 * @param {TerraformModule[]} modules - The modules needing a release.
 * @param {number} prNumber - The pull request number.
 * @returns {Promise<boolean>} Whether this pull request already released under the pre-marker scheme.
 */
async function isLegacyCompletedPullRequest(modules: TerraformModule[], prNumber: number): Promise<boolean> {
  const anyReleaseHasMarker = modules.some((module) =>
    module.releases.some((release) => matchesPrMarker(release.body, prNumber)),
  );

  return !anyReleaseHasMarker && (await hasLegacyPostReleaseComment());
}

/**
 * Step 1: has this module already been released for this pull request?
 *
 * This makes re-runs idempotent — a retried or re-run merge will not bump or re-create a release for a
 * module that was already released by this pull request (which would otherwise over-bump the version).
 * It is still reported so the post-release comment lists it.
 *
 * @param {TerraformModule} module - The module being processed.
 * @param {number} prNumber - The pull request number.
 * @returns {ReleaseOutcome | null} The skip outcome, or null when this pull request has not released it.
 */
function findCompletedRelease(module: TerraformModule, prNumber: number): ReleaseOutcome | null {
  const existingPrRelease = module.releases.find((release) => matchesPrMarker(release.body, prNumber));
  if (!existingPrRelease) {
    return null;
  }

  info(`Module '${module.name}' already released for this pull request (${existingPrRelease.title}). Skipping.`);
  module.clearCommits();

  return {
    module,
    action: 'skipped',
    releaseTag: existingPrRelease.tagName,
    release: existingPrRelease,
  };
}

/**
 * Step 1b: the latest tag is ours and already has a release, but that release's body no longer carries
 * our marker (edited by hand, or replaced by GitHub's "Generate release notes"). Without this, step 1
 * would miss and step 3 would bump and publish a duplicate release.
 *
 * A release carrying another pull request's marker is unambiguously not ours, so no lookup is needed —
 * which means the steady state (every release body carrying a marker) costs nothing.
 *
 * This requires a real `marker`, never the pre-marker heuristic. Skipping is irreversible: a wrong
 * answer here silently drops a genuine release forever, whereas a wrong answer in step 2 leaves a state
 * a re-run can still correct.
 *
 * @param {TerraformModule} module - The module being processed.
 * @returns {Promise<ReleaseOutcome | null>} The skip outcome, or null when the latest tag is not
 *  provably this pull request's.
 */
async function findUnmarkedCompletedRelease(module: TerraformModule): Promise<ReleaseOutcome | null> {
  const latestTag = module.getLatestTag();
  if (latestTag === null) {
    return null;
  }

  const releaseForLatestTag = module.releases.find((release) => release.tagName === latestTag);
  if (releaseForLatestTag === undefined || hasAnyPrMarker(releaseForLatestTag.body)) {
    return null;
  }

  if ((await getTagProvenance(latestTag, module.getLatestTagCommitSHA())) !== 'marker') {
    return null;
  }

  info(
    `Module '${module.name}' was already released by this pull request as '${releaseForLatestTag.tagName}' (verified via the release commit; the release body no longer carries the marker). Skipping.`,
  );
  module.clearCommits();

  return {
    module,
    action: 'skipped',
    releaseTag: releaseForLatestTag.tagName,
    release: releaseForLatestTag,
  };
}

/**
 * Warns that a module's orphan tags could not be attributed to this pull request, so they were left
 * untouched and a new version is being released instead.
 *
 * Says nothing when there are no orphan tags — the healthy steady state.
 *
 * @param {string} moduleName - The module being processed.
 * @param {ReadonlyArray<GitHubTag>} orphanTags - The inspected tags that were not attributable.
 * @returns {void}
 */
function warnUnattributableOrphanTags(moduleName: string, orphanTags: ReadonlyArray<GitHubTag>): void {
  if (orphanTags.length === 0) {
    return;
  }

  const isSingle = orphanTags.length === 1;
  const tagList = orphanTags.map((tag) => `'${tag.name}'`).join(', ');
  warning(
    `Module '${moduleName}' has ${isSingle ? 'a tag' : 'tags'} without a release (${tagList}) that ${isSingle ? 'was' : 'were'} not produced by this pull request. Leaving ${isSingle ? 'it' : 'them'} untouched and releasing a new version instead.`,
  );
}

/**
 * Step 2: recover an orphan tag (a tag with no release) that this pull request produced — from a
 * partial failure where the tag was pushed but the release was never created, or where the release was
 * deleted by hand. The release is created for the existing tag, at its existing version, without
 * bumping or pushing a new commit/tag.
 *
 * We search every orphan tag newest-first, not just the latest one, because a later pull request may
 * already have bumped past ours: if PR #5's tag was orphaned and PR #6 then released a higher version,
 * #5's orphan is no longer the latest and would otherwise never be healed (#5 would instead bump again
 * and publish its older tree as the newest version). Only tags *without* a release are candidates, so
 * in the steady state there is nothing to scan and no request is made. The scan is capped so a
 * repository with many orphan tags cannot turn one merge into an unbounded number of lookups.
 *
 * Orphan tags we could NOT attribute to this pull request are deliberately left alone: they belong to a
 * different pull request (or predate this action), and their owner's re-run is what should heal them.
 * Claiming one would attach this pull request's notes to another commit's tree and leave this pull
 * request's own changes unreleased.
 *
 * @param {TerraformModule} module - The module being processed.
 * @param {string} releaseMarker - The hidden marker tying the created release to this pull request.
 * @returns {Promise<ReleaseOutcome | null>} The recovery outcome, or null when no orphan tag is ours.
 */
async function recoverOrphanTagRelease(module: TerraformModule, releaseMarker: string): Promise<ReleaseOutcome | null> {
  const {
    octokit,
    repo: { owner, repo },
  } = context;
  const moduleName = module.name;

  const orphanTags = module.tags.filter((tag) => !module.releases.some((release) => release.tagName === tag.name));
  const orphanTagsToInspect = orphanTags.slice(0, MAX_ORPHAN_TAG_LOOKUPS);
  if (orphanTags.length > orphanTagsToInspect.length) {
    info(
      `Module '${moduleName}' has ${orphanTags.length} tags without releases; only the newest ${MAX_ORPHAN_TAG_LOOKUPS} are checked for recovery.`,
    );
  }

  let recoverableTag: string | null = null;
  for (const tag of orphanTagsToInspect) {
    if ((await getTagProvenance(tag.name, tag.commitSHA)) !== 'unknown') {
      recoverableTag = tag.name;
      break;
    }
  }

  if (recoverableTag === null) {
    warnUnattributableOrphanTags(moduleName, orphanTagsToInspect);

    return null;
  }

  const recoveredVersion = TerraformModule.getVersionFromTag(recoverableTag) as string;
  info(`Module '${moduleName}' has tag '${recoverableTag}' without a release. Creating the missing release.`);

  const changelog = createTerraformModuleChangelogEntry(recoveredVersion, module.commitMessages);
  const body = `${changelog}\n\n${releaseMarker}`;
  const response = await octokit.rest.repos.createRelease({
    owner,
    repo,
    tag_name: recoverableTag,
    name: recoverableTag,
    body,
    draft: false,
    prerelease: config.preRelease,
  });

  const release = {
    id: response.data.id,
    title: response.data.name ?? recoverableTag,
    tagName: response.data.tag_name,
    body: response.data.body ?? body,
  };
  module.setReleases([release, ...module.releases]);
  module.clearCommits();

  return { module, action: 'recovered', releaseTag: recoverableTag, release };
}

/**
 * Step 3: normal release — bump the version, then commit, tag, push, and create the release.
 *
 * @param {TerraformModule} module - The module being processed.
 * @param {string} releaseMarker - The hidden marker tying the release and its commit to this pull request.
 * @returns {Promise<ReleaseOutcome>} The created outcome.
 */
async function publishNewRelease(module: TerraformModule, releaseMarker: string): Promise<ReleaseOutcome> {
  const {
    octokit,
    repo: { owner, repo },
    prBody,
    prTitle,
    workspaceDir,
  } = context;
  const moduleName = module.name;

  const releaseTag = module.getReleaseTag() as string;
  const releaseTagVersion = module.getReleaseTagVersion() as string;
  info(`Release type: ${module.getReleaseType()}`);
  info(`Next tag version: ${releaseTagVersion}`);

  // Create a temporary working directory
  // Replace '/' with '-' to create a valid directory name
  const fileSystemSafeModuleName = module.name.replaceAll('/', '-');
  const tmpDir = mkdtempSync(join(tmpdir(), `${fileSystemSafeModuleName}-`));
  info(`Created temp directory: ${tmpDir}`);

  // Copy the module's contents to the temporary directory, excluding specified patterns
  copyModuleContents(module.directory, tmpDir, config.moduleAssetExcludePatterns);

  // Copy the module's .git directory
  cpSync(join(workspaceDir, '.git'), join(tmpDir, '.git'), { recursive: true });

  // Git operations: commit the changes and tag the release.
  //
  // The hidden marker is appended as the final line so this commit — and therefore the tag pointing
  // at it — can later be proven to belong to this pull request. That proof is what makes step 2's
  // orphan-tag recovery safe; without it we could not distinguish our own interrupted release from
  // another pull request's, or from a tag pushed by hand.
  //
  // The title and body are untrusted and MUST be neutralized first. `git commit -m` uses
  // `cleanup=whitespace`, so a marker planted on its own line in a pull request description would
  // survive verbatim into the very text this provenance check trusts.
  const commitMessage =
    `${releaseTag}\n\n${neutralizePrMarkers(prTitle)}\n\n${neutralizePrMarkers(prBody)}\n\n${releaseMarker}`.trim();
  const gitPath = await which('git');
  const githubActionsBotEmail = await getGitHubActionsBotEmail();

  // Execute git commands in temp directory without inheriting stdio to avoid output pollution
  const gitOpts: ExecSyncOptions = { cwd: tmpDir };

  // Configure Git authentication
  configureGitAuthentication(gitPath, gitOpts);

  for (const cmd of [
    ['config', '--local', 'user.name', GITHUB_ACTIONS_BOT_NAME],
    ['config', '--local', 'user.email', githubActionsBotEmail],
    ['add', '.'],
    ['commit', '-m', commitMessage.trim()],
    ['tag', releaseTag],
    ['push', 'origin', releaseTag],
  ]) {
    execFileSync(gitPath, cmd, gitOpts);
  }

  // Store the commit SHA that the tag points to (since it's not returned from the API via create release)
  const commitSHA = execFileSync(gitPath, ['rev-parse', 'HEAD'], gitOpts).toString().trim();

  // Create a GitHub release using the tag
  info(`Creating GitHub release for ${moduleName}@${releaseTagVersion}`);
  const changelog = createTerraformModuleChangelog(module);
  const body = `${changelog}\n\n${releaseMarker}`;

  const response = await octokit.rest.repos.createRelease({
    owner,
    repo,
    tag_name: releaseTag, // For now we keep these the same with tagName
    name: releaseTag,
    body,
    draft: false,
    prerelease: config.preRelease,
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

  return { module, action: 'created', releaseTag, release };
}

/**
 * Creates a GitHub release and corresponding git tag for each Terraform module that needs a release.
 *
 * This operation is self-healing and idempotent. For each module that needs a release, it converges to
 * the correct state rather than blindly creating a release (which would over-bump versions on a re-run):
 *
 * 1. If the module already has a release for the current pull request (its body carries our marker),
 *    it is skipped — no bump, no create — but still reported so the post-release comment lists it.
 * 1b. If the latest tag is provably this pull request's and already has a release, the module is also
 *    skipped. This covers a release whose body was edited or regenerated, which strips the marker and
 *    would otherwise re-arm a bump and a duplicate release.
 * 2. Otherwise, if the latest tag is provably this pull request's and has **no** release (an orphan
 *    tag from a partial failure, or a manually-deleted release), the missing release is created for
 *    that existing tag without bumping the version or pushing a new commit/tag.
 * 3. Otherwise, a normal release is performed: the version is bumped and a commit, tag, and release
 *    are created.
 *
 * A tag that cannot be attributed to this pull request is never adopted; the run bumps past it and
 * leaves it for its owning pull request's re-run to heal. See `docs/state-management.md`.
 *
 * Note: Requires GitHub action permissions > contents: write
 *
 * @param {TerraformModule[]} terraformModules - An array of Terraform module objects containing
 *  module metadata, version information, and release status.
 * @returns {Promise<ReleaseOutcome[]>} What was actually done for each module, including the tag that
 *  really exists and the release attributed to this pull request.
 */
export async function createTaggedReleases(terraformModules: TerraformModule[]): Promise<ReleaseOutcome[]> {
  const terraformModulesToRelease = TerraformModule.getModulesNeedingRelease(terraformModules);

  // Check if there are any modules to process
  if (terraformModulesToRelease.length === 0) {
    info('No changed Terraform modules to process. Skipping tag/release creation.');
    return [];
  }

  // We can be sure based on our type definitions that each module now is a module that
  // needs to be released. It has GitHub commits.

  const { prNumber } = context;

  // Each release we create embeds a hidden, schema-versioned marker tying it to this pull request (see
  // src/utils/markers.ts). The same marker is written into the release commit message, which is what
  // later lets us prove that an existing tag was produced by this pull request. We scan for it so that
  // re-runs converge to the correct state instead of over-bumping or duplicating releases.
  const releaseMarker = buildPrMarker(prNumber);

  if (await isLegacyCompletedPullRequest(terraformModulesToRelease, prNumber)) {
    info(
      'Legacy release marker found; this pull request completed under the pre-marker scheme. Skipping release creation to avoid double-releasing.',
    );
    return [];
  }

  console.time('Elapsed time pushing new tags & release');
  startGroup('Creating releases & tags for modules');

  const outcomes: ReleaseOutcome[] = [];

  try {
    for (const module of terraformModulesToRelease) {
      info(`Processing module: ${module.name}`);

      // Converge to the correct state by taking the first step that recognizes this module, falling
      // through to a normal release only when none of the self-healing paths claim it. Order matters:
      // each step is strictly more speculative than the one before it.
      const outcome =
        findCompletedRelease(module, prNumber) ??
        (await findUnmarkedCompletedRelease(module)) ??
        (await recoverOrphanTagRelease(module, releaseMarker)) ??
        (await publishNewRelease(module, releaseMarker));

      outcomes.push(outcome);
    }

    return outcomes;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle GitHub permissions or any error related to creating tags or releases. The git CLI reports a
    // permissions failure in the push output, whereas the Releases API surfaces it as a 403 RequestError;
    // match both so the remediation is shown either way.
    const isPermissionsError =
      errorMessage.includes('The requested URL returned error: 403') ||
      (error instanceof RequestError && error.status === 403);

    if (isPermissionsError) {
      throw new Error(
        [
          `Failed to create releases/tags in repository: ${errorMessage}.`,
          'Ensure that the GitHub Actions workflow has the correct permissions to create tags and releases.',
          'Update your workflow YAML file with the following block under "permissions":',
          '\n\npermissions:\n  contents: write',
        ].join(' '),
        { cause: error },
      );
    }

    throw new Error(`Failed to create releases/tags in repository: ${errorMessage}`, { cause: error });
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
