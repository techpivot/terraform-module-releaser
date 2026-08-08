import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '@/mocks/config';
import { context } from '@/mocks/context';
import { createTaggedReleases, deleteReleases, getAllReleases } from '@/releases';
import { TerraformModule } from '@/terraform-module';
import { stubOctokitImplementation, stubOctokitReturnData } from '@/tests/helpers/octokit';
import { createMockTerraformModule } from '@/tests/helpers/terraform-module';
import type { GitHubRelease } from '@/types';
import { LEGACY_PR_RELEASE_COMMENT_MARKER, PR_RELEASE_COMMENT_MARKER } from '@/utils/constants';
import { buildPrMarker, matchesPrMarker } from '@/utils/markers';
import { debug, endGroup, info, startGroup, warning } from '@actions/core';
import { RequestError } from '@octokit/request-error';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock only execFileSync (used by createTaggedReleases and spied on below); keep the real module so that
// transitively-loaded modules (src/pull-request.ts -> src/wiki.ts -> src/terraform-docs.ts, which does
// `promisify(execFile)` at load time) still resolve their child_process imports.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn() };
});
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  copyFileSync: vi.fn(),
  mkdtempSync: vi.fn().mockImplementation(() => {
    return join(tmpdir(), (Math.random() + 1).toString(36).substring(7));
  }),
  cpSync: vi.fn(),
  readdirSync: vi.fn().mockImplementation(() => []),
}));

