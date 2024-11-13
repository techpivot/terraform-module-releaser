import { config } from '@/mocks/config';
import { context } from '@/mocks/context';
import { addPostReleaseComment, addReleasePlanComment, getPullRequestCommits, hasReleaseComment } from '@/pull-request';
import { stubOctokitImplementation, stubOctokitReturnData } from '@/tests/helpers/octokit';
import type { GitHubRelease, TerraformChangedModule } from '@/types';
import { BRANDING_COMMENT, GITHUB_ACTIONS_BOT_USER_ID, PR_RELEASE_MARKER, PR_SUMMARY_MARKER } from '@/utils/constants';
import { WikiStatus } from '@/wiki';
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

    it('should return false when release marker is found in comments from non github-actions user', async () => {
      stubOctokitReturnData('issues.listComments', {
        data: [
          { user: { id: 123 }, body: 'Some comment' },
          { user: { id: 123 }, body: PR_RELEASE_MARKER },
          { user: { id: 123 }, body: 'Another comment' },
        ],
      });
      expect(await hasReleaseComment()).toBe(false);
    });

    it('should return true when release marker is found in comments from github-actions user', async () => {
      stubOctokitReturnData('issues.listComments', {
        data: [
          { user: { id: 123 }, body: 'Some comment' },
          { user: { id: GITHUB_ACTIONS_BOT_USER_ID }, body: PR_RELEASE_MARKER },
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
    const terraformChangedModules: TerraformChangedModule[] = [
      {
        moduleName: 'module1',
        directory: '/module1',
        tags: [],
        releases: [],
        latestTag: 'module1/v1.0.0',
        latestTagVersion: 'v1.0.0',
        isChanged: true,
        commitMessages: ['message1'],
        releaseType: 'minor',
        nextTag: 'module1/v1.1.0',
        nextTagVersion: 'v1.1.0',
      },
      {
        moduleName: 'module2',
        directory: '/module2',
        tags: [],
        releases: [],
        latestTag: 'module2/v1.5.0',
        latestTagVersion: 'v1.5.0',
        isChanged: true,
        commitMessages: ['commit message 1'],
        releaseType: 'major',
        nextTag: 'module2/v2.0.0',
        nextTagVersion: 'v2.0.0',
      },
      {
        moduleName: 'new-module',
        directory: '/new-module1',
        tags: [],
        releases: [],
        latestTag: null,
        latestTagVersion: null,
        isChanged: true,
        commitMessages: ['message1'],
        releaseType: 'patch',
        nextTag: 'new-module/v1.0.0',
        nextTagVersion: 'v1.0.0',
      },
    ];

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

      await addReleasePlanComment(terraformChangedModules, [], { status: WikiStatus.SUCCESS });

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

      await addReleasePlanComment(terraformChangedModules, terraformModuleNamesToRemove, {
        status: WikiStatus.SUCCESS,
      });

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(
            '**Note**: The following Terraform modules no longer exist in source; however, corresponding tags/releases exist.',
          ),
        }),
      );
      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(
            'Automation tag/release deletion is **enabled** and corresponding tags/releases will be automatically deleted.<br>',
          ),
        }),
      );

      config.set({ deleteLegacyTags: false });
      await addReleasePlanComment(terraformChangedModules, terraformModuleNamesToRemove, {
        status: WikiStatus.SUCCESS,
      });

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(
            '**Note**: The following Terraform modules no longer exist in source; however, corresponding tags/releases exist.',
          ),
        }),
      );
      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(
            'Automation tag/release deletion is **disabled** — **no** subsequent action will take place.<br>',
          ),
        }),
      );
    });

    it('should handle initial release', async () => {
      await addReleasePlanComment(terraformChangedModules, [], { status: WikiStatus.SUCCESS });
      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('| `new-module` | initial |  | **v1.0.0** |'),
        }),
      );
      expect(endGroup).toHaveBeenCalled();
    });

    it('should handle empty module updates', async () => {
      stubOctokitReturnData('issues.createComment', {
        data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });
      stubOctokitReturnData('issues.listComments', { data: [] });

      await addReleasePlanComment([], [], { status: WikiStatus.SUCCESS });

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('No terraform modules updated in this pull request.'),
        }),
      );
    });

    it('should include modules to remove when specified', async () => {
      const modulesToRemove = ['legacy-module1', 'legacy-module2'];

      stubOctokitReturnData('issues.createComment', {
        data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });
      stubOctokitReturnData('issues.listComments', { data: [] });

      await addReleasePlanComment([], modulesToRemove, { status: WikiStatus.SUCCESS });

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('`legacy-module1`, `legacy-module2`'),
        }),
      );
    });

    it('should handle different wiki statuses', async () => {
      const cases = [
        {
          status: WikiStatus.SUCCESS,
          expectedContent: '✅ Wiki Check',
        },
        {
          status: WikiStatus.FAILURE,
          errorMessage: 'Failed to clone',
          expectedContent: '⚠️ Wiki Check: Failed to checkout wiki.',
        },
        {
          status: WikiStatus.DISABLED,
          expectedContent: '🚫 Wiki Check: Generation is disabled',
        },
      ];

      for (const testCase of cases) {
        stubOctokitReturnData('issues.createComment', {
          data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
        });
        stubOctokitReturnData('issues.listComments', { data: [] });

        await addReleasePlanComment([], [], { status: testCase.status, errorMessage: testCase.errorMessage });

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

      await addReleasePlanComment([], [], { status: WikiStatus.SUCCESS });

      expect(context.octokit.rest.issues.deleteComment).toHaveBeenCalledTimes(2);
      expect(context.octokit.rest.issues.deleteComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 1 }),
      );
      expect(context.octokit.rest.issues.deleteComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 3 }),
      );
    });

    it('should handle request errors gracefully', async () => {
      const errorMessage = 'Resource not accessible by integration';
      const expectedErrorString = `Failed to create a comment on the pull request: ${errorMessage}`;

      vi.mocked(context.octokit.rest.issues.createComment).mockRejectedValueOnce(
        new RequestError(errorMessage, 403, {
          request: { method: 'GET', url: '', headers: {} },
          response: { status: 403, url: '', headers: {}, data: {} },
        }),
      );

      await expect(addReleasePlanComment([], [], { status: WikiStatus.SUCCESS })).rejects.toThrow(expectedErrorString);

      vi.mocked(context.octokit.rest.issues.createComment).mockRejectedValueOnce(
        new RequestError(errorMessage, 403, {
          request: { method: 'GET', url: '', headers: {} },
          response: { status: 403, url: '', headers: {}, data: {} },
        }),
      );

      try {
        await addReleasePlanComment([], [], { status: WikiStatus.SUCCESS });
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(
          `${expectedErrorString} - Ensure that the GitHub Actions workflow has the correct permissions to write comments. To grant the required permissions, update your workflow YAML file with the following block under "permissions":\n\npermissions:\n  pull-requests: write`,
        );
        expect((error as Error).cause instanceof RequestError).toBe(true);
      }

      vi.mocked(context.octokit.rest.issues.createComment).mockImplementationOnce(() => {
        throw errorMessage; // Throwing a string directly
      });

      try {
        await addReleasePlanComment([], [], { status: WikiStatus.SUCCESS });
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(expectedErrorString);
        expect((error as Error).cause instanceof RequestError).toBe(false);
      }

      vi.mocked(context.octokit.rest.issues.createComment).mockImplementationOnce(() => {
        throw new Error(errorMessage); // Throwing a string directly
      });

      try {
        await addReleasePlanComment([], [], { status: WikiStatus.SUCCESS });
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(expectedErrorString);
        expect((error as Error).cause instanceof RequestError).toBe(false);
      }
    });
  });

  describe('addPostReleaseComment()', () => {
    const updatedModules: { moduleName: string; release: GitHubRelease }[] = [
      {
        moduleName: 'module1',
        release: {
          id: 1,
          title: 'v1.0.0',
          body: 'Release notes for v1.0.0',
          tagName: 'module1/v1.0.0',
        },
      },
      {
        moduleName: 'module2',
        release: {
          id: 2,
          title: 'v2.0.0',
          body: 'Release notes for v2.0.0',
          tagName: 'module1/v2.0.0',
        },
      },
    ];

    beforeEach(() => {
      context.useMockOctokit();
      vi.clearAllMocks();
    });

    it('should skip comment creation when no modules are updated', async () => {
      await addPostReleaseComment([]);

      expect(context.octokit.rest.issues.createComment).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith('No updated modules. Skipping post release PR comment.');
    });

    it('should create comment with release details', async () => {
      stubOctokitReturnData('issues.createComment', {
        data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });

      await addPostReleaseComment(updatedModules);

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

      await addPostReleaseComment(updatedModules);

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

      await addPostReleaseComment(updatedModules);

      expect(context.octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.not.stringContaining('Wiki/Usage'),
        }),
      );
    });

    it('should include branding when not disabled', async () => {
      config.set({ disableBranding: false });
      stubOctokitReturnData('issues.createComment', {
        data: { id: 1, html_url: 'https://github.com/org/repo/pull/1#issuecomment-1' },
      });

      await addPostReleaseComment(updatedModules);

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

      await expect(addPostReleaseComment(updatedModules)).rejects.toThrow(
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
        await addPostReleaseComment(updatedModules);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(expectedErrorString);
        expect((error as Error).cause instanceof RequestError).toBe(false);
      }

      vi.mocked(context.octokit.rest.issues.createComment).mockImplementationOnce(() => {
        throw new Error(errorMessage); // Throwing a string directly
      });

      try {
        await addPostReleaseComment(updatedModules);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe(expectedErrorString);
        expect((error as Error).cause instanceof RequestError).toBe(false);
      }
    });
  });
});
