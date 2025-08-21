import { createDefaultOctokitMock, createRealOctokit } from '@/tests/helpers/octokit';
import type { Context, OctokitRestApi, Repo } from '@/types';
import { merge } from 'ts-deepmerge';

/**
 * Default repository configuration
 */
const defaultRepo: Repo = {
  owner: 'techpivot',
  repo: 'terraform-module-releaser',
};

/**
 * Context interface with added utility methods
 */
export interface ContextWithMethods extends Context {
  set: (overrides?: Partial<Context>) => void;
  reset: () => void;
  useRealOctokit: () => Promise<void>;
  useMockOctokit: () => OctokitRestApi;
}

/**
 * Default context values
 */
const defaultContext: Context = {
  repo: defaultRepo,
  repoUrl: 'https://github.com/techpivot/terraform-module-releaser',
  octokit: createDefaultOctokitMock(),
  prNumber: 1,
  prTitle: 'Test Pull Request',
  prBody: 'This is a test pull request body.',
  issueNumber: 1,
  workspaceDir: process.cwd(),
  isPrMergeEvent: false,
};

/**
 * Valid context keys
 */
const validContextKeys = [
  'repo',
  'repoUrl',
  'octokit',
  'prNumber',
  'prTitle',
  'prBody',
  'issueNumber',
  'workspaceDir',
  'isPrMergeEvent',
] as const;

type ValidContextKey = (typeof validContextKeys)[number];

// Store the current context configuration
let currentContext: Context = { ...defaultContext };

/**
 * Context proxy handler
 */
const contextProxyHandler: ProxyHandler<ContextWithMethods> = {
  set(_target: ContextWithMethods, key: string, value: unknown): boolean {
    if (!validContextKeys.includes(key as ValidContextKey)) {
      throw new Error(`Invalid context key: ${key}`);
    }

    const typedKey = key as keyof Context;
    const expectedValue = defaultContext[typedKey];

    if (typeof expectedValue === typeof value || (typedKey === 'octokit' && typeof value === 'object')) {
      // @ts-expect-error - we know the key is valid and value type is correct
      currentContext[typedKey] = value;
      return true;
    }

    throw new TypeError(`Invalid value type for context key: ${key}`);
  },

  get(_target: ContextWithMethods, prop: string | symbol): unknown {
    if (typeof prop === 'string') {
      if (prop === 'set') {
        return (overrides: Partial<Context> = {}) => {
          // Note: No need for deep merge
          currentContext = { ...currentContext, ...overrides } as Context;
        };
      }
      if (prop === 'reset') {
        return () => {
          currentContext = {
            ...defaultContext,
            octokit: createDefaultOctokitMock(),
          };
        };
      }
      if (prop === 'useRealOctokit') {
        return async () => {
          currentContext.octokit = await createRealOctokit();
          return currentContext.octokit;
        };
      }
      if (prop === 'useMockOctokit') {
        return () => {
          currentContext.octokit = createDefaultOctokitMock();
          return currentContext.octokit;
        };
      }
      return currentContext[prop as keyof Context];
    }
    return undefined;
  },
};

/**
 * Create and export the context mock directly with the proxy
 */
export const context = new Proxy({} as ContextWithMethods, contextProxyHandler);

/**
 * Returns the current context configuration
 */
export function getContext(): Context {
  return currentContext;
}

/**
 * Default pull request payload for testing
 */
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

/**
 * Create a mock pull request factory function
 */
export function createPullRequestMock(overrides = {}) {
  return merge(defaultPullRequestPayload, overrides);
}
