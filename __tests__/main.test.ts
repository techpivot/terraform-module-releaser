import { run } from '@/main';
import { config } from '@/mocks/config';
import { context } from '@/mocks/context';
import { parseTerraformModules } from '@/parser';
import { addPostReleaseComment, addReleasePlanComment, getPullRequestCommits } from '@/pull-request';
import { createTaggedReleases, deleteReleases, getAllReleases } from '@/releases';
import { deleteTags, getAllTags } from '@/tags';
import { installTerraformDocs } from '@/terraform-docs';
import { TerraformModule } from '@/terraform-module';
import { stubOctokitReturnData } from '@/tests/helpers/octokit';
import { createMockReleaseOutcome, createMockTerraformModule } from '@/tests/helpers/terraform-module';
import type { GitHubRelease } from '@/types';
import { WIKI_STATUS } from '@/utils/constants';
import { buildPrMarker } from '@/utils/markers';
import { checkoutWiki, commitAndPushWikiChanges, generateWikiFiles, getWikiStatus } from '@/wiki';
import { info, setFailed, setOutput, warning } from '@actions/core';
import { RequestError } from '@octokit/request-error';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock most dependencies that are tested elsewhere
// Note: NOT mocking @/terraform-module to allow real instances for testing
vi.mock('@/parser');
vi.mock('@/pull-request');
vi.mock('@/releases');
vi.mock('@/tags');
vi.mock('@/terraform-docs');
vi.mock('@/wiki');

