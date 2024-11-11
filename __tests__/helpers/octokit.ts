import { trimSlashes } from '@/utils/string';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';
import type { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods';
import type { EndpointOptions, OctokitResponse } from '@octokit/types';
import { vi } from 'vitest';

// Helper type to make response data partial
type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

// Names of the supported endpoints across different namespaces (e.g., git, issues, pulls, repos).
type EndpointNames = {
  git: 'createTag' | 'deleteRef';
  issues: 'createComment' | 'deleteComment' | 'listComments';
  pulls: 'listCommits' | 'listFiles';
  repos: 'getCommit' | 'listTags' | 'listReleases' | 'createRelease' | 'deleteRelease';
};

// Type guard that ensures the method name is valid for the given namespace K.
type ValidMethod<K extends keyof EndpointNames> = EndpointNames[K] & keyof RestEndpointMethodTypes[K];

// Helper type to get endpoint parameters, including pagination parameters
type EndpointParameters<
  K extends keyof EndpointNames,
  M extends ValidMethod<K>,
> = RestEndpointMethodTypes[K][M] extends { parameters: infer P }
  ? P & { per_page?: number; page?: number } // Add pagination parameters as optional
  : { per_page?: number; page?: number };

// EndpointResponse represents the full response data from a specific API endpoint
type EndpointResponse<K extends keyof EndpointNames, M extends ValidMethod<K>> = RestEndpointMethodTypes[K][M] extends {
  response: { data: infer D };
}
  ? D
  : never;

// PartialResponseData makes the response data partially optional
type PartialResponseData<T> = T extends { data: infer U } ? DeepPartial<T> & { data?: DeepPartial<U> } : DeepPartial<T>;

// Helper type that describes a mock implementation function for a specific GitHub endpoint
type MockImplementationFn<K extends keyof EndpointNames, M extends ValidMethod<K>> = (
  params: NonNullable<Partial<EndpointParameters<K, M>>> & {},
) =>
  | Promise<PartialResponseData<OctokitResponse<EndpointResponse<K, M>>>>
  | PartialResponseData<OctokitResponse<EndpointResponse<K, M>>>;

// Define the complete mock store interface
interface MockStore {
  data: {
    [K in keyof EndpointNames]: {
      [M in ValidMethod<K> & keyof RestEndpointMethodTypes[K]]: PartialResponseData<
        OctokitResponse<EndpointResponse<K, M>>
      >;
    };
  };
  implementations: Partial<{
    [K in keyof EndpointNames]: Partial<{
      [M in ValidMethod<K> & keyof RestEndpointMethodTypes[K]]: MockImplementationFn<K, M>;
    }>;
  }>;
}

// Initialize the mock store
let mockStore: MockStore;

/**
 * Resets the mock store to its default state.
 */
export function resetMockStore() {
  mockStore = {
    data: {
      git: {
        createTag: {
          data: {},
          status: 201,
          url: 'https://api.github.com/repos/techpivot/terraform-module-releaser/git/tags',
          headers: {},
        },
        deleteRef: {
          status: 204,
          url: 'https://api.github.com/repos/techpivot/terraform-module-releaser/git/refs',
          headers: {},
        },
      },
      issues: {
        createComment: {
          data: {},
          status: 201,
          url: 'https://api.github.com/repos/techpivot/terraform-module-releaser/issues/comments',
          headers: {},
        },
        deleteComment: {
          status: 204,
          url: 'https://api.github.com/repos/techpivot/terraform-module-releaser/issues/comments',
          headers: {},
        },
        listComments: {
          data: [
            { user: { id: 739719 }, body: 'Virgofx comment' },
            { user: { id: 41898282 }, body: 'Github actions Bot comment' },
          ],
          status: 200,
          url: 'https://api.github.com/repos/techpivot/terraform-module-releaser/issues/comments',
          headers: {},
        },
      },
      pulls: {
        listCommits: {
          data: [
            { sha: 'sha1', commit: { message: 'Test commit 1' } },
            { sha: 'sha2', commit: { message: 'Test commit 2' } },
          ],
          status: 200,
          url: 'https://api.github.com/repos/techpivot/terraform-module-releaser/pulls/commits',
          headers: {},
        },
        listFiles: {
          data: [{ filename: 'file1.txt' }, { filename: 'file2.txt' }],
          status: 200,
          url: 'https://api.github.com/repos/techpivot/terraform-module-releaser/pulls/files',
          headers: {},
        },
      },
      repos: {
        getCommit: {
          data: { files: [{ filename: 'file1.tf' }] },
          status: 200,
          url: 'https://api.github.com/repos/techpivot/terraform-module-releaser/commits',
          headers: {},
        },
        listTags: {
          data: [{ name: 'v1.0.0' }, { name: 'v1.0.1' }],
          status: 200,
          url: 'https://api.github.com/repos/techpivot/terraform-module-releaser/tags',
          headers: {},
        },
        listReleases: {
          data: [
            {
              id: 182147836,
              name: 'moduleA/v1.0.0',
              body: 'Release notes for moduleA v1.0.0',
              tag_name: 'moduleA/v1.0.0',
            },
          ],
          status: 200,
          url: 'https://api.github.com/repos/techpivot/terraform-module-releaser/releases',
          headers: {},
        },
        createRelease: {
          data: {},
          status: 201,
          url: 'https://api.github.com/repos/techpivot/terraform-module-releaser/releases',
          headers: {},
        },
        deleteRelease: {
          status: 204,
          url: 'https://api.github.com/repos/techpivot/terraform-module-releaser/releases',
          headers: {},
        },
      },
    },
    implementations: {
      git: {},
      issues: {},
      pulls: {},
      repos: {},
    },
  };
}

/**
 * Stubs the return data for a specific Octokit endpoint.
 *
 * @param endpoint - The endpoint in format 'namespace.method'
 * @param responseData - Partial response data to override default values
 */
export function stubOctokitReturnData<K extends keyof EndpointNames, M extends ValidMethod<K>>(
  endpoint: `${K}.${M}`,
  responseData: PartialResponseData<OctokitResponse<EndpointResponse<K, M>>>,
): void {
  const [namespace, method] = endpoint.split('.') as [K, M];
  mockStore.data[namespace][method] = {
    ...mockStore.data[namespace][method],
    ...responseData,
  };
}

/**
 * Stubs an Octokit endpoint implementation.
 *
 * @param endpoint - Endpoint in 'namespace.method' format
 * @param implementation - Mock implementation function
 */
export function stubOctokitImplementation<K extends keyof EndpointNames, M extends ValidMethod<K>>(
  endpoint: `${K}.${M}`,
  implementation: MockImplementationFn<K, M>,
): void {
  const [namespace, method] = endpoint.split('.') as [K, M];
  (mockStore.implementations as Record<K, Record<M, MockImplementationFn<K, M>>>)[namespace][method] = implementation;
}

/**
 * Gets the mock response for an Octokit endpoint, checking for custom implementation first.
 *
 * @param endpoint - The endpoint in format 'namespace.method'
 * @param params - Optional parameters to pass to the implementation
 * @returns Promise containing the mock response data
 */
async function getMockResponse<K extends keyof EndpointNames, M extends ValidMethod<K>>(
  endpoint: `${K}.${M}`,
  params: NonNullable<Partial<EndpointParameters<K, M>>> = {},
): Promise<PartialResponseData<OctokitResponse<EndpointResponse<K, M>>>> {
  const [namespace, method] = endpoint.split('.') as [K, M];

  const customImpl = mockStore.implementations[namespace]?.[method] as MockImplementationFn<K, M> | undefined;
  if (customImpl) {
    return await customImpl(params);
  }

  return mockStore.data[namespace][method] as PartialResponseData<OctokitResponse<EndpointResponse<K, M>>>;
}

/**
 * Creates a mock implementation for paginated API responses
 *
 * @param endpoint - The endpoint in format 'namespace.method'
 * @param slug - The API endpoint slug
 * @returns Vitest mock function
 */
function createPaginatedMockImplementation<K extends keyof EndpointNames, M extends ValidMethod<K>>(
  endpoint: `${K}.${M}`,
  slug: string,
) {
  return vi.fn().mockImplementation(async ({ per_page = 100, page = 1 }: EndpointParameters<K, M>) => {
    const [namespace, method] = endpoint.split('.') as [K, M];

    const customImpl = mockStore.implementations[namespace]?.[method] as MockImplementationFn<K, M>;
    if (customImpl) {
      return customImpl({ per_page, page } as Partial<EndpointParameters<K, M>>);
    }

    const responseData = (mockStore.data[namespace][method] as { data: Array<unknown> }).data;

    if (responseData.length === 0) {
      return {
        data: [],
        headers: { link: null },
        status: 200,
        url: `https://api.github.com/repos/techpivot/terraform-module-releaser${slug}`,
      };
    }

    const startIndex = (page - 1) * per_page;
    const endIndex = startIndex + per_page;
    const pageData = responseData.slice(startIndex, endIndex);
    const totalCount = responseData.length;

    return {
      data: pageData,
      headers: {
        link: getLinkHeader(slug, page, per_page, totalCount),
      },
      status: 200,
      url: `https://api.github.com/repos/techpivot/terraform-module-releaser${slug}`,
    };
  });
}

/**
 * Creates the default Octokit mock with all endpoints
 *
 * @returns Mock Octokit instance
 */
export function createDefaultOctokitMock() {
  resetMockStore();

  const mockOctokit = {
    rest: {
      git: {
        deleteRef: vi.fn().mockImplementation(() => getMockResponse('git.deleteRef')),
        createTag: vi.fn().mockImplementation(() => getMockResponse('git.createTag')),
      },
      issues: {
        createComment: vi.fn().mockImplementation(() => getMockResponse('issues.createComment')),
        deleteComment: vi.fn().mockImplementation(() => getMockResponse('issues.deleteComment')),
        listComments: createPaginatedMockImplementation('issues.listComments', '/issues/comments'),
      },
      pulls: {
        listCommits: createPaginatedMockImplementation('pulls.listCommits', '/pulls/commits'),
        listFiles: createPaginatedMockImplementation('pulls.listFiles', '/pulls/files'),
      },
      repos: {
        getCommit: vi.fn().mockImplementation((params) => getMockResponse('repos.getCommit', params)),
        listTags: createPaginatedMockImplementation('repos.listTags', '/tags'),
        listReleases: createPaginatedMockImplementation('repos.listReleases', '/releases'),
        createRelease: vi.fn().mockImplementation(() => getMockResponse('repos.createRelease')),
        deleteRelease: vi.fn().mockImplementation(() => getMockResponse('repos.deleteRelease')),
      },
    },
    paginate: {
      iterator: <T>(
        fn: (options: EndpointOptions) => Promise<OctokitResponse<{ data: T[] }>>,
        options: EndpointOptions,
      ) => {
        return (async function* () {
          let page = 1;
          while (true) {
            const response = await fn({ ...options, page });
            yield response;

            const link = response.headers?.link;
            if (!link || !link.includes('rel="next"')) {
              break;
            }

            page++;
          }
        })();
      },
    },
  };

  return mockOctokit;
}

/**
 * Creates a real Octokit instance for integration testing
 *
 * @returns Promise containing configured Octokit instance
 */
export async function createRealOctokit() {
  const realOctokit = (await vi.importActual('@octokit/core')) as typeof import('@octokit/core');
  const OctokitWithPaginateAndRest = realOctokit.Octokit.plugin(restEndpointMethods, paginateRest);

  return new OctokitWithPaginateAndRest({
    auth: `token ${process.env.GITHUB_TOKEN}`,
    userAgent: '[octokit] terraform-module-releaser-ci-test',
  });
}

/**
 * Builds the link header for pagination
 *
 * @param slug - The API endpoint slug
 * @param page - Current page number
 * @param perPage - Items per page
 * @param totalCount - Total number of items
 * @returns Formatted link header string or null
 */
function getLinkHeader(slug: string, page: number, perPage: number, totalCount: number): string | null {
  if (perPage <= 0 || totalCount <= perPage) {
    return null;
  }

  const totalPages = Math.ceil(totalCount / perPage);
  if (page >= totalPages) {
    return null;
  }

  const nextPage = page + 1;
  const lastPage = totalPages;
  return `<https://api.github.com/repos/techpivot/terraform-module-releaser/${trimSlashes(slug)}?per_page=${perPage}&page=${nextPage}>; rel="next", <https://api.github.com/repos/techpivot/terraform-module-releaser/${trimSlashes(slug)}?per_page=${perPage}&page=${lastPage}>; rel="last"`;
}
