import { trimSlashes } from '@/utils/string';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';
import type * as OctokitTypes from '@octokit/types';
import { vi } from 'vitest';

type OctokitDataShape = {
  git: {
    listMatchingRefs: [];
    getRef: [];
    createRef: [];
    createTag: [];
    createCommit: [];
  };
  issues: {
    createComment: [];
    deleteComment: [];
    listComments: [];
    listForRepo: Array<{ number: number; title: string; body: string }>;
  };
  pulls: {
    listCommits: Array<{ sha: string; committer: { name: string } }>;
    listFiles: Array<{ filename: string }>;
  };
  repos: {
    getCommit: { sha: string };
    listTags: Array<{ name: string }>;
    listReleases: [];
  };
};

const defaultOctokitData: OctokitDataShape = {
  git: {
    listMatchingRefs: [],
    getRef: [],
    createRef: [],
    createTag: [],
    createCommit: [],
  },
  issues: {
    createComment: [],
    deleteComment: [],
    listComments: [],
    listForRepo: [
      { number: 1, title: 'issue 1', body: 'issue 1 body' },
      { number: 2, title: 'issue 2', body: 'issue 2 body' },
    ],
  },
  pulls: {
    listCommits: [
      { sha: 'sha1', committer: { name: '<NAME>' } },
      { sha: 'sha2', committer: { name: '<NAME>' } },
    ],
    listFiles: [{ filename: 'file1.txt' }, { filename: 'file2.txt' }],
  },
  repos: {
    getCommit: { sha: '1234567890' },
    listTags: [
      { name: 'v1.0.0' },
      { name: 'v1.0.1' },
      { name: 'v1.0.2' },
      { name: 'v1.0.3' },
      { name: 'v1.0.4' },
      { name: 'v1.0.5' },
      { name: 'v1.1.0' },
      { name: 'v1.1.2' },
    ],
    listReleases: [],
  },
};

const currentOctokitData = { ...defaultOctokitData };

/**
 * Builds the link header for pagination based on the current page, items per page, and total count.
 *
 * @param {string} slug - The API endpoint slug (e.g., '/tags', '/issues')
 * @param {number} page - The current page number
 * @param {number} perPage - The number of items per page
 * @param {number} totalCount - The total number of items
 * @returns {string | null} - The link header string or null if this is the last page
 */
function getLinkHeader(slug: string, page: number, perPage: number, totalCount: number): string | null {
  const totalPages = Math.ceil(totalCount / perPage);
  if (page === totalPages) {
    return null;
  }

  const nextPage = page + 1;
  const lastPage = totalPages;
  return `<https://api.github.com/repos/techpivot/terraform-module-releaser/${trimSlashes(slug)}?per_page=${perPage}&page=${nextPage}>; rel="next", <https://api.github.com/repos/techpivot/terraform-module-releaser${slug}?per_page=${perPage}&page=${lastPage}>; rel="last"`;
}

/**
 * Creates a mock implementation for paginated API responses.
 * This function dynamically retrieves data from `currentOctokitData` using the provided
 * namespace and method to ensure that it reflects any changes made to the data (e.g., by stubbing).
 * It simulates GitHub API pagination by slicing the data according to the requested page and items per page,
 * and constructs pagination headers accordingly.
 *
 * @template T - The type of the items in the response data array.
 * @param {string} namespace - The namespace in `currentOctokitData` where the method resides (e.g., 'repos', 'issues').
 * @param {string} method - The method in the specified namespace to retrieve data from (e.g., 'listTags', 'listForRepo').
 * @param {string} slug - The endpoint slug used in the link header for pagination (e.g., '/tags', '/issues').
 * @param {number} [perPageDefault=100] - The default number of items per page if not specified in the request.
 * @returns {vi.Mock} - A mock function that mimics the paginated response of an Octokit API endpoint.
 */
