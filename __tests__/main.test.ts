import { run } from '@/main';
import { config } from '@/mocks/config';
import { context } from '@/mocks/context';
import { parseTerraformModules } from '@/parser';
import { addPostReleaseComment, addReleasePlanComment, getPullRequestCommits, hasReleaseComment } from '@/pull-request';
import { createTaggedReleases, deleteReleases, getAllReleases } from '@/releases';
import { deleteTags, getAllTags } from '@/tags';
import { ensureTerraformDocsConfigDoesNotExist, installTerraformDocs } from '@/terraform-docs';
import { TerraformModule } from '@/terraform-module';
import { createMockTerraformModule } from '@/tests/helpers/terraform-module';
import type { ExecSyncError, GitHubRelease } from '@/types';
import { WIKI_STATUS } from '@/utils/constants';
import { checkoutWiki, commitAndPushWikiChanges, generateWikiFiles, getWikiStatus } from '@/wiki';
import { info, setFailed, setOutput } from '@actions/core';
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
    vi.mocked(hasReleaseComment).mockResolvedValue(false);
    vi.mocked(getPullRequestCommits).mockResolvedValue([]);
    vi.mocked(getAllTags).mockResolvedValue([]);
    vi.mocked(getAllReleases).mockResolvedValue([]);
    vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule]);
    vi.spyOn(TerraformModule, 'getReleasesToDelete').mockReturnValue([]);
    vi.spyOn(TerraformModule, 'getTagsToDelete').mockReturnValue([]);
    vi.spyOn(TerraformModule, 'getModulesNeedingRelease').mockReturnValue([]);
    vi.mocked(getWikiStatus).mockReturnValue({ status: WIKI_STATUS.SUCCESS });
  });

  it('should exit early if release comment exists', async () => {
    vi.mocked(hasReleaseComment).mockResolvedValue(true);

    await run();

    expect(info).toHaveBeenCalledWith('Release comment found. Exiting.');
    expect(setOutput).not.toHaveBeenCalled();
  });

  it('should handle errors', async () => {
    vi.mocked(hasReleaseComment).mockRejectedValue(new Error('Test error'));

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
    vi.mocked(hasReleaseComment).mockResolvedValue(false);
    vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule]);
    vi.mocked(createTaggedReleases).mockResolvedValue([mockTerraformModule]); // Mock the release creation
    context.isPrMergeEvent = true; // Changed to merge event
    config.disableWiki = false;

    await run();

    expect(vi.mocked(checkoutWiki)).toHaveBeenCalledTimes(1);
  });

  it('should not call checkoutWiki when wiki is disabled', async () => {
    vi.mocked(hasReleaseComment).mockResolvedValue(false);
    vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule]);
    vi.mocked(createTaggedReleases).mockResolvedValue([mockTerraformModule]);
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
      vi.mocked(hasReleaseComment).mockResolvedValue(false);
      vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule]);
      vi.mocked(TerraformModule.getReleasesToDelete).mockReturnValue([]);
      vi.mocked(TerraformModule.getTagsToDelete).mockReturnValue([]);
    });

    it('should handle non-merge event (pull request event)', async () => {
      vi.mocked(getWikiStatus).mockReturnValue({ status: WIKI_STATUS.SUCCESS });

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
      expect(installTerraformDocs).not.toHaveBeenCalled();
      expect(checkoutWiki).not.toHaveBeenCalled();

      // Should still set outputs
      expect(setOutput).toHaveBeenCalled();
    });

    it('should handle wiki checkout errors and add release plan comment', async () => {
      const mockError: ExecSyncError = Object.assign(new Error('Wiki checkout failed\nAdditional error details'), {
        name: 'ExecSyncError',
        pid: 12345,
        status: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('Wiki checkout failed\nAdditional error details'),
        signal: null,
        error: new Error('Wiki checkout failed'),
      });

      vi.mocked(getWikiStatus).mockReturnValue({
        status: WIKI_STATUS.FAILURE,
        error: mockError,
        errorSummary: 'Wiki checkout failed',
      });

      await run();

      // Should call addReleasePlanComment with the error status
      expect(addReleasePlanComment).toHaveBeenCalledWith([mockTerraformModule], [], [], {
        status: WIKI_STATUS.FAILURE,
        error: mockError,
        errorSummary: 'Wiki checkout failed',
      });

      // Should call setFailed with the error message after the error is thrown from handlePullRequestEvent
      expect(setFailed).toHaveBeenCalledWith('Wiki checkout failed\nAdditional error details');
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

      vi.mocked(hasReleaseComment).mockResolvedValue(false);
      vi.mocked(parseTerraformModules).mockReturnValue([mockTerraformModule]);
      vi.mocked(createTaggedReleases).mockResolvedValue([mockTerraformModule]);
    });

    it('should handle merge event with wiki enabled', async () => {
      config.disableWiki = false;

      await run();

      expect(createTaggedReleases).toHaveBeenCalledWith([mockTerraformModule]);
      expect(addPostReleaseComment).toHaveBeenCalledWith([mockTerraformModule]);
      expect(deleteReleases).toHaveBeenCalledWith([]);
      expect(deleteTags).toHaveBeenCalledWith([]);
      expect(installTerraformDocs).toHaveBeenCalledWith(config.terraformDocsVersion);
      expect(ensureTerraformDocsConfigDoesNotExist).toHaveBeenCalled();
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
      expect(addPostReleaseComment).toHaveBeenCalledWith([mockTerraformModule]);
      expect(deleteReleases).toHaveBeenCalledWith([]);
      expect(deleteTags).toHaveBeenCalledWith([]);
      expect(installTerraformDocs).not.toHaveBeenCalled();
      expect(ensureTerraformDocsConfigDoesNotExist).not.toHaveBeenCalled();
      expect(checkoutWiki).not.toHaveBeenCalled();
      expect(generateWikiFiles).not.toHaveBeenCalled();
      expect(commitAndPushWikiChanges).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith('Wiki generation is disabled.');

      // Should still set outputs
      expect(setOutput).toHaveBeenCalled();
    });

    it('should handle merge event with delete legacy tags disabled', async () => {
      config.deleteLegacyTags = false;

      await run();

      expect(createTaggedReleases).toHaveBeenCalledWith([mockTerraformModule]);
      expect(addPostReleaseComment).toHaveBeenCalledWith([mockTerraformModule]);
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
      vi.mocked(createTaggedReleases).mockResolvedValue([mockTerraformModule]);

      await run();

      const createTaggedReleasesMock = vi.mocked(createTaggedReleases);
      const addPostReleaseCommentMock = vi.mocked(addPostReleaseComment);
      const deleteReleasesMock = vi.mocked(deleteReleases);
      const deleteTagsMock = vi.mocked(deleteTags);

      // Verify correct arguments
      expect(createTaggedReleasesMock).toHaveBeenCalledWith([mockTerraformModule]);
      expect(addPostReleaseCommentMock).toHaveBeenCalledWith([mockTerraformModule]);
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
});
