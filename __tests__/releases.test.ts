import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { context } from '@/mocks/context';
import { createTaggedReleases, deleteReleases, getAllReleases } from '@/releases';
import { TerraformModule } from '@/terraform-module';
import { stubOctokitReturnData } from '@/tests/helpers/octokit';
import { createMockTerraformModule } from '@/tests/helpers/terraform-module';
import type { GitHubRelease } from '@/types';
import { debug, endGroup, info, startGroup } from '@actions/core';
import { RequestError } from '@octokit/request-error';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  copyFileSync: vi.fn(),
  mkdtempSync: vi.fn().mockImplementation(() => {
    return join(tmpdir(), (Math.random() + 1).toString(36).substring(7));
  }),
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

  describe('createTaggedReleases()', () => {
    let mockTerraformModule: TerraformModule;

    beforeEach(() => {
      // Create a module with commits so needsRelease() returns true naturally
      context.set({
        workspaceDir: '/workspace',
      });
      mockTerraformModule = createMockTerraformModule({
        directory: '/workspace/path/to/test-module',
        commits: [
          {
            sha: 'abc123',
            message: 'feat: Add new feature',
            files: ['/workspace/path/to/test-module/main.tf'],
          },
        ],
        tags: ['path/to/test-module/v1.0.0'],
        releases: [
          {
            id: 1,
            title: 'path/to/test-module/v1.0.0',
            tagName: 'path/to/test-module/v1.0.0',
            body: '# v1.0.0 (YYYY-MM-DD)\n\n- Changelog Item 1',
          },
        ],
      });

      vi.spyOn(mockTerraformModule, 'setReleases');
      vi.spyOn(mockTerraformModule, 'setTags');

      context.useMockOctokit();
    });

    it('should successfully create a tagged release', async () => {
      const mockRelease = {
        data: {
          id: 123456,
          name: 'path/to/test-module/v1.1.0',
          body: 'Mock changelog content',
          tag_name: 'path/to/test-module/v1.1.0',
          draft: false,
          prerelease: false,
        },
      };
      stubOctokitReturnData('repos.createRelease', mockRelease);

      const modulesToRelease = TerraformModule.getModulesNeedingRelease([mockTerraformModule]);
      expect(modulesToRelease).toStrictEqual([mockTerraformModule]);

      // Store the original releases and tags, since we update it after.
      const originalReleases = mockTerraformModule.releases;
      const originalTags = mockTerraformModule.tags;

      expect(mockTerraformModule.needsRelease()).toBe(true);
      const releasedModules = await createTaggedReleases([mockTerraformModule]);
      expect(releasedModules).toStrictEqual([mockTerraformModule]);
      expect(mockTerraformModule.setReleases).toHaveBeenCalledWith([
        {
          id: mockRelease.data.id,
          title: mockRelease.data.tag_name,
          tagName: mockRelease.data.tag_name,
          body: mockRelease.data.body,
        },
        ...originalReleases,
      ]);
      expect(mockTerraformModule.setTags).toHaveBeenCalledWith(['path/to/test-module/v1.1.0', ...originalTags]);
      expect(mockTerraformModule.needsRelease()).toBe(false);
      expect(startGroup).toHaveBeenCalledWith('Creating releases & tags for modules');
      expect(endGroup).toHaveBeenCalled();
    });

    it('should handle null/undefined name and body from GitHub API response', async () => {
      const mockRelease = {
        data: {
          id: 789012,
          name: null, // Simulate GitHub API returning null for name
          body: undefined, // Simulate GitHub API returning undefined for body
          tag_name: 'path/to/test-module/v1.1.0',
          draft: false,
          prerelease: false,
        },
      };
      stubOctokitReturnData('repos.createRelease', mockRelease);

      // Store the original releases and tags, since we update it after.
      const originalTags = mockTerraformModule.tags;

      const releasedModules = await createTaggedReleases([mockTerraformModule]);
      expect(releasedModules).toStrictEqual([mockTerraformModule]);

      // Verify that the setReleases was called
      expect(mockTerraformModule.setReleases).toHaveBeenCalledOnce();

      const releaseCall = vi.mocked(mockTerraformModule.setReleases).mock.calls[0][0];
      const newRelease = releaseCall[0];

      // Verify the fallbacks work correctly
      expect(newRelease.id).toBe(789012);
      expect(newRelease.title).toBe('path/to/test-module/v1.1.0'); // Should fall back to releaseTag since name is null
      expect(newRelease.tagName).toBe('path/to/test-module/v1.1.0');
      expect(newRelease.body).toContain('v1.1.0'); // Should fall back to generated changelog since body is undefined
      expect(newRelease.body).toContain('feat: Add new feature'); // Should contain the commit message

      expect(mockTerraformModule.setTags).toHaveBeenCalledWith(['path/to/test-module/v1.1.0', ...originalTags]);
      expect(endGroup).toHaveBeenCalled();
    });

    it('should handle missing name but valid body from GitHub API response', async () => {
      const mockRelease = {
        data: {
          id: 345678,
          name: null, // Simulate GitHub API returning null for name
          body: 'Custom release body from GitHub API', // Valid body provided
          tag_name: 'path/to/test-module/v1.1.0',
          draft: false,
          prerelease: false,
        },
      };
      stubOctokitReturnData('repos.createRelease', mockRelease);

      const releasedModules = await createTaggedReleases([mockTerraformModule]);
      expect(releasedModules).toStrictEqual([mockTerraformModule]);

      // Verify that the setReleases was called
      expect(mockTerraformModule.setReleases).toHaveBeenCalledOnce();

      const releaseCall = vi.mocked(mockTerraformModule.setReleases).mock.calls[0][0];
      const newRelease = releaseCall[0];

      // Verify the title falls back to releaseTag but body uses the provided value
      expect(newRelease.title).toBe('path/to/test-module/v1.1.0'); // Should fall back to releaseTag since name is null
      expect(newRelease.body).toBe('Custom release body from GitHub API'); // Should use the provided body
      expect(endGroup).toHaveBeenCalled();
    });

    it('should handle valid name but missing body from GitHub API response', async () => {
      const mockRelease = {
        data: {
          id: 456789,
          name: 'Custom Release Name', // Valid name provided
          body: null, // Simulate GitHub API returning null for body (Should never happen but we'll test for it)
          tag_name: 'path/to/test-module/v1.1.0',
          draft: false,
          prerelease: false,
        },
      };
      stubOctokitReturnData('repos.createRelease', mockRelease);

      const releasedModules = await createTaggedReleases([mockTerraformModule]);
      expect(releasedModules).toStrictEqual([mockTerraformModule]);

      // Verify that the setReleases was called
      expect(mockTerraformModule.setReleases).toHaveBeenCalledOnce();

      const releaseCall = vi.mocked(mockTerraformModule.setReleases).mock.calls[0][0];
      const newRelease = releaseCall[0];

      // Verify the name is used but body falls back to generated changelog
      expect(newRelease.title).toBe('Custom Release Name'); // Should use the provided name
      expect(newRelease.body).toContain('v1.1.0'); // Should fall back to generated changelog since body is null
      expect(newRelease.body).toContain('feat: Add new feature'); // Should contain the commit message
      expect(endGroup).toHaveBeenCalled();
    });

    it('should skip when no modules need release', async () => {
      // Create a module without any commits so needsRelease() returns false naturally
      const moduleWithoutChanges = createMockTerraformModule({
        directory: '/workspace/path/to/unchanged-module',
        commits: [],
        tags: ['path/to/unchanged-module/v1.0.0'],
        releases: [
          {
            id: 1,
            title: 'path/to/unchanged-module/v1.0.0',
            tagName: 'path/to/unchanged-module/v1.0.0',
            body: '# v1.0.0 (YYYY-MM-DD)\n\n- Initial release',
          },
        ],
      });

      const result = await createTaggedReleases([moduleWithoutChanges]);

      expect(result).toHaveLength(0);
      expect(info).toHaveBeenCalledWith('No changed Terraform modules to process. Skipping tag/release creation.');
    });

    it('should handle string errors', async () => {
      const errorMessage = 'string error message';

      vi.mocked(context.octokit.rest.repos.createRelease).mockImplementationOnce(() => {
        throw errorMessage;
      });

      await expect(createTaggedReleases([mockTerraformModule])).rejects.toThrow(
        'Failed to create tags in repository: string error message',
      );
      expect(endGroup).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      const errorMessage = 'Git error';

      vi.mocked(context.octokit.rest.repos.createRelease).mockImplementationOnce(() => {
        throw new Error(errorMessage);
      });

      try {
        await createTaggedReleases([mockTerraformModule]);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(`Failed to create tags in repository: ${errorMessage}`);
        expect(((error as Error).cause as Error).message).toBe(errorMessage);
      }
      expect(endGroup).toHaveBeenCalled();
    });

    it('should provide helpful error message for permission issues', async () => {
      const permissionError = new Error('The requested URL returned error: 403');

      vi.spyOn(context.octokit.rest.repos, 'createRelease').mockRejectedValue(permissionError);

      await expect(createTaggedReleases([mockTerraformModule])).rejects.toThrow(/contents: write/);
      expect(endGroup).toHaveBeenCalled();
    });
  });

  describe('deleteReleases()', () => {
    beforeEach(() => {
      context.useMockOctokit();
    });

    it('should do nothing when no releases to delete', async () => {
      await deleteReleases([]);
      expect(vi.mocked(info).mock.calls).toEqual([['No releases found to delete. Skipping.']]);
      expect(context.octokit.rest.repos.deleteRelease).not.toHaveBeenCalled();
      expect(startGroup).not.toHaveBeenCalled();
      expect(endGroup).not.toHaveBeenCalled();
    });

    it('should delete multiple releases', async () => {
      await deleteReleases(mockGetAllReleasesResponse);

      expect(context.octokit.rest.repos.deleteRelease).toHaveBeenCalledTimes(mockGetAllReleasesResponse.length);
      expect(startGroup).toHaveBeenCalledWith('Deleting releases');
      expect(vi.mocked(info).mock.calls).toEqual([
        [`Deleting ${mockGetAllReleasesResponse.length} releases`],
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

    it('should delete single release', async () => {
      const releases = mockGetAllReleasesResponse.slice(0, 1);
      await deleteReleases(releases);

      expect(context.octokit.rest.repos.deleteRelease).toHaveBeenCalledTimes(1);
      expect(startGroup).toHaveBeenCalledWith('Deleting releases');
      expect(vi.mocked(info).mock.calls).toEqual([
        ['Deleting 1 release'],
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
      vi.mocked(context.octokit.rest.repos.deleteRelease).mockRejectedValueOnce(
        new RequestError('Permission Error', 403, {
          request: { method: 'DELETE', url, headers: {} },
          response: { status: 403, url, headers: {}, data: {} },
        }),
      );

      await expect(deleteReleases(mockGetAllReleasesResponse)).rejects.toThrow(
        `Failed to delete release: v1.3.0 - Permission Error. Ensure that the GitHub Actions workflow has the correct permissions to delete releases. Update your workflow YAML file with the following block under "permissions": 

permissions:
  contents: write`,
      );
      expect(endGroup).toHaveBeenCalled();
    });

    it('should handle non-permission errors', async () => {
      vi.mocked(context.octokit.rest.repos.deleteRelease).mockRejectedValueOnce(
        new RequestError('Not Found', 404, {
          request: { method: 'DELETE', url, headers: {} },
          response: { status: 404, url, headers: {}, data: {} },
        }),
      );

      await expect(deleteReleases(mockGetAllReleasesResponse)).rejects.toThrow(
        'Failed to delete release: [Status = 404] Not Found',
      );
      expect(endGroup).toHaveBeenCalled();
    });
  });
});