describe('main', () => {
  context.set({
    workspaceDir: '/workspace',
  });

  // Mock module data
  const mockTerraformModule = createMockTerraformModule({
    directory: '/workspace/modules/test-module',
    tags: ['modules/test-module/v1.0.0'],
    releases: [
      {
        id: 1,
        title: 'Release v1.0.0',
        body: 'Release notes',
        tagName: 'modules/test-module/v1.0.0',
      },
    ],
  });

  const mockTerraformModuleNeedingRelease = createMockTerraformModule({
    directory: '/workspace/modules/changed-module',
    tags: ['modules/changed-module/v1.0.0'],
    releases: [
      {
        id: 2,
        title: 'Release v1.0.0',
        body: 'Release notes',
        tagName: 'modules/changed-module/v1.0.0',
      },
    ],
    commitMessages: ['feat: add new feature'], // Add a commit to make it need a release
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset context and config before each test
    context.isPrMergeEvent = false;
    config.disableWiki = false;
    config.deleteLegacyTags = true;

    // Reset mocks with default values
    vi.mocked(getPullRequestCommits).mockResolvedValue([]);
    vi.mocked(getAllTags).mockResolvedValue([]);
    vi.mocked(getAllReleases).mockResolvedValue([]);
    vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule]);
    vi.spyOn(TerraformModule, 'getReleasesToDelete').mockReturnValue([]);
    vi.spyOn(TerraformModule, 'getTagsToDelete').mockReturnValue([]);
    vi.spyOn(TerraformModule, 'getModulesNeedingRelease').mockReturnValue([]);
    vi.mocked(getWikiStatus).mockResolvedValue({ status: WIKI_STATUS.SUCCESS });
    vi.mocked(generateWikiFiles).mockResolvedValue({ updatedFiles: [], moduleErrors: new Map() });
  });

  it('should not short-circuit on a merge event; idempotency is handled during release creation', async () => {
    // The early-exit based on an existing release comment was removed in favor of per-module
    // self-healing in createTaggedReleases. The run always performs its read work and delegates
    // idempotency to release creation rather than exiting early.
    context.isPrMergeEvent = true;
    vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule]);
    vi.mocked(createTaggedReleases).mockResolvedValue([createMockReleaseOutcome(mockTerraformModule)]);

    await run();

    expect(getPullRequestCommits).toHaveBeenCalled();
    expect(createTaggedReleases).toHaveBeenCalledWith([mockTerraformModule]);
    expect(setOutput).toHaveBeenCalled();
  });

  it('should handle errors', async () => {
    vi.mocked(getPullRequestCommits).mockRejectedValue(new Error('Test error'));

    await run();

    expect(setFailed).toHaveBeenCalledWith('Test error');
  });

  it('should handle non-Error type being thrown', async () => {
    // Mock getWikiStatus to throw a string instead of an Error
    vi.mocked(getWikiStatus).mockImplementationOnce(() => {
      throw 'string error message';
    });

    // Run the function
    await run();

    // Since the error wasn't an instance of Error, setFailed should not be called
    // and addReleasePlanComment should not be called either (due to the thrown string)
    expect(addReleasePlanComment).not.toHaveBeenCalled();
    expect(setFailed).not.toHaveBeenCalled();
  });

  it('should call checkoutWiki when wiki is enabled during merge event', async () => {
    vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule]);
    vi.mocked(createTaggedReleases).mockResolvedValue([createMockReleaseOutcome(mockTerraformModule)]); // Mock the release creation
    context.isPrMergeEvent = true; // Changed to merge event
    config.disableWiki = false;

    await run();

    expect(vi.mocked(checkoutWiki)).toHaveBeenCalledTimes(1);
  });

  it('should not call checkoutWiki when wiki is disabled', async () => {
    vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule]);
    vi.mocked(createTaggedReleases).mockResolvedValue([createMockReleaseOutcome(mockTerraformModule)]);
    context.isPrMergeEvent = true; // Set to merge event so checkoutWiki logic is evaluated
    config.disableWiki = true;

    await run();

    expect(vi.mocked(checkoutWiki)).not.toHaveBeenCalled();
  });

  describe('setActionOutputs', () => {
    it('should set GitHub Action outputs with no modules needing release', async () => {
      vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule]);
      vi.mocked(TerraformModule.getModulesNeedingRelease).mockReturnValue([]);

      await run();

      // Verify changed module outputs (should be empty)
      expect(setOutput).toHaveBeenCalledWith('changed-module-names', []);
      expect(setOutput).toHaveBeenCalledWith('changed-module-paths', []);
      expect(setOutput).toHaveBeenCalledWith('changed-modules-map', {});

      // Verify all module outputs
      expect(setOutput).toHaveBeenCalledWith('all-module-names', ['modules/test-module']);
      expect(setOutput).toHaveBeenCalledWith('all-module-paths', ['/workspace/modules/test-module']);
      expect(setOutput).toHaveBeenCalledWith('all-modules-map', {
        'modules/test-module': {
          path: '/workspace/modules/test-module',
          latestTag: 'modules/test-module/v1.0.0',
          latestTagVersion: 'v1.0.0',
        },
      });
    });

    it('should set GitHub Action outputs with modules needing release', async () => {
      vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule, mockTerraformModuleNeedingRelease]);
      vi.mocked(TerraformModule.getModulesNeedingRelease).mockReturnValue([mockTerraformModuleNeedingRelease]);

      await run();

      // Verify changed module outputs
      expect(setOutput).toHaveBeenCalledWith('changed-module-names', ['modules/changed-module']);
      expect(setOutput).toHaveBeenCalledWith('changed-module-paths', ['/workspace/modules/changed-module']);
      expect(setOutput).toHaveBeenCalledWith('changed-modules-map', {
        'modules/changed-module': {
          path: '/workspace/modules/changed-module',
          latestTag: 'modules/changed-module/v1.0.0',
          releaseTag: 'modules/changed-module/v1.1.0',
          releaseType: 'minor',
        },
      });

      // Verify all module outputs
      expect(setOutput).toHaveBeenCalledWith('all-module-names', ['modules/test-module', 'modules/changed-module']);
      expect(setOutput).toHaveBeenCalledWith('all-module-paths', [
        '/workspace/modules/test-module',
        '/workspace/modules/changed-module',
      ]);
      expect(setOutput).toHaveBeenCalledWith('all-modules-map', {
        'modules/test-module': {
          path: '/workspace/modules/test-module',
          latestTag: 'modules/test-module/v1.0.0',
          latestTagVersion: 'v1.0.0',
        },
        'modules/changed-module': {
          path: '/workspace/modules/changed-module',
          latestTag: 'modules/changed-module/v1.0.0',
          latestTagVersion: 'v1.0.0',
        },
      });
    });

    it('should call setOutput exactly 6 times for all outputs', async () => {
      vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule]);
      vi.mocked(TerraformModule.getModulesNeedingRelease).mockReturnValue([]);

      await run();

      // Verify setOutput is called exactly 6 times (lines 134-139)
      expect(setOutput).toHaveBeenCalledTimes(6);

      // Verify the specific calls
      expect(setOutput).toHaveBeenNthCalledWith(1, 'changed-module-names', []);
      expect(setOutput).toHaveBeenNthCalledWith(2, 'changed-module-paths', []);
      expect(setOutput).toHaveBeenNthCalledWith(3, 'changed-modules-map', {});
      expect(setOutput).toHaveBeenNthCalledWith(4, 'all-module-names', ['modules/test-module']);
      expect(setOutput).toHaveBeenNthCalledWith(5, 'all-module-paths', ['/workspace/modules/test-module']);
      expect(setOutput).toHaveBeenNthCalledWith(6, 'all-modules-map', {
        'modules/test-module': {
          path: '/workspace/modules/test-module',
          latestTag: 'modules/test-module/v1.0.0',
          latestTagVersion: 'v1.0.0',
        },
      });
    });
  });

  describe('non-merge event handling', () => {
    beforeEach(() => {
      context.isPrMergeEvent = false;
      vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule]);
      vi.mocked(TerraformModule.getReleasesToDelete).mockReturnValue([]);
      vi.mocked(TerraformModule.getTagsToDelete).mockReturnValue([]);
    });

    it('should handle non-merge event (pull request event)', async () => {
      vi.mocked(getWikiStatus).mockResolvedValue({ status: WIKI_STATUS.SUCCESS });

      await run();

      // Should call addReleasePlanComment for non-merge events
      expect(addReleasePlanComment).toHaveBeenCalledWith([mockTerraformModule], [], [], {
        status: WIKI_STATUS.SUCCESS,
      });

      // Should NOT call merge-specific functions
      expect(createTaggedReleases).not.toHaveBeenCalled();
      expect(addPostReleaseComment).not.toHaveBeenCalled();
      expect(deleteReleases).not.toHaveBeenCalled();
      expect(deleteTags).not.toHaveBeenCalled();
      expect(checkoutWiki).not.toHaveBeenCalled();
      expect(commitAndPushWikiChanges).not.toHaveBeenCalled();

      // Should call getWikiStatus for pre-flight validation
      expect(getWikiStatus).toHaveBeenCalledWith([mockTerraformModule]);

      // Should still set outputs
      expect(setOutput).toHaveBeenCalled();
    });

    it('should handle wiki checkout errors and add release plan comment', async () => {
      vi.mocked(getWikiStatus).mockResolvedValue({
        status: WIKI_STATUS.FAILURE_CHECKOUT,
        errorMessage: 'Wiki checkout failed',
      });

      await run();

      // Should call addReleasePlanComment with the error status
      expect(addReleasePlanComment).toHaveBeenCalledWith([mockTerraformModule], [], [], {
        status: WIKI_STATUS.FAILURE_CHECKOUT,
        errorMessage: 'Wiki checkout failed',
      });

      // Should call setFailed with the error message after the error is thrown from handlePullRequestEvent
      expect(setFailed).toHaveBeenCalledWith('Wiki checkout failed');
    });
  });

  describe('merge event handling', () => {
    const mockReleaseResponse: GitHubRelease = {
      id: 2,
      title: 'Release v1.1.0',
      body: 'New release notes',
      tagName: 'modules/test-module/v1.1.0',
    };

    beforeEach(() => {
      context.isPrMergeEvent = true;

      vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule]);
      vi.mocked(createTaggedReleases).mockResolvedValue([createMockReleaseOutcome(mockTerraformModule)]);
    });

    it('should handle merge event with wiki enabled', async () => {
      config.disableWiki = false;

      await run();

      expect(createTaggedReleases).toHaveBeenCalledWith([mockTerraformModule]);
      expect(addPostReleaseComment).toHaveBeenCalledWith([
        expect.objectContaining({ module: mockTerraformModule, action: 'created' }),
      ]);
      expect(deleteReleases).toHaveBeenCalledWith([]);
      expect(deleteTags).toHaveBeenCalledWith([]);
      expect(installTerraformDocs).toHaveBeenCalledWith(config.terraformDocsVersion);
      expect(checkoutWiki).toHaveBeenCalled();
      expect(generateWikiFiles).toHaveBeenCalledWith([mockTerraformModule]);
      expect(commitAndPushWikiChanges).toHaveBeenCalled();

      // Should still set outputs
      expect(setOutput).toHaveBeenCalled();
    });

    it('should handle merge event with wiki disabled', async () => {
      config.disableWiki = true;

      await run();

      expect(createTaggedReleases).toHaveBeenCalledWith([mockTerraformModule]);
      expect(addPostReleaseComment).toHaveBeenCalledWith([
        expect.objectContaining({ module: mockTerraformModule, action: 'created' }),
      ]);
      expect(deleteReleases).toHaveBeenCalledWith([]);
      expect(deleteTags).toHaveBeenCalledWith([]);
      expect(installTerraformDocs).not.toHaveBeenCalled();
      expect(checkoutWiki).not.toHaveBeenCalled();
      expect(generateWikiFiles).not.toHaveBeenCalled();
      expect(commitAndPushWikiChanges).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith('Wiki generation is disabled.');

      // Should still set outputs
      expect(setOutput).toHaveBeenCalled();
    });

    it('should handle merge event with terraform-docs generation errors', async () => {
      config.disableWiki = false;
      vi.mocked(generateWikiFiles).mockResolvedValue({
        updatedFiles: [],
        moduleErrors: new Map([
          ['vpc-endpoint', 'Invalid module_ref_mode'],
          ['kms', 'terraform-docs failed'],
        ]),
      });

      await run();

      expect(setFailed).toHaveBeenCalledWith('terraform-docs generation failed for 2 modules (see errors above)');
    });

    it('should handle merge event with a single terraform-docs generation error', async () => {
      config.disableWiki = false;
      vi.mocked(generateWikiFiles).mockResolvedValue({
        updatedFiles: [],
        moduleErrors: new Map([['vpc-endpoint', 'Invalid module_ref_mode']]),
      });

      await run();

      expect(setFailed).toHaveBeenCalledWith('terraform-docs generation failed for 1 module (see errors above)');
    });

    it('should handle merge event with delete legacy tags disabled', async () => {
      config.deleteLegacyTags = false;

      await run();

      expect(createTaggedReleases).toHaveBeenCalledWith([mockTerraformModule]);
      expect(addPostReleaseComment).toHaveBeenCalledWith([
        expect.objectContaining({ module: mockTerraformModule, action: 'created' }),
      ]);
      expect(deleteReleases).not.toHaveBeenCalled();
      expect(deleteTags).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith('Deletion of legacy tags/releases is disabled. Skipping.');

      // Should still set outputs
      expect(setOutput).toHaveBeenCalled();
    });

    it('should handle merge event sequence correctly', async () => {
      config.disableWiki = false;
      const mockReleasesToDelete = [mockReleaseResponse];
      const mockTagsToDelete = ['old-tag/v1.0.0'];

      vi.mocked(TerraformModule.getReleasesToDelete).mockReturnValue(mockReleasesToDelete);
      vi.mocked(TerraformModule.getTagsToDelete).mockReturnValue(mockTagsToDelete);
      vi.mocked(createTaggedReleases).mockResolvedValue([createMockReleaseOutcome(mockTerraformModule)]);

      await run();

      const createTaggedReleasesMock = vi.mocked(createTaggedReleases);
      const addPostReleaseCommentMock = vi.mocked(addPostReleaseComment);
      const deleteReleasesMock = vi.mocked(deleteReleases);
      const deleteTagsMock = vi.mocked(deleteTags);

      // Verify correct arguments
      expect(createTaggedReleasesMock).toHaveBeenCalledWith([mockTerraformModule]);
      expect(addPostReleaseCommentMock).toHaveBeenCalledWith([
        expect.objectContaining({ module: mockTerraformModule, action: 'created' }),
      ]);
      expect(deleteReleasesMock).toHaveBeenCalledWith(mockReleasesToDelete);
      expect(deleteTagsMock).toHaveBeenCalledWith(mockTagsToDelete);

      // Verify sequence order
      const createTaggedReleasesCallOrder = createTaggedReleasesMock.mock.invocationCallOrder[0];
      const deleteReleasesCallOrder = deleteReleasesMock.mock.invocationCallOrder[0];
      const deleteTagsCallOrder = deleteTagsMock.mock.invocationCallOrder[0];

      expect(createTaggedReleasesCallOrder).toBeLessThan(deleteReleasesCallOrder);
      expect(deleteReleasesCallOrder).toBeLessThan(deleteTagsCallOrder);

      // Should still set outputs
      expect(setOutput).toHaveBeenCalled();
    });
  });

  describe('stale checkout guard (merge event)', () => {
    beforeEach(() => {
      context.isPrMergeEvent = true;
      context.useMockOctokit();
      context.set({ workspaceDir: '/workspace', baseRef: 'main', mergeCommitSha: 'merge-sha' });
      vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule]);
      vi.mocked(createTaggedReleases).mockResolvedValue([createMockReleaseOutcome(mockTerraformModule)]);
      vi.spyOn(TerraformModule, 'getReleasesToDelete').mockReturnValue([
        { id: 9, title: 'modules/gone/v1.0.0', body: '', tagName: 'modules/gone/v1.0.0' },
      ]);
      vi.spyOn(TerraformModule, 'getTagsToDelete').mockReturnValue(['modules/gone/v1.0.0']);
    });

    it('skips cleanup and wiki regeneration when the base branch has advanced past the merge commit', async () => {
      // Re-running an older merged pull request restores a stale tree; the modules added since are
      // absent from it, so cleanup would delete their tags/releases and the wiki rewrite would drop
      // their pages. Releases must still run (they self-heal); the destructive steps must not.
      stubOctokitReturnData('repos.compareCommitsWithBasehead', {
        data: { status: 'ahead', ahead_by: 7, behind_by: 0 },
      });

      await run();

      expect(createTaggedReleases).toHaveBeenCalled();
      expect(addPostReleaseComment).toHaveBeenCalled();
      expect(deleteReleases).not.toHaveBeenCalled();
      expect(deleteTags).not.toHaveBeenCalled();
      expect(installTerraformDocs).not.toHaveBeenCalled();
      expect(checkoutWiki).not.toHaveBeenCalled();
      expect(generateWikiFiles).not.toHaveBeenCalled();
      expect(commitAndPushWikiChanges).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('the checked-out tree is not current'));
    });

    it('performs cleanup and wiki regeneration when the checkout is current', async () => {
      // Guards against the freshness check being over-eager and disabling normal merge behavior.
      stubOctokitReturnData('repos.compareCommitsWithBasehead', {
        data: { status: 'identical', ahead_by: 0, behind_by: 0 },
      });

      await run();

      expect(deleteReleases).toHaveBeenCalled();
      expect(deleteTags).toHaveBeenCalled();
      expect(generateWikiFiles).toHaveBeenCalled();
      expect(commitAndPushWikiChanges).toHaveBeenCalled();
    });

    it('treats an errored freshness check as current (fails open)', async () => {
      vi.mocked(context.octokit.rest.repos.compareCommitsWithBasehead).mockRejectedValueOnce(
        new RequestError('compare boom', 500, {
          request: { method: 'GET', url: '', headers: {} },
          response: { status: 500, url: '', headers: {}, data: {} },
        }),
      );

      await run();

      expect(deleteReleases).toHaveBeenCalled();
      expect(generateWikiFiles).toHaveBeenCalled();
    });
  });

  describe('resurrection guard (stale checkout)', () => {
    const deletedModule = createMockTerraformModule({
      directory: '/workspace/modules/deleted-module',
      commitMessages: ['feat: originally added here'],
    });

    beforeEach(() => {
      context.isPrMergeEvent = true;
      context.useMockOctokit();
      context.set({ workspaceDir: '/workspace', baseRef: 'main', mergeCommitSha: 'merge-sha' });
      // Stale checkout: the base branch has moved on.
      stubOctokitReturnData('repos.compareCommitsWithBasehead', {
        data: { status: 'ahead', ahead_by: 5, behind_by: 0 },
      });
      vi.mocked(createTaggedReleases).mockResolvedValue([]);
    });

    it('withholds an initial-release module that no longer exists on the base branch', async () => {
      // The module was deleted by a later pull request (its tags were cleaned up then), so on a stale
      // checkout it reappears with no tags and looks brand new.
      vi.mocked(parseTerraformModules).mockReturnValue([deletedModule]);
      vi.mocked(context.octokit.rest.repos.getContent).mockRejectedValueOnce(
        new RequestError('Not Found', 404, {
          request: { method: 'GET', url: '', headers: {} },
          response: { status: 404, url: '', headers: {}, data: {} },
        }),
      );

      await run();

      expect(context.octokit.rest.repos.getContent).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'modules/deleted-module', ref: 'main' }),
      );
      expect(createTaggedReleases).toHaveBeenCalledWith([]);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('resurrecting a deleted module'));
    });

    it('still releases an initial-release module that does exist on the base branch', async () => {
      // A racing merge: pull request A added the module and B merged first. The module is present at
      // the base tip, so it must still be released.
      vi.mocked(parseTerraformModules).mockReturnValue([deletedModule]);

      await run();

      expect(createTaggedReleases).toHaveBeenCalledWith([deletedModule]);
    });

    it('does not check existence for modules that already have tags', async () => {
      // Only an initial release can resurrect a deleted module; anything with tags is left alone.
      vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule]);

      await run();

      expect(context.octokit.rest.repos.getContent).not.toHaveBeenCalled();
      expect(createTaggedReleases).toHaveBeenCalledWith([mockTerraformModule]);
    });
  });

  describe('action outputs reflect what was actually released', () => {
    beforeEach(() => {
      context.isPrMergeEvent = true;
      context.useMockOctokit();
      context.set({ workspaceDir: '/workspace', baseRef: 'main', mergeCommitSha: 'merge-sha' });
      vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule]);
      vi.spyOn(TerraformModule, 'getModulesNeedingRelease').mockReturnValue([mockTerraformModule]);
    });

    const lastChangedModulesMap = () => {
      const calls = vi.mocked(setOutput).mock.calls.filter(([name]) => name === 'changed-modules-map');
      return calls.at(-1)?.[1] as Record<string, { releaseTag: string | null; action?: string }>;
    };

    it('reports the existing tag and action "skipped" when the module was already released', async () => {
      vi.mocked(createTaggedReleases).mockResolvedValue([
        createMockReleaseOutcome(mockTerraformModule, {
          action: 'skipped',
          releaseTag: 'modules/test-module/v1.0.0',
        }),
      ]);

      await run();

      expect(lastChangedModulesMap()['modules/test-module']).toMatchObject({
        releaseTag: 'modules/test-module/v1.0.0',
        action: 'skipped',
      });
    });

    it('reports the healed tag and action "recovered"', async () => {
      vi.mocked(createTaggedReleases).mockResolvedValue([
        createMockReleaseOutcome(mockTerraformModule, {
          action: 'recovered',
          releaseTag: 'modules/test-module/v1.0.0',
        }),
      ]);

      await run();

      expect(lastChangedModulesMap()['modules/test-module']).toMatchObject({
        releaseTag: 'modules/test-module/v1.0.0',
        action: 'recovered',
      });
    });

    it('reports a null releaseTag and action "none" when nothing was released for the module', async () => {
      // e.g. the legacy gate skipped this pull request entirely.
      vi.mocked(createTaggedReleases).mockResolvedValue([]);

      await run();

      expect(lastChangedModulesMap()['modules/test-module']).toMatchObject({
        releaseTag: null,
        action: 'none',
      });
    });

    it('leaves the non-merge path outputs untouched (no action field)', async () => {
      context.isPrMergeEvent = false;

      await run();

      expect(lastChangedModulesMap()['modules/test-module']).not.toHaveProperty('action');
    });
  });

  describe('post-release comment fidelity across re-runs (regression: B1)', () => {
    // Found by live testing. On a re-run, createTaggedReleases only sees modules that still
    // needsRelease(). A module released solely because it was an INITIAL release has a tag afterwards,
    // so it drops out entirely — and rendering the comment from this run's outcomes alone silently
    // deleted it from the pull request's audit trail, degrading further on every subsequent re-run.
    const prMarker = buildPrMarker(1);

    // Released by THIS pull request on an earlier run; no longer needs a release.
    const priorModule = createMockTerraformModule({
      directory: '/workspace/modules/prior-module',
      tags: ['modules/prior-module/v1.0.0'],
      releases: [
        {
          id: 50,
          title: 'modules/prior-module/v1.0.0',
          tagName: 'modules/prior-module/v1.0.0',
          body: `notes\n\n${prMarker}`,
        },
      ],
    });

    // Released by a DIFFERENT pull request; must never be attributed to this one.
    const foreignModule = createMockTerraformModule({
      directory: '/workspace/modules/foreign-module',
      tags: ['modules/foreign-module/v3.0.0'],
      releases: [
        {
          id: 51,
          title: 'modules/foreign-module/v3.0.0',
          tagName: 'modules/foreign-module/v3.0.0',
          body: `notes\n\n${buildPrMarker(2)}`,
        },
      ],
    });

    beforeEach(() => {
      context.isPrMergeEvent = true;
      context.useMockOctokit();
      context.set({ workspaceDir: '/workspace', baseRef: 'main', mergeCommitSha: 'merge-sha' });
    });

    it('still lists a module this pull request released earlier, even when it is no longer processed', async () => {
      vi.mocked(parseTerraformModules).mockReturnValue([priorModule, mockTerraformModule, foreignModule]);
      // Only mockTerraformModule is processed on this re-run; it is skipped (already released).
      vi.mocked(createTaggedReleases).mockResolvedValue([
        createMockReleaseOutcome(mockTerraformModule, { action: 'skipped' }),
      ]);

      await run();

      const reported = vi.mocked(addPostReleaseComment).mock.calls[0][0];
      const names = reported.map((outcome) => outcome.module.name);

      expect(names).toContain('modules/prior-module');
      expect(names).toContain('modules/test-module');
      // A release carrying another pull request's marker must NOT be claimed.
      expect(names).not.toContain('modules/foreign-module');

      const recovered = reported.find((outcome) => outcome.module.name === 'modules/prior-module');
      expect(recovered).toMatchObject({ action: 'skipped', releaseTag: 'modules/prior-module/v1.0.0' });
    });

    it('does not duplicate a module that was processed this run', async () => {
      vi.mocked(parseTerraformModules).mockReturnValue([priorModule]);
      vi.mocked(createTaggedReleases).mockResolvedValue([createMockReleaseOutcome(priorModule, { action: 'skipped' })]);

      await run();

      const reported = vi.mocked(addPostReleaseComment).mock.calls[0][0];
      expect(reported.filter((outcome) => outcome.module.name === 'modules/prior-module')).toHaveLength(1);
    });

    it('reports nothing extra when no prior release carries this pull request marker', async () => {
      vi.mocked(parseTerraformModules).mockReturnValue([foreignModule]);
      vi.mocked(createTaggedReleases).mockResolvedValue([]);

      await run();

      expect(vi.mocked(addPostReleaseComment).mock.calls[0][0]).toStrictEqual([]);
    });

    it('includes the recovered module in the re-emitted outputs map', async () => {
      vi.mocked(parseTerraformModules).mockReturnValue([priorModule]);
      vi.spyOn(TerraformModule, 'getModulesNeedingRelease').mockReturnValue([priorModule]);
      vi.mocked(createTaggedReleases).mockResolvedValue([]);

      await run();

      const calls = vi.mocked(setOutput).mock.calls.filter(([name]) => name === 'changed-modules-map');
      const finalMap = calls.at(-1)?.[1] as Record<string, { releaseTag: string | null; action?: string }>;

      // Without the fix this would be action 'none' with a null releaseTag, contradicting the release
      // that demonstrably exists and carries this pull request's marker.
      expect(finalMap['modules/prior-module']).toMatchObject({
        releaseTag: 'modules/prior-module/v1.0.0',
        action: 'skipped',
      });
    });
  });
});