function createPaginatedMockImplementation<K extends keyof OctokitDataShape>(
  endpoint: `${K}.${string}`, // String literal type for the endpoint format
  slug: string,
  perPageDefault?: number,
) {
  return vi.fn().mockImplementation(async ({ per_page = perPageDefault || 100, page = 1 }) => {
    const [namespace, method] = endpoint.split('.') as [K, keyof OctokitDataShape[K]]; // Narrow types

    // Get the latest data directly from currentOctokitData and coerce to an array as we know this function
    // is only for our list*** methods.
    const data = currentOctokitData[namespace][method] as Array<unknown>;

    const startIndex = (page - 1) * per_page;
    const endIndex = startIndex + per_page;
    const pageData = data.slice(startIndex, endIndex);
    const totalCount = data.length;
    const response = {
      data: pageData,
      headers: {
        link: getLinkHeader(slug, page, per_page, totalCount),
      },
      status: 200,
      url: `https://api.github.com/repos/techpivot/terraform-module-releaser${slug}`,
    };

    return response;
  });
}

/**
 * Stubs the return data for a specific Octokit endpoint.
 *
 * @param {string} endpoint - The Octokit endpoint to stub, in the format 'namespace.method'.
 * @param {unknown} data - The data to be returned by the stubbed Octokit endpoint.
 *
 * @example
 * stubOctokitReturnData('repos.listTags', [
 *   { name: 'v2.0.0' },
 *   { name: 'v2.0.1' },
 *   { name: 'v2.0.2' },
 * ]);
 *
 * @example
 * stubOctokitReturnData('issues.listForRepo', [
 *   { number: 3, title: 'issue 3', body: 'issue 3 body' },
 *   { number: 4, title: 'issue 4', body: 'issue 4 body' },
 * ]);
 */
export function stubOctokitReturnData<K extends keyof OctokitDataShape>(
  endpoint: `${K}.${string}`, // String literal type to enforce specific endpoint format
  data: OctokitDataShape[K][keyof OctokitDataShape[K]], // Expected data type for the method
) {
  const [namespace, method] = endpoint.split('.') as [K, keyof OctokitDataShape[K]]; // Narrow types
  currentOctokitData[namespace][method] = data;
}

/**
 * Default Octokit mock implementation with commonly used methods
 */
export function createDefaultOctokitMock() {
  const mockOctokit = {
    rest: {
      git: {
        deleteRef: vi.fn().mockResolvedValue({ status: 204, data: null }),
        listMatchingRefs: vi.fn().mockResolvedValue(currentOctokitData.git.listMatchingRefs),
        getRef: vi.fn().mockResolvedValue(currentOctokitData.git.getRef),
        createRef: vi.fn().mockResolvedValue(currentOctokitData.git.createRef),
        createTag: vi.fn().mockResolvedValue(currentOctokitData.git.createTag),
        createCommit: vi.fn().mockResolvedValue(currentOctokitData.git.createCommit),
      },
      issues: {
        createComment: vi.fn().mockResolvedValue(currentOctokitData.issues.createComment),
        deleteComment: vi.fn().mockResolvedValue(currentOctokitData.issues.deleteComment),
        listComments: vi.fn().mockResolvedValue(currentOctokitData.issues.listComments),
        listForRepo: createPaginatedMockImplementation('issues.listForRepo', '/issues'),
      },
      pulls: {
        listCommits: createPaginatedMockImplementation('pulls.listCommits', '/pulls/commits'),
        listFiles: createPaginatedMockImplementation('pulls.listFiles', '/pulls/files'),
      },
      repos: {
        getCommit: vi.fn().mockResolvedValue(currentOctokitData.repos.getCommit),
        listTags: createPaginatedMockImplementation('repos.listTags', '/tags'),
        listReleases: vi.fn().mockResolvedValue(currentOctokitData.repos.listReleases),
      },
    },
    paginate: {
      iterator: <T>(
        fn: (options: OctokitTypes.EndpointOptions) => Promise<OctokitTypes.OctokitResponse<{ data: T[] }>>,
        options: OctokitTypes.EndpointOptions,
      ) => {
        return (async function* () {
          let page = 1;
          while (true) {
            const response = await fn({ ...options, page });
            yield response;

            const link = response.headers.link;
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
 */
export async function createRealOctokit() {
  const realOctokit = (await vi.importActual('@octokit/core')) as typeof import('@octokit/core');
  const OctokitWithPaginateAndRest = realOctokit.Octokit.plugin(restEndpointMethods, paginateRest);

  return new OctokitWithPaginateAndRest({
    auth: `token ${process.env.GITHUB_TOKEN}`,
    userAgent: '[octokit] terraform-module-releaser-ci-test',
  });
}
