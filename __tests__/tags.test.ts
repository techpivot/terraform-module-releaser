import { beforeEach } from 'node:test';
import { config } from '@/mocks/config';
import { context } from '@/mocks/context';
import { deleteLegacyTags, getAllTags } from '@/tags';
import { stubOctokitReturnData } from '@/tests/helpers/octokit';
import { debug, endGroup, info, startGroup } from '@actions/core';
import { RequestError } from '@octokit/request-error';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

describe('tags', () => {
  const url = 'https://api.github.com/repos/techpivot/terraform-module-releaser/tags';

  describe('getAllTags() - real API queries', () => {
    beforeAll(async () => {
      // Check if GITHUB_TOKEN is available for real API calls
      if (!process.env.GITHUB_TOKEN) {
        throw new Error('GITHUB_TOKEN environment variable must be set for these tests');
      }

      // Use the context helper to switch to real Octokit
      await context.useRealOctokit();
    });

    afterAll(() => {
      // Reset back to mock Octokit after tests
      context.useMockOctokit();
    });

    it('should successfully fetch tags from the real repository', async () => {
      const tags = await getAllTags();

      expect(Array.isArray(tags)).toBe(true);

      // Known tags
      const knownTags = ['v1.3.1', 'v1.3.0', 'v1.2.0', 'v1.1.1', 'v1.1.0', 'v1.0.1', 'v1.0.0', 'v1'];
      // Ensure all known tags are present in the fetched tags using a for...of loop
      for (const tag of knownTags) {
        expect(tags).toContain(tag);
      }

      expect(startGroup).toHaveBeenCalledWith('Fetching repository tags');
      expect(info).toHaveBeenCalledWith(expect.stringMatching(/Found \d+ tags?./));
      expect(endGroup).toBeCalledTimes(1);
    });

    it('should handle pagination correctly with real API calls', async () => {
      const pageLimit = 5;

      // Now fetch with small page size
      const tagsWithPagination = await getAllTags({ per_page: pageLimit });
      expect(tagsWithPagination.length).toBeGreaterThan(pageLimit);

      // Check the first debug call for "Total page requests: X" where X > 1
      const debugCall = vi.mocked(debug).mock.calls[0]; // Get the first call
      expect(debugCall).toBeDefined(); // Ensure there is a debug call
      const debugMessage = debugCall[0];
      expect(/^Total page requests: \d+$/.test(debugMessage)).toBe(true); // Check if it matches the format
      expect(Number.parseInt(debugMessage.split(': ')[1])).toBeGreaterThan(1); // Check if number > 1

      // Check the first info call for "Found X tags"
      const infoCall = vi.mocked(info).mock.calls[0]; // Get the first call
      expect(infoCall).toBeDefined(); // Ensure there is a info call
      const infoMessage = infoCall[0];
      expect(/^Found ([2-9]|\d\d+) tags\.$/.test(infoMessage)).toBe(true); // Check if it matches the format
    });
  });

  describe('getAllTags() - pagination', () => {
    beforeAll(() => {
      // Reset to mock Octokit before each test
      context.useMockOctokit();
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should fetch all available tags when pagination is required', async () => {
      const mockTagData = [{ name: 'v2.0.0' }, { name: 'v2.0.1' }, { name: 'v2.0.2' }];
      const expectedTags = mockTagData.map((tag) => tag.name);

      stubOctokitReturnData('repos.listTags', mockTagData);
      const tags = await getAllTags({ per_page: 1 });

      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBe(3);

      // Exact match of known tags to ensure no unexpected tags are included
      expect(tags).toEqual(expectedTags);

      // Additional assertions to verify pagination calls and debug info
      expect(info).toHaveBeenCalledWith('Found 3 tags.');
      expect(vi.mocked(debug).mock.calls).toEqual([
        ['Total page requests: 3'],
        [JSON.stringify(expectedTags, null, 2)],
      ]);
    });

    it('should output singular "tag" when only one', async () => {
      const mockTagData = [{ name: 'v4.0.0' }];
      const expectedTags = mockTagData.map((tag) => tag.name);

      stubOctokitReturnData('repos.listTags', mockTagData);
      const tags = await getAllTags({ per_page: 1 });

      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBe(1);

      // Exact match of known tags to ensure no unexpected tags are included
      expect(tags).toEqual(expectedTags);

      // Additional assertions to verify pagination calls and debug info
      expect(info).toHaveBeenCalledWith('Found 1 tag.');
      expect(vi.mocked(debug).mock.calls).toEqual([
        ['Total page requests: 1'],
        [JSON.stringify(expectedTags, null, 2)],
      ]);
    });

    it('should fetch all available tags when pagination is not required', async () => {
      stubOctokitReturnData('repos.listTags', [{ name: 'v2.0.0' }, { name: 'v2.0.1' }, { name: 'v2.0.2' }]);

      const tags = await getAllTags({ per_page: 20 });

      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBe(3);

      // Exact match of known tags to ensure no unexpected tags are included
      const expectedTags = ['v2.0.0', 'v2.0.1', 'v2.0.2'];
      expect(tags).toEqual(expectedTags);

      // Additional assertions to verify pagination calls and debug info
      expect(debug).toHaveBeenCalledWith(expect.stringMatching(/Total page requests: 1/));
      expect(info).toHaveBeenCalledWith(expect.stringMatching(/Found 3 tags/));
    });
  });

  describe('getAllTags() - error handling', () => {
    beforeAll(() => {
      // Reset to mock Octokit before each test
      context.useMockOctokit();
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should handle API request errors gracefully', async () => {
      const errorMessage = 'API rate limit exceeded';

      // Mock the paginate.iterator method to throw a RequestError
      vi.spyOn(context.octokit.paginate, 'iterator').mockImplementationOnce(() => {
        throw new RequestError(errorMessage, 403, {
          request: { method: 'GET', url, headers: {} },
          response: { status: 403, url, headers: {}, data: {} },
        });
      });
      try {
        await getAllTags();
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(`Failed to fetch tags: ${errorMessage} (status: 403)`);
        expect((error as Error).cause).toBeInstanceOf(RequestError);
        expect(((error as Error).cause as RequestError).message).toBe(errorMessage);
      }

      expect(startGroup).toHaveBeenCalledWith('Fetching repository tags');
      expect(endGroup).toHaveBeenCalledOnce();
    });

    it('should handle non-RequestError errors', async () => {
      const errorMessage = 'Network error';

      vi.spyOn(context.octokit.paginate, 'iterator').mockImplementationOnce(() => {
        throw new Error(errorMessage);
      });

      try {
        await getAllTags();
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(`Failed to fetch tags: ${errorMessage}`);
        expect((error as Error).cause).toBeInstanceOf(Error);
        expect(((error as Error).cause as Error).message).toBe(errorMessage);
      }

      expect(startGroup).toHaveBeenCalledWith('Fetching repository tags');
      expect(endGroup).toHaveBeenCalledOnce();
    });

    it('should handle unknown error types', async () => {
      const consoleTimeEndSpy = vi.spyOn(console, 'timeEnd');
      const errorMessage = 'Unknown error with trailing space ';

      vi.spyOn(context.octokit.paginate, 'iterator').mockImplementationOnce(() => {
        throw errorMessage; // Throwing a string directly
      });

      try {
        await getAllTags();
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(errorMessage.trim());
        expect((error as Error).cause).toBe(errorMessage);
      }

      expect(startGroup).toHaveBeenCalledWith('Fetching repository tags');
      expect(endGroup).toHaveBeenCalledOnce();
      expect(consoleTimeEndSpy).toHaveBeenCalledWith('Elapsed time fetching tags');
    });
  });

  describe('deleteLegacyTags()', () => {
    const mockOwner = 'techpivot';
    const mockRepo = 'terraform-module-releaser';
    const mockTerraformModuleNames = ['moduleA', 'moduleB'];

    beforeEach(() => {
      context.useMockOctokit();
    });

    it('should do nothing when deleteLegacyTags is false', async () => {
      config.set({ deleteLegacyTags: false });
      await deleteLegacyTags([], []);
      expect(info).toHaveBeenCalledWith('Deletion of legacy tags/releases is disabled. Skipping.');
      expect(context.octokit.rest.git.deleteRef).not.toHaveBeenCalled();
      expect(startGroup).not.toHaveBeenCalled();
      expect(endGroup).not.toHaveBeenCalled();
    });

    it('should do nothing when no tags to delete', async () => {
      const allTags = ['moduleA/v1.0.0', 'moduleB/v1.0.0'];
      config.set({ deleteLegacyTags: true });
      await deleteLegacyTags([], allTags);
      expect(vi.mocked(startGroup).mock.calls).toEqual([['Deleting legacy Terraform module tags']]);
      expect(vi.mocked(info).mock.calls).toEqual([['No legacy tags found to delete. Skipping.']]);
      expect(context.octokit.rest.git.deleteRef).not.toHaveBeenCalled();
      expect(endGroup).toHaveBeenCalled();
    });

    it('should delete legacy tags when they exist', async () => {
      const allTags = ['moduleA/v1.0.0', 'moduleB/v1.0.0', 'moduleC/v1.0.0'];
      const expectedTagsToDelete = ['moduleA/v1.0.0', 'moduleB/v1.0.0'];

      await deleteLegacyTags(mockTerraformModuleNames, allTags);

      expect(context.octokit.rest.git.deleteRef).toHaveBeenCalledTimes(expectedTagsToDelete.length);
      for (const tag of expectedTagsToDelete) {
        expect(context.octokit.rest.git.deleteRef).toHaveBeenCalledWith({
          owner: mockOwner,
          repo: mockRepo,
          ref: `tags/${tag}`,
        });
      }
      expect(info).toHaveBeenCalledWith('Found 2 legacy tags to delete.');
      expect(info).toHaveBeenCalledWith(JSON.stringify(expectedTagsToDelete, null, 2));
      expect(endGroup).toHaveBeenCalled();
    });

    it('should handle permission errors with helpful message', async () => {
      config.set({ deleteLegacyTags: true });
      const moduleNames = ['module1'];
      const allTags = ['module1/v1.0.0'];

      vi.mocked(context.octokit.rest.git.deleteRef).mockRejectedValueOnce(
        new RequestError('Resource not accessible by integration', 403, {
          request: { method: 'DELETE', url, headers: {} },
          response: { status: 403, url, headers: {}, data: {} },
        }),
      );

      await expect(deleteLegacyTags(moduleNames, allTags)).rejects.toThrow(
        `Failed to delete repository tag: module1/v1.0.0 Resource not accessible by integration.
Ensure that the GitHub Actions workflow has the correct permissions to delete tags by ensuring that your workflow YAML file has the following block under \"permissions\":

permissions:
  contents: write`,
      );
      expect(endGroup).toHaveBeenCalled();
    });

    it('should handle non-permission errors', async () => {
      config.set({ deleteLegacyTags: true });
      const moduleNames = ['module1'];
      const allTags = ['module1/v1.0.0'];

      vi.mocked(context.octokit.rest.git.deleteRef).mockRejectedValueOnce(
        new RequestError('Not Found', 404, {
          request: { method: 'DELETE', url, headers: {} },
          response: { status: 404, url, headers: {}, data: {} },
        }),
      );

      await expect(deleteLegacyTags(moduleNames, allTags)).rejects.toThrow(
        'Failed to delete tag: [Status = 404] Not Found',
      );
      expect(endGroup).toHaveBeenCalled();
    });
  });
});
