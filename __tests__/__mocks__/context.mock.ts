import { merge } from 'ts-deepmerge';
import { vi } from 'vitest';
import type { Context } from '../../src/context';

// Only mock the methods we need
const octokitMock = {
  rest: {
    git: {
      deleteRef: vi.fn(),
    },
    issues: {
      createComment: vi.fn(),
      deleteComment: vi.fn(),
      listComments: vi.fn(),
      listForRepo: vi.fn().mockResolvedValue({
        data: [
          {
            number: 1,
            title: 'issue 1',
            body: 'issue 1 body',
          },
          {
            number: 2,
            title: 'issue 2',
            body: 'issue 2 body',
          },
        ],
      }),
    },
    pulls: {
      listCommits: vi.fn().mockResolvedValue({
        data: [
          { sha: 'sha1', committer: { name: '<NAME>' } },
          { sha: 'sha2', committer: { name: '<NAME>' } },
        ],
      }),
      listFiles: vi.fn().mockResolvedValue({
        data: [{ filename: 'file1.txt' }, { filename: 'file2.txt' }],
      }),
    },
    repos: {
      getCommit: vi.fn().mockResolvedValue({
        data: {
          sha: '1234567890',
        },
      }),
      listTags: vi.fn(),
      listReleases: vi.fn(),
    },
  },
  paginate: vi.fn(),
};

const defaultContext: Context = {
  repo: {
    owner: 'techpivot',
    repo: 'terraform-module-releaser',
  },
  repoUrl: 'https://github.com/techpivot/terraform-module-releaser',
  octokit: octokitMock as unknown as Context['octokit'],
  prNumber: 1,
  prTitle: 'Test Pull Request',
  prBody: 'This is a test pull request body.',
  issueNumber: 1,
  workspaceDir: '/path/to/workspace',
  isPrMergeEvent: false,
};

const defaultPullRequestPayload = {
  action: 'opened',
  pull_request: {
    number: 123,
    title: 'Test PR',
    body: 'Test PR body',
    merged: false,
  },
  repository: {
    full_name: 'techpivot/terraform-module-releaser',
  },
};

// Create a mock context factory function
//export function createContextMock(overrides: Partial<Context> = {}): Context {
//  return merge(defaultContext, overrides);
//}

// Create a mock pull request factory function
export function createPullRequestMock(overrides = {}) {
  return merge(defaultPullRequestPayload, overrides);
}

// Create the mock handler
export const contextMock = vi.fn(() => defaultContext);
