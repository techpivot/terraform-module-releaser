import { config } from '@/mocks/config';
import { context } from '@/mocks/context';
import { addPostReleaseComment, addReleasePlanComment, getPullRequestCommits, hasReleaseComment } from '@/pull-request';
import type { TerraformModule } from '@/terraform-module';
import { stubOctokitImplementation, stubOctokitReturnData } from '@/tests/helpers/octokit';
import { createMockTerraformModule } from '@/tests/helpers/terraform-module';
import type { GitHubRelease } from '@/types';
import { BRANDING_COMMENT, PR_RELEASE_MARKER, PR_SUMMARY_MARKER, WIKI_STATUS } from '@/utils/constants';
import { debug, endGroup, info, startGroup } from '@actions/core';
import { RequestError } from '@octokit/request-error';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe('pull-request', () => {
  describe('hasReleaseComment() - real API queries', () => {
    beforeAll(async () => {
      if (!process.env.GITHUB_TOKEN) {
        throw new Error('GITHUB_TOKEN environment variable must be set for these tests');
      }
      await context.useRealOctokit();
    });

    it('should return false for PR #111 (no release comment)', async () => {
      context.set({ prNumber: 111, issueNumber: 111 });
      expect(await hasReleaseComment()).toBe(false);
    });

    it('should return true for PR #8 (release comment)', async () => {
      context.set({ repo: { owner: 'techpivot', repo: 'terraform-modules-demo' }, prNumber: 8, issueNumber: 8 });
      expect(await hasReleaseComment()).toBe(true);
    });

    it('should return false for PR #1 (release comment - non github-actions)', async () => {
      context.set({ repo: { owner: 'techpivot', repo: 'terraform-modules-demo' }, prNumber: 1, issueNumber: 1 });
      expect(await hasReleaseComment()).toBe(false);
    });

    it('should handle 401 error gracefully', async () => {
      // Temporarily clear token to force 401
      vi.stubEnv('GITHUB_TOKEN', '');
      await context.useRealOctokit(); // Initializes a new Octokit using the empty GITHUB_TOKEN
      await expect(hasReleaseComment()).rejects.toThrow(
        'Error checking PR comments: Bad credentials - https://docs.github.com/rest',
      );
    });
  });

  describe('hasReleaseComment()', () => {
    beforeAll(() => {
      context.useMockOctokit();
    });

    it('should return true when release marker is found in comments', async () => {
      stubOctokitReturnData('issues.listComments', {
        data: [
          { user: { id: 123 }, body: 'Some comment' },
          { user: { id: 123 }, body: PR_RELEASE_MARKER },
          { user: { id: 123 }, body: 'Another comment' },
        ],
      });
      expect(await hasReleaseComment()).toBe(true);
    });

    it('should return false when no release marker is found', async () => {
      stubOctokitReturnData('issues.listComments', {
        data: [
          { user: { id: 4444 }, body: 'Some comment' },
          { user: { id: 234234 }, body: 'Another comment' },
        ],
      });
      expect(await hasReleaseComment()).toBe(false);
    });

    it('should handle empty comments array', async () => {
      stubOctokitReturnData('issues.listComments', { data: [] });
      expect(await hasReleaseComment()).toBe(false);
    });

    it('should handle 403 errors', async () => {
      const errorMessage = 'Permissions error testing';
      vi.mocked(context.octokit.rest.issues.listComments).mockRejectedValueOnce(
        new RequestError(errorMessage, 403, {
          request: { method: 'GET', url: '', headers: {} },
          response: { status: 403, url: '', headers: {}, data: {} },
        }),
      );
      await expect(hasReleaseComment()).rejects.toThrow(
        `Unable to read and write pull requests due to insufficient permissions. Ensure the workflow permissions.pull-requests is set to "write".\n${errorMessage}`,
      );
    });

    it('should handle request errors', async () => {
      const errorMessage = 'Generic error testing';

      vi.mocked(context.octokit.rest.issues.listComments).mockRejectedValueOnce(
        new RequestError(errorMessage, 410, {
          request: { method: 'GET', url: '', headers: {} },
          response: { status: 410, url: '', headers: {}, data: {} },
        }),
      );
      await expect(hasReleaseComment()).rejects.toThrow(`Error checking PR comments: ${errorMessage}`);

      vi.mocked(context.octokit.rest.issues.listComments).mockRejectedValueOnce(errorMessage);

      try {
        await hasReleaseComment();
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(`Error checking PR comments: ${errorMessage}`);
        expect((error as Error).cause).toBe(errorMessage);
      }
    });
  });

  describe('getPullRequestCommits() - real API queries', () => {
    beforeAll(async () => {
      if (!process.env.GITHUB_TOKEN) {
        throw new Error('GITHUB_TOKEN environment variable must be set for these tests');
      }
      await context.useRealOctokit();
    });

    afterAll(() => {
      context.useMockOctokit();
    });

    it('should fetch commits from PR #4 correctly', async () => {
      context.set({
        repo: {
          owner: 'techpivot',
          repo: 'terraform-module-releaser',
        },
        prNumber: 4,
      });

      const commits = await getPullRequestCommits();

      expect(commits).toHaveLength(2);
      expect(commits[0]).toHaveProperty('sha');
      expect(commits[0]).toHaveProperty('message');
      expect(commits[0]).toHaveProperty('files');

      expect(commits).toStrictEqual([
        {
          message: 'feat: add screenshots for documentation',
          sha: '7f614091a80fb05a10659f4a5b8df9fee4fdea58',
          files: [
            '.github/linters/.markdown-lint.yml',
            'README.md',
            'screenshots/module-contents-explicit-dir-only.jpg',
            'screenshots/pr-initial-module-release.jpg',
            'screenshots/pr-separate-modules-updating.jpg',
            'screenshots/release-details.jpg',
            'screenshots/wiki-changelog.jpg',
            'screenshots/wiki-module-example.jpg',
            'screenshots/wiki-sidebar.jpg',
            'screenshots/wiki-usage.jpg',
          ],
        },
        {
          message: 'docs: ensure GitHub wiki is enabled and initialized before action execution',
          sha: '8c2c39eb20e8fab10fd2fd1263d0e39cf371eebf',
          files: ['.github/workflows/ci.yml', 'README.md'],
        },
      ]);

      expect(startGroup).toHaveBeenCalledWith('Fetching pull request commits');
      expect(info).toHaveBeenCalledWith('Found 2 commits.');
      expect(debug).toHaveBeenCalledWith(JSON.stringify(commits, null, 2));
      expect(endGroup).toBeCalledTimes(1);
    });
  });

  describe('getPullRequestCommits()', () => {
    beforeAll(() => {
      context.useMockOctokit();
    });

    it('should process commits and their files correctly', async () => {
      stubOctokitReturnData('pulls.listFiles', {
        status: 200,
        data: [{ filename: 'file1.tf' }, { filename: 'file2.tf' }, { filename: 'file3.tf' }, { filename: 'file4.tf' }],
      });
      stubOctokitReturnData('pulls.listCommits', {
        status: 200,
        data: [
          { sha: 'sha1', commit: { message: 'First commit' } },
          { sha: 'sha2', commit: { message: 'Second commit' } },
        ],
      });
      stubOctokitImplementation('repos.getCommit', async ({ ref }) => {
        return {
          data: {
            files:
              ref === 'sha1'
                ? [{ filename: 'file1.tf' }, { filename: 'file2.tf' }]
                : [{ filename: 'file3.tf' }, { filename: 'file4.tf' }],
          },
          status: 200,
          url: `https://api.github.com/repos/techpivot/terraform-module-releaser/commit/${ref}`,
          headers: {},
        };
      });

      stubOctokitImplementation('repos.getCommit', ({ ref }) => ({
        data: {
          files:
            ref === 'sha1'
              ? [{ filename: 'file1.tf' }, { filename: 'file2.tf' }]
              : [{ filename: 'file3.tf' }, { filename: 'file4.tf' }],
        },
        status: 200,
        url: `https://api.github.com/repos/techpivot/terraform-module-releaser/commit/${ref}`,
        headers: {},
      }));

      const commits = await getPullRequestCommits();

      expect(vi.mocked(startGroup).mock.calls).toEqual([['Fetching pull request commits']]);
      expect(vi.mocked(info).mock.calls).toEqual([
        ['Found 4 files changed in pull request.'],
        [JSON.stringify(Array.from(['file1.tf', 'file2.tf', 'file3.tf', 'file4.tf']), null, 2)],
        ['Found 2 commits.'],
      ]);
      expect(endGroup).toBeCalledTimes(1);
      expect(commits).toStrictEqual([
        {
          message: 'First commit',
          sha: 'sha1',
          files: ['file1.tf', 'file2.tf'],
        },
        {
          message: 'Second commit',
          sha: 'sha2',
          files: ['file3.tf', 'file4.tf'],
        },
      ]);
    });

    it('should output text for singular', async () => {
      stubOctokitReturnData('pulls.listFiles', {
        status: 200,
        data: [{ filename: 'file1.tf' }],
      });
      stubOctokitReturnData('pulls.listCommits', {
        status: 200,
        data: [{ sha: 'sha1', commit: { message: 'First commit' } }],
      });

      await getPullRequestCommits();
      expect(info).toHaveBeenCalledWith('Found 1 file changed in pull request.');
      expect(info).toHaveBeenCalledWith('Found 1 commit.');
      expect(endGroup).toBeCalledTimes(1);
    });

    it('should handle commits with no files (undefined)', async () => {
      stubOctokitReturnData('pulls.listFiles', {
        status: 200,
        data: [{ filename: 'file1.tf' }, { filename: 'file2.tf' }, { filename: 'file3.tf' }, { filename: 'file4.tf' }],
      });
      stubOctokitReturnData('pulls.listCommits', {
        status: 200,
        data: [
          { sha: 'sha1', commit: { message: 'First commit' } },
          { sha: 'sha2', commit: { message: 'Second commit' } },
        ],
      });
      stubOctokitImplementation('repos.getCommit', async ({ ref }) => {
        return {
          data: ref === 'sha1' ? { files: [{ filename: 'file1.tf' }, { filename: 'file2.tf' }] } : { files: undefined },
          status: 200,
          url: `https://api.github.com/repos/techpivot/terraform-module-releaser/commit/${ref}`,
          headers: {},
        };
      });

      const commits = await getPullRequestCommits();
      expect(vi.mocked(info).mock.calls).toEqual([
        ['Found 4 files changed in pull request.'],
        [JSON.stringify(Array.from(['file1.tf', 'file2.tf', 'file3.tf', 'file4.tf']), null, 2)],
        ['Found 2 commits.'],
      ]);
      expect(endGroup).toBeCalledTimes(1);
      expect(commits).toStrictEqual([
        {
          message: 'First commit',
          sha: 'sha1',
          files: ['file1.tf', 'file2.tf'],
        },
        {
          message: 'Second commit',
          sha: 'sha2',
          files: [],
        },
      ]);
    });

    it('should handle empty commits list', async () => {
      stubOctokitReturnData('pulls.listCommits', { data: [] });
      stubOctokitReturnData('pulls.listFiles', { data: [] });

      const commits = await getPullRequestCommits();

      expect(commits).toHaveLength(0);
      expect(info).toHaveBeenCalledWith('Found 0 commits.');
      expect(endGroup).toBeCalledTimes(1);
    });

    it('should handle 403 error gracefully', async () => {
      const errorMessage = 'Resource not accessible by integration';
      const requestError = new RequestError(errorMessage, 403, {
        request: { method: 'GET', url: '', headers: {} },
        response: { status: 403, url: '', headers: {}, data: {} },
      });

      vi.mocked(context.octokit.rest.pulls.listFiles).mockRejectedValueOnce(requestError);
      await expect(getPullRequestCommits()).rejects.toThrow(
        `Unable to read and write pull requests due to insufficient permissions. Ensure the workflow permissions.pull-requests is set to "write".\n${errorMessage}`,
      );

      vi.mocked(context.octokit.rest.pulls.listCommits).mockRejectedValueOnce(requestError);
      await expect(getPullRequestCommits()).rejects.toThrow(
        `Unable to read and write pull requests due to insufficient permissions. Ensure the workflow permissions.pull-requests is set to "write".\n${errorMessage}`,
      );
    });

    it('should handle request errors', async () => {
      const errorMessage = 'Generic error testing';
      const requestError = new RequestError(errorMessage, 410, {
        request: { method: 'GET', url: '', headers: {} },
        response: { status: 410, url: '', headers: {}, data: {} },
      });
      const expectedErrorString = `Error getting changed files in PR: ${errorMessage}`;

      vi.mocked(context.octokit.rest.pulls.listFiles).mockRejectedValueOnce(requestError);
      await expect(getPullRequestCommits()).rejects.toThrow(expectedErrorString);

      vi.mocked(context.octokit.rest.pulls.listCommits).mockRejectedValueOnce(requestError);
      await expect(getPullRequestCommits()).rejects.toThrow(errorMessage);

      vi.mocked(context.octokit.rest.pulls.listFiles).mockImplementationOnce(() => {
        throw errorMessage; // Throwing a string directly
      });

      try {
        await getPullRequestCommits();
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(expectedErrorString);
        expect((error as Error).cause instanceof RequestError).toBe(false);
      }
    });
  });

  describe('addReleasePlanComment()', () => {
    const terraformModules: TerraformModule[] = [
      createMockTerraformModule({
        directory: '/module1',
        tags: ['module1/v1.0.0'],
        commits: [{ sha: 'abc123', message: 'message1', files: ['file1.tf'] }],
      }),
      createMockTerraformModule({
        directory: '/module2',
        tags: ['module2/v1.5.0'],
        commits: [{ sha: 'def456', message: 'commit message 1', files: ['file2.tf'] }],
      }),
      createMockTerraformModule({
        directory: '/new-module1',
        tags: [],
        commits: [{ sha: 'ghi789', message: 'message1', files: ['file3.tf'] }],
      }),
    ];

    const mockReleasesToDelete: GitHubRelease[] = [
      {
        id: 123,
        title: 'legacy-module/v1.0.0',
        body: 'Release notes',
        tagName: 'legacy-module/v1.0.0',
      },
    ];

    const mockTagsToDelete = ['legacy-module/v1.0.0', 'old-module/v2.0.0'];

    beforeEach(() => {
      context.useMockOctokit();
      vi.clearAllMocks();
    });

    it('should create a comment for terraform module updates', async () => {
      const newCommentId = 12345;
      stubOctokitReturnData('issues.createComment', {
        data: { id: newCommentId, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });
      stubOctokitReturnData('issues.listComments', { data: [] });

      await addReleasePlanComment(terraformModules, mockReleasesToDelete, mockTagsToDelete, {
        status: WIKI_STATUS.SUCCESS,
      });

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringMatching('| Module | Release Type | Latest Version | New Version |'),
        }),
      );
      expect(startGroup).toHaveBeenCalledWith('Adding pull request release plan comment');
      expect(info).toHaveBeenCalledWith(
        `Posted comment ${newCommentId} @ https://github.com/org/repo/pull/1#issuecomment-1`,
      );
      expect(endGroup).toHaveBeenCalled();
    });

    it('should create a comment accordingly based on legacy tags flag', async () => {
      const newCommentId = 12345;
      const terraformModuleNamesToRemove = ['aws/module1'];
      config.set({ deleteLegacyTags: true });
      stubOctokitReturnData('issues.createComment', {
        data: { id: newCommentId, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });

      await addReleasePlanComment(terraformModules, [], terraformModuleNamesToRemove, {
        status: WIKI_STATUS.SUCCESS,
      });

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(
            '**⚠️ The following tag is no longer referenced by any source Terraform modules. It will be automatically deleted.**',
          ),
        }),
      );
      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('`aws/module1`'),
        }),
      );

      config.set({ deleteLegacyTags: false });
      await addReleasePlanComment(terraformModules, [], terraformModuleNamesToRemove, {
        status: WIKI_STATUS.SUCCESS,
      });

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('⏸️ Existing tags and releases will be **preserved**'),
        }),
      );
    });

    it('should handle initial release', async () => {
      await addReleasePlanComment(terraformModules, mockReleasesToDelete, mockTagsToDelete, {
        status: WIKI_STATUS.SUCCESS,
      });
      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('🆕 Initial Release'),
        }),
      );
      expect(endGroup).toHaveBeenCalled();
    });

    it('should handle empty module updates', async () => {
      stubOctokitReturnData('issues.createComment', {
        data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });
      stubOctokitReturnData('issues.listComments', { data: [] });

      await addReleasePlanComment([], [], [], { status: WIKI_STATUS.SUCCESS });

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('No terraform modules updated in this pull request.'),
        }),
      );
    });

    it('should include modules to remove when flag enabled', async () => {
      const modulesToRemove = ['legacy-module1', 'legacy-module2'];

      stubOctokitReturnData('issues.createComment', {
        data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });
      stubOctokitReturnData('issues.listComments', { data: [] });
      config.set({ deleteLegacyTags: true });

      await addReleasePlanComment([], [], modulesToRemove, { status: WIKI_STATUS.SUCCESS });

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('`legacy-module1`, `legacy-module2`'),
        }),
      );
    });

    it('should not include modules to remove when flag disabled ', async () => {
      const modulesToRemove = ['legacy-module1', 'legacy-module2'];

      stubOctokitReturnData('issues.createComment', {
        data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });
      stubOctokitReturnData('issues.listComments', { data: [] });
      config.set({ deleteLegacyTags: false });

      await addReleasePlanComment([], [], modulesToRemove, { status: WIKI_STATUS.SUCCESS });

      const createCommentCalls = vi.mocked(context.octokit.rest.issues.createComment).mock.calls;
      expect(createCommentCalls.length).toBeGreaterThanOrEqual(1);

      // Get the comment body text from the first call
      const commentBody = createCommentCalls[0]?.[0]?.body as string;

      // Ensure both modules are not included in the body
      expect(commentBody).not.toContain('`legacy-module1`');
      expect(commentBody).not.toContain('`legacy-module2`');
      expect(commentBody).toContain('⏸️ Existing tags and releases will be **preserved**');
    });

    it('should handle cleanup when delete-legacy-tags is enabled but no modules to remove', async () => {
      const newCommentId = 12345;
      config.set({ deleteLegacyTags: true });
      stubOctokitReturnData('issues.createComment', {
        data: { id: newCommentId, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });
      stubOctokitReturnData('issues.listComments', { data: [] });

      await addReleasePlanComment(terraformModules, [], [], { status: WIKI_STATUS.SUCCESS });

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(
            '✅ All tags and releases are synchronized with the codebase. No cleanup required.',
          ),
        }),
      );
    });

    it('should handle multiple modules to remove with plural warning message', async () => {
      const newCommentId = 12345;
      const terraformModuleNamesToRemove = ['aws/module1', 'aws/module2', 'gcp/module3'];
      config.set({ deleteLegacyTags: true });
      stubOctokitReturnData('issues.createComment', {
        data: { id: newCommentId, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });
      stubOctokitReturnData('issues.listComments', { data: [] });

      await addReleasePlanComment(terraformModules, [], terraformModuleNamesToRemove, {
        status: WIKI_STATUS.SUCCESS,
      });

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(
            '**⚠️ The following tags are no longer referenced by any source Terraform modules. They will be automatically deleted.**',
          ),
        }),
      );
      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('`aws/module1`, `aws/module2`, `gcp/module3`'),
        }),
      );
    });

    it('should handle wiki failure status with error message', async () => {
      const newCommentId = 12345;
      const errorSummary = 'Repository does not have wiki enabled';
      stubOctokitReturnData('issues.createComment', {
        data: { id: newCommentId, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });
      stubOctokitReturnData('issues.listComments', { data: [] });

      await addReleasePlanComment([], [], [], {
        status: WIKI_STATUS.FAILURE,
        errorSummary,
      });

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('**⚠️ Failed to checkout wiki:**'),
        }),
      );
      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('```'),
        }),
      );
      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('Please consult the [README.md]'),
        }),
      );
    });

    it('should exclude branding when disabled', async () => {
      const newCommentId = 12345;
      config.set({ disableBranding: true });
      stubOctokitReturnData('issues.createComment', {
        data: { id: newCommentId, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });
      stubOctokitReturnData('issues.listComments', { data: [] });

      await addReleasePlanComment(terraformModules, [], [], { status: WIKI_STATUS.SUCCESS });

      const createCommentCalls = vi.mocked(context.octokit.rest.issues.createComment).mock.calls;
      expect(createCommentCalls.length).toBeGreaterThanOrEqual(1);

      // Get the comment body text from the first call
      const commentBody = createCommentCalls[0]?.[0]?.body as string;

      // Ensure branding is not included
      expect(commentBody).not.toContain(BRANDING_COMMENT);
    });

    it('should handle different wiki statuses', async () => {
      const cases = [
        {
          status: WIKI_STATUS.SUCCESS,
          expectedContent: '✅ Enabled',
        },
        {
          status: WIKI_STATUS.FAILURE,
          errorSummary: 'Failed to clone',
          expectedContent: '**⚠️ Failed to checkout wiki:**',
        },
        {
          status: WIKI_STATUS.DISABLED,
          expectedContent: '🚫 Wiki generation **disabled** via `disable-wiki` flag.',
        },
      ];

      for (const testCase of cases) {
        stubOctokitReturnData('issues.createComment', {
          data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
        });
        stubOctokitReturnData('issues.listComments', { data: [] });

        await addReleasePlanComment([], [], [], { status: testCase.status, errorSummary: testCase.errorSummary });

        expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.stringContaining(testCase.expectedContent),
          }),
        );
      }
    });

    it('should delete previous summary comments', async () => {
      const existingComments = [
        { id: 1, body: `${PR_SUMMARY_MARKER}\nOld comment 1`, created_at: '2024-01-01' },
        { id: 2, body: 'Regular comment', created_at: '2024-01-02' },
        { id: 3, body: `${PR_SUMMARY_MARKER}\nOld comment 2`, created_at: '2024-01-03' },
      ];

      stubOctokitReturnData('issues.createComment', {
        data: { id: 4, html_url: 'https://github.com/org/repo/pull/1#issuecomment-4' },
      });
      stubOctokitReturnData('issues.listComments', { data: existingComments });

      await addReleasePlanComment([], [], [], { status: WIKI_STATUS.SUCCESS });

      expect(context.octokit.rest.issues.deleteComment).toHaveBeenCalledTimes(2);
      expect(context.octokit.rest.issues.deleteComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 1 }),
      );
      expect(context.octokit.rest.issues.deleteComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 3 }),
      );
    });

    it('should handle releases to delete when delete-legacy-tags is enabled', async () => {
      const mockReleasesToDeleteSingle: GitHubRelease[] = [
        {
          id: 456,
          title: 'legacy-release/v2.0.0',
          body: 'Release notes for deletion',
          tagName: 'legacy-release/v2.0.0',
        },
      ];

      stubOctokitReturnData('issues.createComment', {
        data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });
      stubOctokitReturnData('issues.listComments', { data: [] });
      config.set({ deleteLegacyTags: true });

      await addReleasePlanComment([], mockReleasesToDeleteSingle, [], { status: WIKI_STATUS.SUCCESS });

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(
            '**⚠️ The following release is no longer referenced by any source Terraform modules. It will be automatically deleted.**',
          ),
        }),
      );
      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('`legacy-release/v2.0.0`'),
        }),
      );
    });

    it('should handle multiple releases to delete with plural message', async () => {
      const mockReleasesToDeleteMultiple: GitHubRelease[] = [
        {
          id: 456,
          title: 'legacy-release1/v1.0.0',
          body: 'Release notes 1',
          tagName: 'legacy-release1/v1.0.0',
        },
        {
          id: 789,
          title: 'legacy-release2/v2.0.0',
          body: 'Release notes 2',
          tagName: 'legacy-release2/v2.0.0',
        },
      ];

      stubOctokitReturnData('issues.createComment', {
        data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });
      stubOctokitReturnData('issues.listComments', { data: [] });
      config.set({ deleteLegacyTags: true });

      await addReleasePlanComment([], mockReleasesToDeleteMultiple, [], { status: WIKI_STATUS.SUCCESS });

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(
            '**⚠️ The following releases are no longer referenced by any source Terraform modules. They will be automatically deleted.**',
          ),
        }),
      );
      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('`legacy-release1/v1.0.0`, `legacy-release2/v2.0.0`'),
        }),
      );
    });

    it('should handle both releases and tags to delete with proper spacing', async () => {
      const mockReleasesToDelete: GitHubRelease[] = [
        {
          id: 456,
          title: 'legacy-release/v1.0.0',
          body: 'Release notes',
          tagName: 'legacy-release/v1.0.0',
        },
      ];
      const mockTagsToDelete = ['legacy-tag/v2.0.0'];

      stubOctokitReturnData('issues.createComment', {
        data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });
      stubOctokitReturnData('issues.listComments', { data: [] });
      config.set({ deleteLegacyTags: true });

      await addReleasePlanComment([], mockReleasesToDelete, mockTagsToDelete, { status: WIKI_STATUS.SUCCESS });

      const createCommentCalls = vi.mocked(context.octokit.rest.issues.createComment).mock.calls;
      expect(createCommentCalls.length).toBeGreaterThanOrEqual(1);

      // Get the comment body text from the first call
      const commentBody = createCommentCalls[0]?.[0]?.body as string;

      // Ensure both releases and tags sections are included
      expect(commentBody).toContain(
        '**⚠️ The following release is no longer referenced by any source Terraform modules. It will be automatically deleted.**',
      );
      expect(commentBody).toContain('`legacy-release/v1.0.0`');
      expect(commentBody).toContain(
        '**⚠️ The following tag is no longer referenced by any source Terraform modules. It will be automatically deleted.**',
      );
      expect(commentBody).toContain('`legacy-tag/v2.0.0`');

      // Verify there's proper spacing (empty line) between releases and tags sections
      const releaseIndex = commentBody.indexOf('- `legacy-release/v1.0.0`');
      const tagIndex = commentBody.indexOf('- `legacy-tag/v2.0.0`');
      const betweenContent = commentBody.substring(releaseIndex, tagIndex);
      expect(betweenContent).toContain('\n\n'); // Should contain double newline for spacing
    });

    it('should handle request errors gracefully', async () => {
      const errorMessage = 'Server error';
      const expectedErrorString = `Failed to create a comment on the pull request: ${errorMessage} - Ensure that the GitHub Actions workflow has the correct permissions to write comments. To grant the required permissions, update your workflow YAML file with the following block under "permissions":\n\npermissions:\n  pull-requests: write`;

      vi.mocked(context.octokit.rest.issues.createComment).mockRejectedValueOnce(
        new RequestError(errorMessage, 403, {
          request: { method: 'POST', url: '', headers: {} },
          response: { status: 403, url: '', headers: {}, data: {} },
        }),
      );

      await expect(addReleasePlanComment([], [], [], { status: WIKI_STATUS.SUCCESS })).rejects.toThrow(
        expectedErrorString,
      );
    });

    it('should handle non-RequestError errors gracefully', async () => {
      const errorMessage = 'Generic error testing';
      const expectedErrorString = `Failed to create a comment on the pull request: ${errorMessage}`;

      vi.mocked(context.octokit.rest.issues.createComment).mockImplementationOnce(() => {
        throw errorMessage; // Throwing a string directly
      });

      try {
        await addReleasePlanComment([], [], [], { status: WIKI_STATUS.SUCCESS });
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(expectedErrorString);
        expect((error as Error).cause instanceof RequestError).toBe(false);
      }

      vi.mocked(context.octokit.rest.issues.createComment).mockImplementationOnce(() => {
        throw new Error(errorMessage); // Throwing an Error object
      });

      try {
        await addReleasePlanComment([], [], [], { status: WIKI_STATUS.SUCCESS });
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(expectedErrorString);
        expect((error as Error).cause instanceof Error).toBe(true);
      }
    });
  });

  describe('addPostReleaseComment()', () => {
    const releasedModules: TerraformModule[] = [
      createMockTerraformModule({
        directory: '/module1',
        releases: [
          {
            id: 1,
            title: 'v1.0.0',
            body: 'Release notes for v1.0.0',
            tagName: 'module1/v1.0.0',
          },
        ],
      }),
      createMockTerraformModule({
        directory: '/module2',
        releases: [
          {
            id: 2,
            title: 'v2.0.0',
            body: 'Release notes for v2.0.0',
            tagName: 'module2/v2.0.0',
          },
        ],
      }),
    ];

    beforeEach(() => {
      context.useMockOctokit();
      vi.clearAllMocks();
    });

    it('should skip comment creation when no modules are updated', async () => {
      await addPostReleaseComment([]);

      expect(context.octokit.rest.issues.createComment).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith('No released modules. Skipping post release PR comment.');
    });

    it('should create comment with release details', async () => {
      stubOctokitReturnData('issues.createComment', {
        data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });

      await addPostReleaseComment(releasedModules);

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(PR_RELEASE_MARKER),
        }),
      );
      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('v1.0.0'),
        }),
      );
      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('v2.0.0'),
        }),
      );
    });

    it('should include wiki links when wiki is enabled', async () => {
      config.set({ disableWiki: false });
      stubOctokitReturnData('issues.createComment', {
        data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });

      await addPostReleaseComment(releasedModules);

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('Wiki/Usage'),
        }),
      );
    });

    it('should exclude wiki links when wiki is disabled', async () => {
      config.set({ disableWiki: true });
      stubOctokitReturnData('issues.createComment', {
        data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });

      await addPostReleaseComment(releasedModules);

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.not.stringContaining('Wiki/Usage'),
        }),
      );
    });

    it('should exclude branding when disabled', async () => {
      config.set({ disableBranding: true });
      stubOctokitReturnData('issues.createComment', {
        data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });

      await addPostReleaseComment(releasedModules);

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.not.stringContaining(BRANDING_COMMENT),
        }),
      );
    });

    it('should include branding when not disabled', async () => {
      config.set({ disableBranding: false });
      stubOctokitReturnData('issues.createComment', {
        data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });

      await addPostReleaseComment(releasedModules);

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(BRANDING_COMMENT),
        }),
      );
    });

    it('should handle 403 error gracefully', async () => {
      const errorMessage = 'Resource not accessible by integration';
      vi.mocked(context.octokit.rest.issues.createComment).mockRejectedValueOnce(
        new RequestError(errorMessage, 403, {
          request: { method: 'GET', url: '', headers: {} },
          response: { status: 403, url: '', headers: {}, data: {} },
        }),
      );

      await expect(addPostReleaseComment(releasedModules)).rejects.toThrow(
        'Failed to create a comment on the pull request',
      );
    });

    it('should handle request errors gracefully', async () => {
      const errorMessage = 'Server error';
      const expectedErrorString = `Failed to create a comment on the pull request: ${errorMessage}`;

      vi.mocked(context.octokit.rest.issues.createComment).mockImplementationOnce(() => {
        throw errorMessage; // Throwing a string directly
      });

      try {
        await addPostReleaseComment(releasedModules);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(expectedErrorString);
        expect((error as Error).cause instanceof RequestError).toBe(false);
      }

      vi.mocked(context.octokit.rest.issues.createComment).mockImplementationOnce(() => {
        throw new Error(errorMessage); // Throwing a string directly
      });

      try {
        await addPostReleaseComment(releasedModules);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(expectedErrorString);
        expect((error as Error).cause instanceof RequestError).toBe(false);
      }
    });
  });
});
