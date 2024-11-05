import type { Context, Repo } from '@/context';
import { createDefaultOctokitMock, createRealOctokit } from '@/tests/helpers/octokit';
import { Octokit } from '@octokit/core';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';
import { merge } from 'ts-deepmerge';

// Create the extended Octokit type with plugins, matching the real context
const OctokitExtended = Octokit.plugin(restEndpointMethods, paginateRest);

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
  useMockOctokit: () => InstanceType<typeof OctokitExtended>;
}

/**
 * Default context values
 */
const defaultContext: Context = {
  repo: defaultRepo,
  repoUrl: 'https://github.com/techpivot/terraform-module-releaser',
  octokit: createDefaultOctokitMock() as unknown as InstanceType<typeof OctokitExtended>,
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
  set(target: ContextWithMethods, key: string, value: unknown): boolean {
    if (!validContextKeys.includes(key as ValidContextKey)) {
      throw new Error(`Invalid context key: ${key}`);
    }

    const typedKey = key as keyof Context;
    const expectedValue = defaultContext[typedKey];

    if (typeof expectedValue === typeof value || (typedKey === 'octokit' && typeof value === 'object')) {
      // @ts-ignore - we know the key is valid and value type is correct
      currentContext[typedKey] = value;
      return true;
    }

    throw new TypeError(`Invalid value type for context key: ${key}`);
  },

  get(target: ContextWithMethods, prop: string | symbol): unknown {
    if (typeof prop === 'string') {
      if (prop === 'set') {
        return (overrides: Partial<Context> = {}) => {
          currentContext = merge(currentContext, overrides) as Context;
        };
      }
      if (prop === 'reset') {
        return () => {
          const mockOctokit = createDefaultOctokitMock() as unknown as InstanceType<typeof OctokitExtended>;
          currentContext = {
            ...defaultContext,
            octokit: mockOctokit,
          };
        };
      }
      if (prop === 'useRealOctokit') {
        return async () => {
          currentContext.octokit = (await createRealOctokit()) as unknown as InstanceType<typeof OctokitExtended>;
        };
      }
      if (prop === 'useMockOctokit') {
        return () => {
          const mockOctokit = createDefaultOctokitMock() as unknown as InstanceType<typeof OctokitExtended>;
          currentContext.octokit = mockOctokit;
          return mockOctokit;
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
