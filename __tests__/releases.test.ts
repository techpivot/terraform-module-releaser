import { config } from '@/mocks/config';
import { context } from '@/mocks/context';
import { createTaggedRelease, deleteLegacyReleases, getAllReleases } from '@/releases';
import type { GitHubRelease } from '@/releases';
import type { TerraformChangedModule } from '@/terraform-module';
import { stubOctokitReturnData } from '@/tests/helpers/octokit';
import { debug, endGroup, info, startGroup } from '@actions/core';
import { RequestError } from '@octokit/request-error';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  copyFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  cpSync: vi.fn(),
  readdirSync: vi.fn().mockImplementation(() => []),
}));

describe('releases', () => {
  const url = 'https://api.github.com/repos/techpivot/terraform-module-releaser/releases';
  const mockListReleasesResponse = {
    data: [
      {
        id: 182147836,
        name: 'v1.3.0',
        body:
          '## 1.3.0 (2024-10-27)\r\n' +
          '\r\n' +
          '### New Features ✨\r\n' +
          '\r\n' +
          '- **Enhanced Wiki Generation** 📚: Improved the wiki content generation process, ensuring a more secure and clean directory structure. @virgofx (#90)\r\n',
        tag_name: 'v1.3.0',
      },
      {
        id: 179452510,
        name: 'v1.0.1 - Bug Fixes for Wiki Checkout and Doc Updates',
        body:
          "## What's Changed\r\n" +
          '* Fixed wiki generation failures due to incorrect checkout and authentication logic ([#6](https://github.com/techpivot/terraform-module-releaser/pull/6))\r\n',
        tag_name: 'v1.0.1',
      },
    ],
  };
  const mockGetAllReleasesResponse = mockListReleasesResponse.data.map((release) => ({
    id: release.id,
    title: release.name,
    body: release.body,
    tagName: release.tag_name,
  }));

  describe('getAllReleases() - real API integration tests', () => {
    let releases: GitHubRelease[] = [];

    beforeAll(async () => {
      if (!process.env.GITHUB_TOKEN) {
        throw new Error('GITHUB_TOKEN environment variable must be set for these tests');
      }

      await context.useRealOctokit();
      releases = await getAllReleases();
    });

    afterAll(() => {
      context.useMockOctokit();
    });

    it('should fetch releases and match expected structure', () => {
      expect(Array.isArray(releases)).toBe(true);
      expect(releases.length).toBeGreaterThan(0);

      // Test initial release (v1.0.0)
      const initialRelease = releases[releases.length - 1];
      expect(initialRelease.id).toBe(179205915);
      expect(initialRelease.title).toBe('🚀 v1.0.0 - Initial Release of Terraform Module Releaser');
      expect(initialRelease.body).toContain('We are excited to announce the first stable release');
    });

    it('should maintain correct chronological order', () => {
      const versions = releases.map((release) => release.title.replace('v', ''));
      const sortedVersions = [...versions].sort((a, b) => {
        const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
        const [bMajor, bMinor, bPatch] = b.split('.').map(Number);

        if (aMajor !== bMajor) return bMajor - aMajor;
        if (aMinor !== bMinor) return bMinor - aMinor;
        return bPatch - aPatch;
      });

      expect(versions).toEqual(sortedVersions);
    });

    it('should validate release content structure', () => {
      for (const release of releases) {
        // Basic structure checks
        expect(release).toHaveProperty('id');
        expect(release).toHaveProperty('title');
        expect(release).toHaveProperty('body');

        // Title format check (should at least contain v1.1.1)
        expect(release.title).toMatch(/v\d+\.\d+\.\d+/);

        // Body content checks
        expect(typeof release.body).toBe('string');
        expect(release.body.length).toBeGreaterThan(0);
      }
    });

    it('should verify specific release contents', () => {
      // Find v1.3.0 release
      const v130Release = releases.find((r) => r.title === 'v1.3.0');
      expect(v130Release).toBeDefined();
      expect(v130Release?.id).toBe(182147836);
      expect(v130Release?.body).toContain('Enhanced Wiki Generation');
      expect(v130Release?.body).toContain('Asset & Exclude Pattern Filtering');
    });
  });

  describe('getAllReleases() - pagination', () => {
    beforeAll(() => {
      // Reset to mock Octokit before test suite
      context.useMockOctokit();
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should fetch all available releases when pagination is required', async () => {
      stubOctokitReturnData('repos.listReleases', mockListReleasesResponse);
      const releases = await getAllReleases({ per_page: 1 });

      expect(Array.isArray(releases)).toBe(true);
      expect(releases.length).toBe(mockListReleasesResponse.data.length);

      // Exact match of known tags to ensure no unexpected tags are included
      expect(releases).toEqual(mockGetAllReleasesResponse);

      // Additional assertions to verify pagination calls and debug info
      expect(info).toHaveBeenCalledWith(`Found ${mockGetAllReleasesResponse.length} releases.`);
      expect(vi.mocked(debug).mock.calls).toEqual([
        [`Total page requests: ${mockGetAllReleasesResponse.length}`],
        [JSON.stringify(mockGetAllReleasesResponse, null, 2)],
      ]);
    });

    it('should output singular "release" when only one', async () => {
      const mockReleaseDataSingle = {
        ...mockListReleasesResponse,
        data: [...mockListReleasesResponse.data.slice(0, 1)],
      };

      const mappedReleaseDataSingle = mockGetAllReleasesResponse.slice(0, 1);

      stubOctokitReturnData('repos.listReleases', mockReleaseDataSingle);
      const releases = await getAllReleases({ per_page: 1 });

      expect(Array.isArray(releases)).toBe(true);
      expect(releases.length).toBe(1);

      // Exact match of known tags to ensure no unexpected tags are included
      expect(releases).toEqual(mappedReleaseDataSingle);

      // Additional assertions to verify pagination calls and debug info
      expect(info).toHaveBeenCalledWith('Found 1 release.');
      expect(vi.mocked(debug).mock.calls).toEqual([
        ['Total page requests: 1'],
        [JSON.stringify(mappedReleaseDataSingle, null, 2)],
      ]);
    });

    it('should fetch all available tags when pagination is not required', async () => {
      stubOctokitReturnData('repos.listReleases', mockListReleasesResponse);
      const releases = await getAllReleases({ per_page: 20 });

      expect(Array.isArray(releases)).toBe(true);
      expect(releases.length).toBe(mockListReleasesResponse.data.length);

      // Exact match of known tags to ensure no unexpected tags are included
      expect(releases).toEqual(mockGetAllReleasesResponse);

      // Additional assertions to verify pagination calls and debug info
      expect(info).toHaveBeenCalledWith(`Found ${mockGetAllReleasesResponse.length} releases.`);
      expect(vi.mocked(debug).mock.calls).toEqual([
        ['Total page requests: 1'],
        [JSON.stringify(mockGetAllReleasesResponse, null, 2)],
      ]);
    });

    it('should truncate empty release name/title and body', async () => {
      stubOctokitReturnData('repos.listReleases', {
        data: [
          {
            id: 182147836,
            name: null,
            body: null,
            tag_name: 'v1.3.0',
          },
        ],
      });
      const releases = await getAllReleases({ per_page: 1 });

      expect(Array.isArray(releases)).toBe(true);
      expect(releases).toEqual([
        {
          id: 182147836,
          title: '',
          body: '',
          tagName: 'v1.3.0',
        },
      ]);
    });
  });

  describe('getAllReleases() - error handling', () => {
    beforeAll(() => {
      // Reset to mock Octokit before test suite
      context.useMockOctokit();
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should handle API request errors gracefully', async () => {
      const errorMessage = 'API rate limit exceeded';
      let executedFinally = false;

      // Mock the paginate.iterator method to throw a RequestError
      vi.spyOn(context.octokit.paginate, 'iterator').mockImplementationOnce(() => {
        throw new RequestError(errorMessage, 403, {
          request: { method: 'GET', url, headers: {} },
          response: { status: 403, url, headers: {}, data: {} },
        });
      });
      try {
        await getAllReleases();
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(`Failed to fetch releases: ${errorMessage} (status: 403)`);
        expect((error as Error).cause).toBeInstanceOf(RequestError);
        expect(((error as Error).cause as RequestError).message).toBe(errorMessage);
      } finally {
        executedFinally = true;
      }
      expect(executedFinally).toBe(true);
      expect(startGroup).toHaveBeenCalledWith('Fetching repository releases');
      expect(endGroup).toHaveBeenCalledOnce();
    });

    it('should handle non-RequestError errors', async () => {
      const errorMessage = 'Network error';
      let executedFinally = false;

      vi.spyOn(context.octokit.paginate, 'iterator').mockImplementationOnce(() => {
        throw new Error(errorMessage);
      });

      try {
        await getAllReleases();
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(`Failed to fetch releases: ${errorMessage}`);
        expect((error as Error).cause).toBeInstanceOf(Error);
        expect(((error as Error).cause as Error).message).toBe(errorMessage);
      } finally {
        executedFinally = true;
      }

      expect(executedFinally).toBe(true);
      expect(startGroup).toHaveBeenCalledWith('Fetching repository releases');
      expect(endGroup).toHaveBeenCalledOnce();
    });

    it('should handle unknown error types', async () => {
      const consoleTimeEndSpy = vi.spyOn(console, 'timeEnd');
      const errorMessage = 'Unknown error with trailing space ';

      vi.spyOn(context.octokit.paginate, 'iterator').mockImplementationOnce(() => {
        throw errorMessage; // Throwing a string directly
      });

      try {
        await getAllReleases();
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(errorMessage.trim());
        expect((error as Error).cause).toBe(errorMessage);
      }

      expect(startGroup).toHaveBeenCalledWith('Fetching repository releases');
      expect(endGroup).toHaveBeenCalledOnce();
      expect(consoleTimeEndSpy).toHaveBeenCalledWith('Elapsed time fetching releases');
    });
  });

  describe('createTaggedRelease()', () => {
    const mockTerraformModule: TerraformChangedModule = {
      moduleName: 'test-module',
      directory: '/path/to/module',
      releaseType: 'patch',
      nextTag: 'test-module/v1.0.1',
      nextTagVersion: '1.0.1',
      tags: ['test-module/v1.0.0'],
      releases: [],
      latestTag: 'test-module/v1.0.0',
      latestTagVersion: '1.0.0',
      isChanged: true,
      commitMessages: [],
    };

    it('should successfully create a tagged release', async () => {
      stubOctokitReturnData('repos.createRelease', {
        data: {
          name: 'test-module/v1.0.1',
          body: 'Release notes',
          tag_name: 'test-module/v1.0.1',
          draft: false,
          prerelease: false,
        },
      });
      const result = await createTaggedRelease([mockTerraformModule]);

      expect(result).toHaveLength(1);
      expect(result[0].moduleName).toBe('test-module');
      expect(result[0].release.title).toBe('test-module/v1.0.1');
      expect(startGroup).toHaveBeenCalledWith('Creating releases & tags for modules');
    });

    it('should skip when no modules are provided', async () => {
      const result = await createTaggedRelease([]);
      expect(result).toHaveLength(0);
      expect(info).toHaveBeenCalledWith('No changed Terraform modules to process. Skipping tag/release creation.');
    });

    it('should handle string errors', async () => {
      const errorMessage = 'string error message';

      vi.mocked(context.octokit.rest.repos.createRelease).mockImplementationOnce(() => {
        throw errorMessage;
      });

      await expect(createTaggedRelease([mockTerraformModule])).rejects.toThrow(
        'Failed to create tags in repository: string error message',
      );
    });

    it('should handle errors', async () => {
      const errorMessage = 'Git error';

      vi.mocked(context.octokit.rest.repos.createRelease).mockImplementationOnce(() => {
        throw new Error(errorMessage);
      });

      try {
        await createTaggedRelease([mockTerraformModule]);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(`Failed to create tags in repository: ${errorMessage}`);
        expect(((error as Error).cause as Error).message).toBe(errorMessage);
      }
    });

    it('should provide helpful error message for permission issues', async () => {
      const permissionError = new RequestError('The requested URL returned error: 403', 403, {
        request: { method: 'POST', url: '', headers: {} },
        response: { headers: {}, status: 403, url: '', data: '' },
      });

      vi.spyOn(context.octokit.rest.repos, 'createRelease').mockRejectedValue(permissionError);

      await expect(createTaggedRelease([mockTerraformModule])).rejects.toThrow(/contents: write/);
    });
  });

  describe('deleteLegacyReleases()', () => {
    beforeEach(() => {
      context.useMockOctokit();
    });

    it('should do nothing when deleteLegacyTags is false', async () => {
      config.set({ deleteLegacyTags: false });

      await deleteLegacyReleases([], []);
      expect(info).toHaveBeenCalledWith('Deletion of legacy tags/releases is disabled. Skipping.');
      expect(context.octokit.rest.git.deleteRef).not.toHaveBeenCalled();
      expect(startGroup).not.toHaveBeenCalled();
      expect(endGroup).not.toHaveBeenCalled();
    });

    it('should do nothing when no releases to delete', async () => {
      config.set({ deleteLegacyTags: true });

      await deleteLegacyReleases([], []);
      expect(vi.mocked(startGroup).mock.calls).toEqual([['Deleting legacy Terraform module releases']]);
      expect(vi.mocked(info).mock.calls).toEqual([['No legacy releases found to delete. Skipping.']]);
      expect(context.octokit.rest.git.deleteRef).not.toHaveBeenCalled();
      expect(endGroup).toHaveBeenCalled();
    });

    it('should delete matching legacy releases (plural)', async () => {
      config.set({ deleteLegacyTags: true });
      const moduleNames = mockGetAllReleasesResponse.map((release) => release.title);
      await deleteLegacyReleases(moduleNames, mockGetAllReleasesResponse);

      expect(context.octokit.rest.repos.deleteRelease).toHaveBeenCalledTimes(moduleNames.length);
      expect(startGroup).toHaveBeenCalledWith('Deleting legacy Terraform module releases');
      expect(vi.mocked(info).mock.calls).toEqual([
        [`Found ${moduleNames.length} legacy releases to delete.`],
        [
          JSON.stringify(
            mockGetAllReleasesResponse.map((release) => release.title),
            null,
            2,
          ),
        ],
        ['Deleting release: v1.3.0'],
        ['Deleting release: v1.0.1 - Bug Fixes for Wiki Checkout and Doc Updates'],
      ]);
    });

    it('should delete matching legacy release (singular)', async () => {
      config.set({ deleteLegacyTags: true });
      const releases = mockGetAllReleasesResponse.slice(0, 1);
      const moduleNames = mockGetAllReleasesResponse.map((release) => release.title).slice(0, 1);
      await deleteLegacyReleases(moduleNames, releases);

      expect(context.octokit.rest.repos.deleteRelease).toHaveBeenCalledTimes(moduleNames.length);
      expect(startGroup).toHaveBeenCalledWith('Deleting legacy Terraform module releases');
      expect(vi.mocked(info).mock.calls).toEqual([
        ['Found 1 legacy release to delete.'],
        [
          JSON.stringify(
            releases.map((release) => release.title),
            null,
            2,
          ),
        ],
        [`Deleting release: ${releases[0].title}`],
      ]);
    });

    it('should provide helpful error for permission issues', async () => {
      config.set({ deleteLegacyTags: true });
      const moduleNames = mockGetAllReleasesResponse.map((release) => release.title);

      vi.mocked(context.octokit.rest.repos.deleteRelease).mockRejectedValueOnce(
        new RequestError('Permission Error', 403, {
          request: { method: 'DELETE', url, headers: {} },
          response: { status: 403, url, headers: {}, data: {} },
        }),
      );

      await expect(deleteLegacyReleases(moduleNames, mockGetAllReleasesResponse)).rejects.toThrow(
        `Failed to delete release: v1.3.0 Permission Error.
Ensure that the GitHub Actions workflow has the correct permissions to delete releases by ensuring that your workflow YAML file has the following block under "permissions":

permissions:
  contents: write`,
      );
      expect(endGroup).toHaveBeenCalled();
    });

    it('should handle non-permission errors', async () => {
      config.set({ deleteLegacyTags: true });
      const moduleNames = mockGetAllReleasesResponse.map((release) => release.title);

      vi.mocked(context.octokit.rest.repos.deleteRelease).mockRejectedValueOnce(
        new RequestError('Not Found', 404, {
          request: { method: 'DELETE', url, headers: {} },
          response: { status: 404, url, headers: {}, data: {} },
        }),
      );

      await expect(deleteLegacyReleases(moduleNames, mockGetAllReleasesResponse)).rejects.toThrow(
        'Failed to delete release: [Status = 404] Not Found',
      );
      expect(endGroup).toHaveBeenCalled();
    });
  });
});