const execFileSyncMock = vi.mocked(execFileSync);

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
      expect(releases).toBeInstanceOf(Array);
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

    it('should verify specific release contents', () => {
      // Find v1.3.0 release (This is specific for this repo - which is fine as we are just testing release object parsing)
      const v130Release = releases.find((r) => r.title === 'v1.3.0');
      expect(v130Release).toBeDefined();
      expect(v130Release?.tagName).toBe('v1.3.0');
      expect(v130Release?.title).toBe('v1.3.0');
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

      expect(releases).toBeInstanceOf(Array);
      expect(releases).toHaveLength(mockListReleasesResponse.data.length);

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

      expect(releases).toBeInstanceOf(Array);
      expect(releases).toHaveLength(1);

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

      expect(releases).toBeInstanceOf(Array);
      expect(releases).toHaveLength(mockListReleasesResponse.data.length);

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

      expect(releases).toBeInstanceOf(Array);
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
        expect(error).toBeInstanceOf(Error);
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
        expect(error).toBeInstanceOf(Error);
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
        expect(error).toBeInstanceOf(Error);
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
      execFileSyncMock.mockReset();
      execFileSyncMock.mockImplementation((_file, args) => {
        if (Array.isArray(args) && args.includes('rev-parse')) {
          return Buffer.from('abc123def456');
        }

        return Buffer.from('');
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
          target_commitish: 'abc123def456',
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
      expect(releasedModules).toHaveLength(1);
      expect(releasedModules[0]).toMatchObject({ module: mockTerraformModule, action: 'created' });
      expect(mockTerraformModule.setReleases).toHaveBeenCalledWith([
        {
          id: mockRelease.data.id,
          title: mockRelease.data.tag_name,
          tagName: mockRelease.data.tag_name,
          body: mockRelease.data.body,
        },
        ...originalReleases,
      ]);
      expect(mockTerraformModule.setTags).toHaveBeenCalledWith([
        {
          name: 'path/to/test-module/v1.1.0',
          commitSHA: 'abc123def456',
        },
        ...originalTags,
      ]);
      expect(mockTerraformModule.needsRelease()).toBe(false);
      expect(startGroup).toHaveBeenCalledWith('Creating releases & tags for modules');
      expect(endGroup).toHaveBeenCalled();
    });

    it('should pass config.preRelease to GitHub API when creating releases', async () => {
      config.set({ preRelease: true });

      const mockRelease = {
        data: {
          id: 123456,
          name: 'path/to/test-module/v1.1.0',
          body: 'Mock changelog content',
          tag_name: 'path/to/test-module/v1.1.0',
          target_commitish: 'abc123def456',
          draft: false,
          prerelease: true,
        },
      };
      stubOctokitReturnData('repos.createRelease', mockRelease);

      await createTaggedReleases([mockTerraformModule]);

      expect(context.octokit.rest.repos.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({
          prerelease: true,
          draft: false,
        }),
      );
    });

    it('should handle null/undefined name and body from GitHub API response', async () => {
      execFileSyncMock.mockImplementation((_file, args) => {
        if (Array.isArray(args) && args.includes('rev-parse')) {
          return Buffer.from('def456abc789');
        }

        return Buffer.from('');
      });
      const mockRelease = {
        data: {
          id: 789012,
          name: null, // Simulate GitHub API returning null for name
          body: undefined, // Simulate GitHub API returning undefined for body
          tag_name: 'path/to/test-module/v1.1.0',
          target_commitish: 'def456abc789',
          draft: false,
          prerelease: false,
        },
      };
      stubOctokitReturnData('repos.createRelease', mockRelease);

      // Store the original releases and tags, since we update it after.
      const originalTags = mockTerraformModule.tags;

      const releasedModules = await createTaggedReleases([mockTerraformModule]);
      expect(releasedModules).toHaveLength(1);
      expect(releasedModules[0]).toMatchObject({ module: mockTerraformModule, action: 'created' });

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

      expect(mockTerraformModule.setTags).toHaveBeenCalledWith([
        {
          name: 'path/to/test-module/v1.1.0',
          commitSHA: 'def456abc789',
        },
        ...originalTags,
      ]);
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
      expect(releasedModules).toHaveLength(1);
      expect(releasedModules[0]).toMatchObject({ module: mockTerraformModule, action: 'created' });

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
      expect(releasedModules).toHaveLength(1);
      expect(releasedModules[0]).toMatchObject({ module: mockTerraformModule, action: 'created' });

      // Verify that the setReleases was called
      expect(mockTerraformModule.setReleases).toHaveBeenCalledOnce();

      const releaseCall = vi.mocked(mockTerraformModule.setReleases).mock.calls[0][0];
      const newRelease = releaseCall[0];

      // With secure version extraction, custom names are not sorted as versions.
      // Just check that the fallback for body works and the title is set as provided.
      expect(newRelease.title).toBe('Custom Release Name');
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
        'Failed to create releases/tags in repository: string error message',
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
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(`Failed to create releases/tags in repository: ${errorMessage}`);
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

  describe('createTaggedReleases() - self-healing / idempotency', () => {
    // The default mock context has prNumber = 1 and prTitle = 'Test Pull Request'. This is the hidden,
    // schema-versioned marker embedded in every release body AND release commit message we create.
    const releaseMarker = buildPrMarker(1);
    const otherPrMarker = buildPrMarker(2);
    const directory = '/workspace/path/to/test-module';

    /**
     * Stubs the commit that a module's latest tag points at. This is what the step 2 provenance check
     * reads to decide whether an existing tag belongs to this pull request.
     */
    const stubTagCommitMessage = (message: string) => {
      stubOctokitReturnData('git.getCommit', { data: { message } });
    };

    /** A release commit message exactly as createTaggedReleases writes it. */
    const ourReleaseCommitMessage = (tag: string, marker: string = releaseMarker) =>
      `${tag}\n\nTest Pull Request\n\nThis is a test pull request body.\n\n${marker}`;

    beforeEach(() => {
      context.set({ workspaceDir: '/workspace' });
      execFileSyncMock.mockReset();
      execFileSyncMock.mockImplementation((_file, args) => {
        if (Array.isArray(args) && args.includes('rev-parse')) {
          return Buffer.from('abc123def456');
        }
        return Buffer.from('');
      });
      context.useMockOctokit();
    });

    it('step 1: skips a module already released for this pull request (no bump, no tag push)', async () => {
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.1.0', 'path/to/test-module/v1.0.0'],
        releases: [
          {
            id: 2,
            title: 'path/to/test-module/v1.1.0',
            tagName: 'path/to/test-module/v1.1.0',
            body: `## v1.1.0\n\nchangelog\n\n${releaseMarker}`,
          },
          {
            id: 1,
            title: 'path/to/test-module/v1.0.0',
            tagName: 'path/to/test-module/v1.0.0',
            body: 'initial release',
          },
        ],
      });
      vi.spyOn(module, 'setReleases');
      vi.spyOn(module, 'setTags');

      expect(module.needsRelease()).toBe(true);
      const result = await createTaggedReleases([module]);

      // Reported as skipped, carrying the release this pull request actually produced.
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        module,
        action: 'skipped',
        releaseTag: 'path/to/test-module/v1.1.0',
      });
      expect(result[0].release.body).toContain(releaseMarker);
      // Nothing was created or pushed, and no provenance lookup was needed.
      expect(context.octokit.rest.repos.createRelease).not.toHaveBeenCalled();
      expect(context.octokit.rest.git.getCommit).not.toHaveBeenCalled();
      expect(execFileSyncMock).not.toHaveBeenCalled();
      expect(module.setReleases).not.toHaveBeenCalled();
      expect(module.setTags).not.toHaveBeenCalled();
      // Commits are cleared so the module no longer needs a release.
      expect(module.needsRelease()).toBe(false);
    });

    it('step 1: in a partial retry, skips already-released modules and releases only the missing one', async () => {
      const releasedModule = createMockTerraformModule({
        directory: '/workspace/path/to/module-a',
        commits: [{ sha: 'aaa', message: 'feat: a', files: ['/workspace/path/to/module-a/main.tf'] }],
        tags: ['path/to/module-a/v1.1.0'],
        releases: [
          {
            id: 10,
            title: 'path/to/module-a/v1.1.0',
            tagName: 'path/to/module-a/v1.1.0',
            body: `## v1.1.0\n\nchangelog\n\n${releaseMarker}`,
          },
        ],
      });
      const missingModule = createMockTerraformModule({
        directory: '/workspace/path/to/module-c',
        commits: [{ sha: 'ccc', message: 'feat: c', files: ['/workspace/path/to/module-c/main.tf'] }],
        tags: ['path/to/module-c/v1.0.0'],
        releases: [{ id: 11, title: 'path/to/module-c/v1.0.0', tagName: 'path/to/module-c/v1.0.0', body: 'older' }],
      });
      stubOctokitReturnData('repos.createRelease', {
        data: { id: 999, name: 'path/to/module-c/v1.1.0', tag_name: 'path/to/module-c/v1.1.0', body: 'changelog' },
      });

      const result = await createTaggedReleases([releasedModule, missingModule]);

      expect(result.map((outcome) => outcome.action)).toStrictEqual(['skipped', 'created']);
      // Only module-c (step 3) is released — exactly one createRelease targeting its bumped tag.
      expect(context.octokit.rest.repos.createRelease).toHaveBeenCalledTimes(1);
      expect(context.octokit.rest.repos.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({ tag_name: 'path/to/module-c/v1.1.0' }),
      );
      expect(execFileSyncMock).toHaveBeenCalledWith(
        expect.anything(),
        ['push', 'origin', 'path/to/module-c/v1.1.0'],
        expect.anything(),
      );
    });

    it('step 2: recreates the release for an orphan tag proven to belong to this pull request', async () => {
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.1.0', 'path/to/test-module/v1.0.0'],
        releases: [
          {
            id: 1,
            title: 'path/to/test-module/v1.0.0',
            tagName: 'path/to/test-module/v1.0.0',
            body: 'older release from a different pull request',
          },
        ],
      });
      vi.spyOn(module, 'setReleases');
      vi.spyOn(module, 'setTags');
      // The orphan tag's commit carries OUR marker -> it is ours to heal.
      stubTagCommitMessage(ourReleaseCommitMessage('path/to/test-module/v1.1.0'));
      stubOctokitReturnData('repos.createRelease', {
        data: {
          id: 555,
          name: 'path/to/test-module/v1.1.0',
          tag_name: 'path/to/test-module/v1.1.0',
          body: 'recreated body',
        },
      });

      const result = await createTaggedReleases([module]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ action: 'recovered', releaseTag: 'path/to/test-module/v1.1.0' });
      // Release created for the EXISTING tag (no bump to v1.2.0).
      expect(context.octokit.rest.repos.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({
          tag_name: 'path/to/test-module/v1.1.0',
          name: 'path/to/test-module/v1.1.0',
        }),
      );
      // No commit/tag/push git operations were performed (release-only recovery).
      expect(execFileSyncMock).not.toHaveBeenCalled();
      // The release was added but tags were not modified (the tag already existed).
      expect(module.setReleases).toHaveBeenCalled();
      expect(module.setTags).not.toHaveBeenCalled();
    });

    it('step 2: falls back to the existing tag name and generated changelog when the API returns null name/body', async () => {
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.1.0', 'path/to/test-module/v1.0.0'],
        releases: [
          {
            id: 1,
            title: 'path/to/test-module/v1.0.0',
            tagName: 'path/to/test-module/v1.0.0',
            body: 'older release from a different pull request',
          },
        ],
      });
      vi.spyOn(module, 'setReleases');
      stubTagCommitMessage(ourReleaseCommitMessage('path/to/test-module/v1.1.0'));
      stubOctokitReturnData('repos.createRelease', {
        data: { id: 556, name: null, tag_name: 'path/to/test-module/v1.1.0', body: null },
      });

      await createTaggedReleases([module]);

      expect(module.setReleases).toHaveBeenCalledOnce();
      const newRelease = vi.mocked(module.setReleases).mock.calls[0][0][0];
      // name was null -> falls back to the existing tag; body was null -> falls back to the generated changelog.
      expect(newRelease.title).toBe('path/to/test-module/v1.1.0');
      expect(newRelease.tagName).toBe('path/to/test-module/v1.1.0');
      expect(newRelease.body).toContain('v1.1.0');
      expect(newRelease.body).toContain('feat: add feature');
    });

    it('step 2 provenance: does NOT adopt an orphan tag carrying another pull request’s marker; bumps instead', async () => {
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.1.0', 'path/to/test-module/v1.0.0'],
        releases: [
          {
            id: 1,
            title: 'path/to/test-module/v1.0.0',
            tagName: 'path/to/test-module/v1.0.0',
            body: 'older release',
          },
        ],
      });
      // The orphan v1.1.0 was pushed by PR #2, whose run died before creating the release.
      stubTagCommitMessage(ourReleaseCommitMessage('path/to/test-module/v1.1.0', otherPrMarker));
      stubOctokitReturnData('repos.createRelease', {
        data: { id: 900, name: 'path/to/test-module/v1.2.0', tag_name: 'path/to/test-module/v1.2.0', body: 'notes' },
      });

      const result = await createTaggedReleases([module]);

      expect(result[0]).toMatchObject({ action: 'created', releaseTag: 'path/to/test-module/v1.2.0' });
      // The foreign orphan tag is left untouched so its owning pull request can still heal it...
      expect(context.octokit.rest.repos.createRelease).not.toHaveBeenCalledWith(
        expect.objectContaining({ tag_name: 'path/to/test-module/v1.1.0' }),
      );
      // ...and this pull request's own changes are released at the next version.
      expect(execFileSyncMock).toHaveBeenCalledWith(
        expect.anything(),
        ['push', 'origin', 'path/to/test-module/v1.2.0'],
        expect.anything(),
      );
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('not produced by this pull request'));
    });

    it('step 2 provenance: does NOT adopt a pre-existing hand-made tag (adoption case); bumps instead', async () => {
      // A repo that tagged modules before adopting this action: the tag exists with no release at all.
      // The old code released onto that tag and never published this pull request's changes.
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.4.0'],
        releases: [],
      });
      stubTagCommitMessage('chore: some unrelated hand-made commit');
      stubOctokitReturnData('repos.createRelease', {
        data: { id: 901, name: 'path/to/test-module/v1.5.0', tag_name: 'path/to/test-module/v1.5.0', body: 'notes' },
      });

      const result = await createTaggedReleases([module]);

      expect(result[0]).toMatchObject({ action: 'created', releaseTag: 'path/to/test-module/v1.5.0' });
      expect(context.octokit.rest.repos.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({ tag_name: 'path/to/test-module/v1.5.0' }),
      );
      expect(execFileSyncMock).toHaveBeenCalledWith(
        expect.anything(),
        ['push', 'origin', 'path/to/test-module/v1.5.0'],
        expect.anything(),
      );
    });

    it('step 2 provenance: adopts a pre-marker tag via the commit-shape fallback', async () => {
      // Tag created by an older version of the action: no marker, but the release commit still has our
      // known shape (first line is the tag, body contains the pull request title).
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.1.0', 'path/to/test-module/v1.0.0'],
        releases: [
          { id: 1, title: 'path/to/test-module/v1.0.0', tagName: 'path/to/test-module/v1.0.0', body: 'older' },
        ],
      });
      stubTagCommitMessage('path/to/test-module/v1.1.0\n\nTest Pull Request\n\nThis is a test pull request body.');
      stubOctokitReturnData('repos.createRelease', {
        data: { id: 902, name: 'path/to/test-module/v1.1.0', tag_name: 'path/to/test-module/v1.1.0', body: 'notes' },
      });

      const result = await createTaggedReleases([module]);

      expect(result[0]).toMatchObject({ action: 'recovered', releaseTag: 'path/to/test-module/v1.1.0' });
      expect(execFileSyncMock).not.toHaveBeenCalled();
    });

    it('step 2 provenance: treats an unresolvable tag commit as not ours and bumps', async () => {
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.1.0', 'path/to/test-module/v1.0.0'],
        releases: [
          { id: 1, title: 'path/to/test-module/v1.0.0', tagName: 'path/to/test-module/v1.0.0', body: 'older' },
        ],
      });
      // An annotated tag object, a deleted commit, or a transient failure.
      vi.mocked(context.octokit.rest.git.getCommit).mockRejectedValueOnce(
        new RequestError('Not Found', 404, {
          request: { method: 'GET', url: '', headers: {} },
          response: { status: 404, url: '', headers: {}, data: {} },
        }),
      );
      stubOctokitReturnData('repos.createRelease', {
        data: { id: 903, name: 'path/to/test-module/v1.2.0', tag_name: 'path/to/test-module/v1.2.0', body: 'notes' },
      });

      const result = await createTaggedReleases([module]);

      expect(result[0]).toMatchObject({ action: 'created', releaseTag: 'path/to/test-module/v1.2.0' });
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('to verify ownership'));
    });

    it('step 2 provenance: treats a non-Error rejection as not ours and bumps', async () => {
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.1.0', 'path/to/test-module/v1.0.0'],
        releases: [
          { id: 1, title: 'path/to/test-module/v1.0.0', tagName: 'path/to/test-module/v1.0.0', body: 'older' },
        ],
      });
      vi.mocked(context.octokit.rest.git.getCommit).mockRejectedValueOnce('boom string');
      stubOctokitReturnData('repos.createRelease', {
        data: { id: 904, name: 'path/to/test-module/v1.2.0', tag_name: 'path/to/test-module/v1.2.0', body: 'notes' },
      });

      const result = await createTaggedReleases([module]);

      expect(result[0]).toMatchObject({ action: 'created' });
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('boom string'));
    });

    it('step 1b: skips when the release body was edited but the tag is provably ours', async () => {
      // A maintainer (or GitHub's "Generate release notes") rewrote the body, stripping the marker.
      // Without the commit-message corroboration this would bump and publish a duplicate release.
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.1.0', 'path/to/test-module/v1.0.0'],
        releases: [
          {
            id: 2,
            title: 'path/to/test-module/v1.1.0',
            tagName: 'path/to/test-module/v1.1.0',
            body: 'Hand-edited release notes with no marker',
          },
          { id: 1, title: 'path/to/test-module/v1.0.0', tagName: 'path/to/test-module/v1.0.0', body: 'older' },
        ],
      });
      stubTagCommitMessage(ourReleaseCommitMessage('path/to/test-module/v1.1.0'));

      const result = await createTaggedReleases([module]);

      expect(result[0]).toMatchObject({ action: 'skipped', releaseTag: 'path/to/test-module/v1.1.0' });
      expect(context.octokit.rest.repos.createRelease).not.toHaveBeenCalled();
      expect(execFileSyncMock).not.toHaveBeenCalled();
    });

    it('step 1b: does not skip when the latest release belongs to another pull request', async () => {
      // The latest release carries PR #2's marker, so it is unambiguously not ours: no provenance
      // lookup is needed and we must bump normally.
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.1.0'],
        releases: [
          {
            id: 2,
            title: 'path/to/test-module/v1.1.0',
            tagName: 'path/to/test-module/v1.1.0',
            body: `notes\n\n${otherPrMarker}`,
          },
        ],
      });
      stubOctokitReturnData('repos.createRelease', {
        data: { id: 905, name: 'path/to/test-module/v1.2.0', tag_name: 'path/to/test-module/v1.2.0', body: 'notes' },
      });

      const result = await createTaggedReleases([module]);

      expect(result[0]).toMatchObject({ action: 'created', releaseTag: 'path/to/test-module/v1.2.0' });
      expect(context.octokit.rest.git.getCommit).not.toHaveBeenCalled();
    });

    it('step 3: performs a normal bumped release, stamping the marker into the body AND the commit', async () => {
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.0.0'],
        releases: [
          {
            id: 1,
            title: 'path/to/test-module/v1.0.0',
            tagName: 'path/to/test-module/v1.0.0',
            body: 'older release from a different pull request',
          },
        ],
      });
      vi.spyOn(module, 'setReleases');
      vi.spyOn(module, 'setTags');
      stubOctokitReturnData('repos.createRelease', {
        data: {
          id: 777,
          name: 'path/to/test-module/v1.1.0',
          tag_name: 'path/to/test-module/v1.1.0',
          body: 'changelog',
        },
      });

      const result = await createTaggedReleases([module]);

      expect(result[0]).toMatchObject({ action: 'created', releaseTag: 'path/to/test-module/v1.1.0' });
      // Version bumped to v1.1.0 and a new tag pushed.
      expect(context.octokit.rest.repos.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({ tag_name: 'path/to/test-module/v1.1.0' }),
      );
      // The created release body carries the hidden marker so future re-runs detect it.
      expect(context.octokit.rest.repos.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining(releaseMarker) }),
      );
      // The release COMMIT also carries the marker, which is what makes the tag provable later.
      const commitCall = execFileSyncMock.mock.calls.find((call) => Array.isArray(call[1]) && call[1][0] === 'commit');
      expect(commitCall?.[1]?.[2]).toContain(releaseMarker);
      expect(execFileSyncMock).toHaveBeenCalledWith(
        expect.anything(),
        ['push', 'origin', 'path/to/test-module/v1.1.0'],
        expect.anything(),
      );
      expect(module.setTags).toHaveBeenCalled();
      expect(module.setReleases).toHaveBeenCalled();
    });

    it('legacy gate: skips (returns []) when a legacy release comment exists and no release carries the marker', async () => {
      // A pull request completed under the pre-marker scheme: its post-release comment uses the legacy
      // marker and none of its releases carry our new marker. Preserve the old "don't double-release".
      stubOctokitReturnData('issues.listComments', {
        data: [{ id: 1, body: `${LEGACY_PR_RELEASE_COMMENT_MARKER}\nThe following modules have been released:` }],
      });
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.0.0'],
        releases: [
          {
            id: 1,
            title: 'path/to/test-module/v1.0.0',
            tagName: 'path/to/test-module/v1.0.0',
            body: 'legacy release body with no marker',
          },
        ],
      });

      const result = await createTaggedReleases([module]);

      expect(result).toStrictEqual([]);
      expect(context.octokit.rest.repos.createRelease).not.toHaveBeenCalled();
      expect(execFileSyncMock).not.toHaveBeenCalled();
    });

    it('legacy gate: does NOT fire when a release already carries our marker, even alongside a legacy comment', async () => {
      // Pins the `!anyReleaseHasMarker` conjunct: dropping it would make this pull request skip instead
      // of self-healing. The legacy comment is present, but a release proves we already ran under the
      // current scheme, so the gate must not apply.
      stubOctokitReturnData('issues.listComments', {
        data: [{ id: 1, body: `${LEGACY_PR_RELEASE_COMMENT_MARKER}\nThe following modules have been released:` }],
      });
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.1.0'],
        releases: [
          {
            id: 2,
            title: 'path/to/test-module/v1.1.0',
            tagName: 'path/to/test-module/v1.1.0',
            body: `notes\n\n${releaseMarker}`,
          },
        ],
      });

      const result = await createTaggedReleases([module]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ action: 'skipped', releaseTag: 'path/to/test-module/v1.1.0' });
    });

    it('legacy gate: still self-heals when the post-release comment uses the current (versioned) marker', async () => {
      // The post-release comment is from the current scheme (PR_RELEASE_COMMENT_MARKER), so the pull request is
      // NOT legacy even though no surviving release carries the marker (the release was deleted). The
      // orphan tag is recovered rather than skipped.
      stubOctokitReturnData('issues.listComments', {
        data: [{ id: 1, body: `${PR_RELEASE_COMMENT_MARKER}\nThe following modules have been released:` }],
      });
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.1.0', 'path/to/test-module/v1.0.0'],
        releases: [
          {
            id: 1,
            title: 'path/to/test-module/v1.0.0',
            tagName: 'path/to/test-module/v1.0.0',
            body: 'older release from a different pull request',
          },
        ],
      });
      stubTagCommitMessage(ourReleaseCommitMessage('path/to/test-module/v1.1.0'));
      stubOctokitReturnData('repos.createRelease', {
        data: {
          id: 999,
          name: 'path/to/test-module/v1.1.0',
          tag_name: 'path/to/test-module/v1.1.0',
          body: 'recreated body',
        },
      });

      const result = await createTaggedReleases([module]);

      expect(result[0]).toMatchObject({ action: 'recovered', releaseTag: 'path/to/test-module/v1.1.0' });
      // Orphan tag v1.1.0 recreated (step 2) — not skipped as legacy, and no bump to v1.2.0.
      expect(context.octokit.rest.repos.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({ tag_name: 'path/to/test-module/v1.1.0' }),
      );
      expect(context.octokit.rest.repos.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining(releaseMarker) }),
      );
    });

    it('legacy gate: fails closed when the comment list cannot be read', async () => {
      // A transient failure must not be silently read as "not legacy" — that would over-bump and
      // double-release a legacy pull request. Failing is safe: the re-run is idempotent.
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.0.0'],
        releases: [
          { id: 1, title: 'path/to/test-module/v1.0.0', tagName: 'path/to/test-module/v1.0.0', body: 'no marker' },
        ],
      });
      vi.mocked(context.octokit.rest.issues.listComments).mockRejectedValueOnce(
        new RequestError('server blew up', 502, {
          request: { method: 'GET', url: '', headers: {} },
          response: { status: 502, url: '', headers: {}, data: {} },
        }),
      );

      await expect(createTaggedReleases([module])).rejects.toThrow('Failed to check for a legacy release comment');
      expect(context.octokit.rest.repos.createRelease).not.toHaveBeenCalled();
      expect(execFileSyncMock).not.toHaveBeenCalled();
    });

    it('step 2 provenance: cannot verify a tag with no resolvable commit SHA, so it bumps', async () => {
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        releases: [
          { id: 1, title: 'path/to/test-module/v1.0.0', tagName: 'path/to/test-module/v1.0.0', body: 'older' },
        ],
      });
      // A tag whose commit SHA is unknown (e.g. an unresolved ref) offers no proof of ownership.
      module.setTags([{ name: 'path/to/test-module/v1.1.0', commitSHA: '' }]);
      stubOctokitReturnData('repos.createRelease', {
        data: { id: 906, name: 'path/to/test-module/v1.2.0', tag_name: 'path/to/test-module/v1.2.0', body: 'notes' },
      });

      const result = await createTaggedReleases([module]);

      expect(result[0]).toMatchObject({ action: 'created', releaseTag: 'path/to/test-module/v1.2.0' });
      expect(context.octokit.rest.git.getCommit).not.toHaveBeenCalled();
    });

    it('step 2 provenance: treats a commit with a null message as not attributable', async () => {
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.1.0', 'path/to/test-module/v1.0.0'],
        releases: [
          { id: 1, title: 'path/to/test-module/v1.0.0', tagName: 'path/to/test-module/v1.0.0', body: 'older' },
        ],
      });
      // The generated Octokit types declare `message` as non-nullable; cast to reproduce a null.
      stubOctokitReturnData('git.getCommit', { data: { message: null as unknown as string } });
      stubOctokitReturnData('repos.createRelease', {
        data: { id: 907, name: 'path/to/test-module/v1.2.0', tag_name: 'path/to/test-module/v1.2.0', body: 'notes' },
      });

      const result = await createTaggedReleases([module]);

      expect(result[0]).toMatchObject({ action: 'created', releaseTag: 'path/to/test-module/v1.2.0' });
    });

    it('initial release: a module with no tags at all skips provenance entirely and creates the first tag', async () => {
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: brand new module', files: [`${directory}/main.tf`] }],
      });
      stubOctokitReturnData('repos.createRelease', {
        data: { id: 908, name: 'path/to/test-module/v1.0.0', tag_name: 'path/to/test-module/v1.0.0', body: 'notes' },
      });

      const result = await createTaggedReleases([module]);

      expect(result[0]).toMatchObject({ action: 'created' });
      expect(context.octokit.rest.git.getCommit).not.toHaveBeenCalled();
    });

    it('surfaces permissions remediation when the Releases API rejects with a 403', async () => {
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.0.0'],
        releases: [
          { id: 1, title: 'path/to/test-module/v1.0.0', tagName: 'path/to/test-module/v1.0.0', body: 'older' },
        ],
      });
      vi.mocked(context.octokit.rest.repos.createRelease).mockRejectedValueOnce(
        new RequestError('Resource not accessible by integration', 403, {
          request: { method: 'POST', url: '', headers: {} },
          response: { status: 403, url: '', headers: {}, data: {} },
        }),
      );

      await expect(createTaggedReleases([module])).rejects.toThrow(/contents: write/);
    });

    it('neutralizes a marker forged in the pull request body before it reaches the release commit', async () => {
      // The release commit message is the provenance oracle. `git commit -m` uses cleanup=whitespace, so
      // a marker planted on its own line in a PR description would otherwise survive verbatim into it and
      // let the forged pull request adopt or skip against this tag.
      const forged = buildPrMarker(2);
      context.set({ prBody: `Fixes something.\n\n${forged}` });

      try {
        const module = createMockTerraformModule({
          directory,
          commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
          tags: ['path/to/test-module/v1.0.0'],
          releases: [
            { id: 1, title: 'path/to/test-module/v1.0.0', tagName: 'path/to/test-module/v1.0.0', body: 'older' },
          ],
        });
        stubOctokitReturnData('repos.createRelease', {
          data: { id: 910, name: 'path/to/test-module/v1.1.0', tag_name: 'path/to/test-module/v1.1.0', body: 'notes' },
        });

        await createTaggedReleases([module]);

        const commitCall = execFileSyncMock.mock.calls.find(
          (call) => Array.isArray(call[1]) && call[1][0] === 'commit',
        );
        const commitMessage = String(commitCall?.[1]?.[2]);

        // The forged marker is escaped and no longer attributable to PR #2...
        expect(matchesPrMarker(commitMessage, 2)).toBe(false);
        expect(commitMessage).toContain('&lt;!--');
        // ...while this pull request's genuine trailing marker still is.
        expect(matchesPrMarker(commitMessage, 1)).toBe(true);
      } finally {
        context.set({ prBody: 'This is a test pull request body.' });
      }
    });

    it('pre-marker fallback: rejects a tag whose commit merely CONTAINS this pull request title', async () => {
      // Bots (Renovate/Dependabot) reuse titles byte-for-byte, so a substring test would make collisions
      // routine. The fallback requires the exact shape this action writes: line 1 = tag, line 3 = title.
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.1.0', 'path/to/test-module/v1.0.0'],
        releases: [
          { id: 1, title: 'path/to/test-module/v1.0.0', tagName: 'path/to/test-module/v1.0.0', body: 'older' },
        ],
      });
      // Another pull request's release commit that merely mentions our title inside its body.
      stubTagCommitMessage('path/to/test-module/v1.1.0\n\nSome other title\n\nReverts Test Pull Request from before');
      stubOctokitReturnData('repos.createRelease', {
        data: { id: 911, name: 'path/to/test-module/v1.2.0', tag_name: 'path/to/test-module/v1.2.0', body: 'notes' },
      });

      const result = await createTaggedReleases([module]);

      expect(result[0]).toMatchObject({ action: 'created', releaseTag: 'path/to/test-module/v1.2.0' });
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('not produced by this pull request'));
    });

    it('step 1b: the pre-marker heuristic may recover, but must never SKIP a release', async () => {
      // Skipping is irreversible — it drops a genuine release forever. Recovery leaves a state a re-run
      // can still correct. So step 1b demands a real marker; the shape heuristic is not enough.
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        tags: ['path/to/test-module/v1.1.0'],
        releases: [
          {
            id: 2,
            title: 'path/to/test-module/v1.1.0',
            tagName: 'path/to/test-module/v1.1.0',
            body: 'A legacy release body with no marker at all',
          },
        ],
      });
      // Shape matches (heuristic), but there is no marker.
      stubTagCommitMessage('path/to/test-module/v1.1.0\n\nTest Pull Request\n\nThis is a test pull request body.');
      stubOctokitReturnData('repos.createRelease', {
        data: { id: 912, name: 'path/to/test-module/v1.2.0', tag_name: 'path/to/test-module/v1.2.0', body: 'notes' },
      });

      const result = await createTaggedReleases([module]);

      expect(result[0]).toMatchObject({ action: 'created', releaseTag: 'path/to/test-module/v1.2.0' });
      expect(context.octokit.rest.repos.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({ tag_name: 'path/to/test-module/v1.2.0' }),
      );
    });

    it('step 2: heals an orphan tag that is no longer the latest (a later pull request bumped past it)', async () => {
      // PR #1 pushed v1.1.0 then died before createRelease. PR #2 merged and released v1.2.0. Without
      // widening the search, #1's re-run would bump to v1.3.0 and publish its older tree as the newest
      // version, leaving v1.1.0 orphaned forever.
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        releases: [
          {
            id: 2,
            title: 'path/to/test-module/v1.2.0',
            tagName: 'path/to/test-module/v1.2.0',
            body: `other PR notes\n\n${otherPrMarker}`,
          },
        ],
      });
      module.setTags([
        { name: 'path/to/test-module/v1.2.0', commitSHA: 'sha-v120' },
        { name: 'path/to/test-module/v1.1.0', commitSHA: 'sha-v110' },
      ]);
      stubTagCommitMessage(ourReleaseCommitMessage('path/to/test-module/v1.1.0'));
      stubOctokitReturnData('repos.createRelease', {
        data: { id: 920, name: 'path/to/test-module/v1.1.0', tag_name: 'path/to/test-module/v1.1.0', body: 'notes' },
      });

      const result = await createTaggedReleases([module]);

      expect(result[0]).toMatchObject({ action: 'recovered', releaseTag: 'path/to/test-module/v1.1.0' });
      // Healed at its original version — no bump, no new tag pushed.
      expect(context.octokit.rest.repos.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({ tag_name: 'path/to/test-module/v1.1.0' }),
      );
      expect(execFileSyncMock).not.toHaveBeenCalled();
      // v1.2.0 already has a release carrying another PR's marker, so it costs no provenance lookup.
      expect(context.octokit.rest.git.getCommit).toHaveBeenCalledTimes(1);
    });

    it('step 2: picks the newest orphan tag that is ours, skipping foreign ones', async () => {
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        releases: [],
      });
      module.setTags([
        { name: 'path/to/test-module/v1.3.0', commitSHA: 'sha-foreign' },
        { name: 'path/to/test-module/v1.2.0', commitSHA: 'sha-ours' },
        { name: 'path/to/test-module/v1.1.0', commitSHA: 'sha-older-ours' },
      ]);
      stubOctokitImplementation('git.getCommit', ({ commit_sha }) => ({
        data: {
          message:
            commit_sha === 'sha-foreign'
              ? ourReleaseCommitMessage('path/to/test-module/v1.3.0', otherPrMarker)
              : ourReleaseCommitMessage(`path/to/test-module/v1.${commit_sha === 'sha-ours' ? 2 : 1}.0`),
        },
        status: 200,
        url: 'https://api.github.com/repos/techpivot/terraform-module-releaser/git/commits',
        headers: {},
      }));
      stubOctokitReturnData('repos.createRelease', {
        data: { id: 921, name: 'path/to/test-module/v1.2.0', tag_name: 'path/to/test-module/v1.2.0', body: 'notes' },
      });

      const result = await createTaggedReleases([module]);

      // v1.3.0 is foreign; v1.2.0 is the newest one that is ours.
      expect(result[0]).toMatchObject({ action: 'recovered', releaseTag: 'path/to/test-module/v1.2.0' });
    });

    it('step 2: caps how many orphan tags are inspected and says so', async () => {
      const module = createMockTerraformModule({
        directory,
        commits: [{ sha: 'abc123', message: 'feat: add feature', files: [`${directory}/main.tf`] }],
        releases: [],
      });
      module.setTags([
        { name: 'path/to/test-module/v1.5.0', commitSHA: 'sha5' },
        { name: 'path/to/test-module/v1.4.0', commitSHA: 'sha4' },
        { name: 'path/to/test-module/v1.3.0', commitSHA: 'sha3' },
        { name: 'path/to/test-module/v1.2.0', commitSHA: 'sha2' },
        { name: 'path/to/test-module/v1.1.0', commitSHA: 'sha1' },
      ]);
      // None are attributable, so every inspected tag costs a lookup.
      stubTagCommitMessage('unrelated hand-made commit');
      stubOctokitReturnData('repos.createRelease', {
        data: { id: 922, name: 'path/to/test-module/v1.6.0', tag_name: 'path/to/test-module/v1.6.0', body: 'notes' },
      });

      const result = await createTaggedReleases([module]);

      expect(context.octokit.rest.git.getCommit).toHaveBeenCalledTimes(3);
      expect(info).toHaveBeenCalledWith(expect.stringContaining('only the newest 3 are checked'));
      expect(result[0]).toMatchObject({ action: 'created', releaseTag: 'path/to/test-module/v1.6.0' });
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('not produced by this pull request'));
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
