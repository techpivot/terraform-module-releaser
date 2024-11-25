import { run } from '@/main';
import { config } from '@/mocks/config';
import { context } from '@/mocks/context';
import { addPostReleaseComment, addReleasePlanComment, hasReleaseComment } from '@/pull-request';
import { createTaggedRelease, deleteLegacyReleases } from '@/releases';
import { deleteLegacyTags } from '@/tags';
import { ensureTerraformDocsConfigDoesNotExist, installTerraformDocs } from '@/terraform-docs';
import { getAllTerraformModules, getTerraformChangedModules, getTerraformModulesToRemove } from '@/terraform-module';
import type { GitHubRelease, TerraformChangedModule, TerraformModule } from '@/types';
import { WikiStatus, checkoutWiki, commitAndPushWikiChanges, generateWikiFiles } from '@/wiki';
import { info, setFailed } from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all required dependencies
vi.mock('@/pull-request');
vi.mock('@/releases');
vi.mock('@/tags');
vi.mock('@/terraform-docs');
vi.mock('@/terraform-module');
vi.mock('@/wiki');

describe('main', () => {
  // Mock module data
  const mockRelease: GitHubRelease = {
    id: 1,
    title: 'Release v1.0.0',
    body: 'Release notes',
    tagName: 'modules/test-module/v1.0.0',
  };

  const mockChangedModule: TerraformChangedModule = {
    moduleName: 'test-module',
    directory: './modules/test-module',
    tags: ['modules/test-module/v1.0.0'],
    releases: [mockRelease],
    latestTag: 'modules/test-module/v1.0.0',
    latestTagVersion: 'v1.0.0',
    isChanged: true,
    commitMessages: ['feat: new feature'],
    releaseType: 'minor',
    nextTag: 'modules/test-module/v1.1.0',
    nextTagVersion: 'v1.1.0',
  };

  // Add mock for getAllTerraformModules
  const mockTerraformModule: TerraformModule = {
    moduleName: 'test-module',
    directory: './modules/test-module',
    tags: ['modules/test-module/v1.0.0'],
    releases: [mockRelease],
    latestTag: 'modules/test-module/v1.0.0',
    latestTagVersion: 'v1.0.0',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset context and config before each test
    context.isPrMergeEvent = false;
    config.disableWiki = false;

    // Reset mocks with default values
    vi.mocked(hasReleaseComment).mockResolvedValue(false);
    vi.mocked(getTerraformChangedModules).mockReturnValue([mockChangedModule]);
    vi.mocked(getAllTerraformModules).mockReturnValue([mockTerraformModule]);
    vi.mocked(getTerraformModulesToRemove).mockReturnValue([]);
  });

  it('should exit early if release comment exists', async () => {
    vi.mocked(hasReleaseComment).mockResolvedValue(true);

    await run();

    expect(info).toHaveBeenCalledWith('Release comment found. Exiting.');
  });

  it('should handle errors', async () => {
    vi.mocked(hasReleaseComment).mockRejectedValue(new Error('Test error'));

    await run();

    expect(setFailed).toHaveBeenCalledWith('Test error');
  });

  it('should handle non-Error type being thrown', async () => {
    // Mock hasReleaseComment to throw a string instead of an Error
    vi.mocked(checkoutWiki).mockImplementationOnce(() => {
      throw 'string error message';
    });

    // Run the function
    await run();

    // The setFailed function should not have been called with an error message
    // since the error wasn't an instance of Error
    expect(addReleasePlanComment).toHaveBeenCalledTimes(1);
    expect(setFailed).not.toHaveBeenCalled();
  });

  it('should call checkoutWiki when wiki is enabled', async () => {
    vi.mocked(hasReleaseComment).mockResolvedValue(false);
    vi.mocked(getTerraformChangedModules).mockReturnValue([mockChangedModule]);
    context.isPrMergeEvent = false;
    config.disableWiki = false;

    await run();

    expect(vi.mocked(checkoutWiki)).toHaveBeenCalledTimes(1);
  });

  it('should not call checkoutWiki when wiki is disabled', async () => {
    vi.mocked(hasReleaseComment).mockResolvedValue(false);
    vi.mocked(getTerraformChangedModules).mockReturnValue([mockChangedModule]);
    context.isPrMergeEvent = false;
    config.disableWiki = true;

    await run();

    expect(vi.mocked(checkoutWiki)).not.toHaveBeenCalled();
  });

  // Wiki checkout error handling
  it('should handle wiki checkout errors and add release plan comment', async () => {
    vi.mocked(hasReleaseComment).mockResolvedValue(false);
    context.isPrMergeEvent = false;
    config.disableWiki = false;

    const mockError = new Error('Wiki checkout failed\nAdditional error details');
    vi.mocked(checkoutWiki).mockImplementationOnce(() => {
      throw mockError;
    });

    vi.mocked(getTerraformChangedModules).mockReturnValue([mockChangedModule]);
    vi.mocked(getTerraformModulesToRemove).mockReturnValue(['old-module']);

    await run();

    expect(addReleasePlanComment).toHaveBeenCalledWith([mockChangedModule], ['old-module'], {
      status: WikiStatus.FAILURE,
      errorMessage: 'Wiki checkout failed',
    });
    expect(setFailed).toHaveBeenCalledWith('Wiki checkout failed\nAdditional error details');
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
      vi.mocked(getTerraformChangedModules).mockReturnValue([mockChangedModule]);
      vi.mocked(createTaggedRelease).mockResolvedValue([
        {
          moduleName: mockChangedModule.moduleName,
          release: mockReleaseResponse,
        },
      ]);
    });

    it('should handle merge event with wiki enabled', async () => {
      config.disableWiki = false;

      await run();

      expect(createTaggedRelease).toHaveBeenCalledWith([mockChangedModule]);
      expect(addPostReleaseComment).toHaveBeenCalledWith([
        {
          moduleName: mockChangedModule.moduleName,
          release: mockReleaseResponse,
        },
      ]);
      expect(deleteLegacyReleases).toHaveBeenCalled();
      expect(deleteLegacyTags).toHaveBeenCalled();
      expect(installTerraformDocs).toHaveBeenCalledWith(config.terraformDocsVersion);
      expect(ensureTerraformDocsConfigDoesNotExist).toHaveBeenCalled();
      expect(checkoutWiki).toHaveBeenCalled();
      expect(generateWikiFiles).toHaveBeenCalledWith([mockTerraformModule]);
      expect(commitAndPushWikiChanges).toHaveBeenCalled();
    });

    it('should handle merge event with wiki disabled', async () => {
      config.disableWiki = true;

      await run();

      expect(createTaggedRelease).toHaveBeenCalledWith([mockChangedModule]);
      expect(addPostReleaseComment).toHaveBeenCalledWith([
        {
          moduleName: mockChangedModule.moduleName,
          release: mockReleaseResponse,
        },
      ]);
      expect(deleteLegacyReleases).toHaveBeenCalled();
      expect(deleteLegacyTags).toHaveBeenCalled();
      expect(installTerraformDocs).not.toHaveBeenCalled();
      expect(ensureTerraformDocsConfigDoesNotExist).not.toHaveBeenCalled();
      expect(checkoutWiki).not.toHaveBeenCalled();
      expect(generateWikiFiles).not.toHaveBeenCalled();
      expect(commitAndPushWikiChanges).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith('Wiki generation is disabled.');
    });

    it('should handle merge event sequence correctly', async () => {
      config.disableWiki = false;
      const expectedTaggedRelease = {
        moduleName: mockChangedModule.moduleName,
        release: mockReleaseResponse,
      };

      vi.mocked(getTerraformChangedModules).mockReturnValue([mockChangedModule]);
      vi.mocked(createTaggedRelease).mockResolvedValue([expectedTaggedRelease]);

      await run();

      const createTaggedReleaseMock = vi.mocked(createTaggedRelease);
      const addPostReleaseCommentMock = vi.mocked(addPostReleaseComment);
      const deleteLegacyReleasesMock = vi.mocked(deleteLegacyReleases);
      const deleteLegacyTagsMock = vi.mocked(deleteLegacyTags);

      // Verify correct arguments
      expect(createTaggedReleaseMock).toHaveBeenCalledWith([mockChangedModule]);
      expect(addPostReleaseCommentMock).toHaveBeenCalledWith([expectedTaggedRelease]);

      // Verify sequence order
      const createTaggedReleaseCallOrder = createTaggedReleaseMock.mock.invocationCallOrder[0];
      const deleteLegacyReleasesCallOrder = deleteLegacyReleasesMock.mock.invocationCallOrder[0];
      const deleteLegacyTagsCallOrder = deleteLegacyTagsMock.mock.invocationCallOrder[0];

      expect(createTaggedReleaseCallOrder).toBeLessThan(deleteLegacyReleasesCallOrder);
      expect(deleteLegacyReleasesCallOrder).toBeLessThan(deleteLegacyTagsCallOrder);
    });
  });
});
