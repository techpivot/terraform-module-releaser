import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearContextForTesting, context, getContext } from '../src/context';
import { createPullRequestMock } from './__mocks__/context.mock';
import { mockCore } from './setup';

// Mock functions
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

describe('context', () => {
  // Mock implementations for fs just in this current test
  const mockExistsSync = vi.mocked(existsSync);
  const mockReadFileSync = vi.mocked(readFileSync);

  const requiredEnvVars = [
    'GITHUB_EVENT_NAME',
    'GITHUB_REPOSITORY',
    'GITHUB_EVENT_PATH',
    'GITHUB_SERVER_URL',
    'GITHUB_WORKSPACE',
  ];

  beforeAll(() => {
    // We globally mock context to facilitate majority of testing; however,
    // this test case needs to explicitly test core functionality so we reset the
    // mock implementation for this test.
    vi.unmock('../src/context');
  });

  beforeEach(() => {
    clearContextForTesting();

    mockExistsSync.mockImplementation(() => true);
    mockReadFileSync.mockImplementation(() => {
      return JSON.stringify(createPullRequestMock());
    });
  });

  describe('environment variable validation', () => {
    for (const envVar of requiredEnvVars) {
      it(`should throw an error if ${envVar} is not set`, () => {
        vi.stubEnv(envVar, undefined);
        expect(() => getContext()).toThrow(
          new Error(
            `The ${envVar} environment variable is missing or invalid. This variable should be automatically set by GitHub for each workflow run. If this variable is missing or not correctly set, it indicates a serious issue with the GitHub Actions environment, potentially affecting the execution of subsequent steps in the workflow. Please review the workflow setup or consult the documentation for proper configuration.`,
          ),
        );
      });
    }
  });

  describe('event validation', () => {
    it('should throw error when event is not pull_request', () => {
      vi.stubEnv('GITHUB_EVENT_NAME', 'push');
      expect(() => getContext()).toThrow('This workflow is not running in the context of a pull request');
    });

    it('should throw error when event path does not exist', () => {
      vi.stubEnv('GITHUB_EVENT_PATH', '/path/to/nonexistent/event.json');
      mockExistsSync.mockReturnValue(false);
      expect(() => getContext()).toThrow('Specified GITHUB_EVENT_PATH /path/to/nonexistent/event.json does not exist');
    });

    it('should throw error when payload is invalid', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{"invalid": "payload"}');
      expect(() => getContext()).toThrow('Event payload did not match expected pull_request event payload');
    });
  });

  describe('initialization', () => {
    it('should maintain singleton instance across multiple imports', () => {
      expect(mockCore.startGroup).toHaveBeenCalledTimes(0);
      const firstInstance = getContext();
      expect(mockCore.startGroup).toHaveBeenCalledTimes(1);
      expect(mockCore.startGroup).toBeCalledWith('Initializing Context');
      const secondInstance = getContext();
      expect(mockCore.startGroup).toHaveBeenCalledTimes(1);
      expect(firstInstance).toBe(secondInstance);
    });

    it('should initialize with valid properties for non-merge event', () => {
      mockReadFileSync.mockImplementation(() => {
        return JSON.stringify(
          createPullRequestMock({
            action: 'opened',
            pull_request: {
              number: 1323,
              title: 'Test PR',
              body: 'Test PR body',
              merged: false,
            },
            repository: {
              full_name: 'techpivot/terraform-module-releaser',
            },
          }),
        );
      });
      expect(getContext()).toMatchObject({
        repo: {
          owner: 'techpivot',
          repo: 'terraform-module-releaser',
        },
        repoUrl: 'https://github.com/techpivot/terraform-module-releaser',
        prNumber: 1323,
        prTitle: 'Test PR',
        prBody: 'Test PR body',
        issueNumber: 1323,
        workspaceDir: '/workspace',
        isPrMergeEvent: false,
      });
    });

    it('should initialize as merge event', () => {
      mockReadFileSync.mockImplementation(() => {
        return JSON.stringify(
          createPullRequestMock({
            action: 'closed',
            pull_request: {
              merged: true,
            },
          }),
        );
      });
      expect(getContext().isPrMergeEvent).toBe(true);
    });

    it('should initialize with trimmed pull request title', () => {
      const prTitle = 'Test PR with space ';
      mockReadFileSync.mockImplementation(() => {
        return JSON.stringify(
          createPullRequestMock({
            action: 'test',
            pull_request: {
              title: prTitle,
            },
          }),
        );
      });
      expect(getContext().prTitle).toEqual(prTitle.trim());
    });

    it('should initialize with null pull request body', () => {
      mockReadFileSync.mockImplementation(() => {
        return JSON.stringify(
          createPullRequestMock({
            action: 'test',
            pull_request: {
              body: null,
            },
          }),
        );
      });
      expect(getContext().prBody).toEqual('');
    });
  });

  describe('context proxy', () => {
    it('should proxy context properties', () => {
      const proxyRepo = context.repo;
      const getterRepo = getContext().repo;
      expect(proxyRepo).toEqual(getterRepo);
      expect(mockCore.startGroup).toHaveBeenCalledWith('Initializing Context');
      expect(mockCore.info).toHaveBeenCalledTimes(9);

      // Reset mock call counts
      mockCore.startGroup.mockClear();
      mockCore.info.mockClear();

      // Second access should not trigger initialization
      const prNumber = context.prNumber;
      expect(mockCore.startGroup).not.toHaveBeenCalled();
      expect(mockCore.info).not.toHaveBeenCalled();
    });
  });
});
