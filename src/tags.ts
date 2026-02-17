import { context } from '@/context';
import type { GitHubTag } from '@/types';
import { debug, endGroup, info, startGroup } from '@actions/core';
import type { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods';
import { RequestError } from '@octokit/request-error';

type ListTagsParams = Omit<RestEndpointMethodTypes['repos']['listTags']['parameters'], 'owner' | 'repo'>;

/**
 * Fetches all tags from the specified GitHub repository.
 *
 * This function utilizes pagination to retrieve all tags with their commit SHAs,
 * returning them as an array of GitHubTag objects.
 *
 * @param {ListTagsParams} options - Optional configuration for the API request
 * @param {number} options.perPage - Number of items per page (default: 100)
 * @returns {Promise<GitHubTag[]>} A promise that resolves to an array of tag objects with name and commitSHA.
 * @throws {RequestError} Throws an error if the request to fetch tags fails.
 */
export async function getAllTags(options?: ListTagsParams): Promise<GitHubTag[]> {
  const { per_page = 100, page = 1, ...rest }: ListTagsParams = options ?? ({} as ListTagsParams);
  console.time('Elapsed time fetching tags');
  startGroup('Fetching repository tags');

  try {
    const {
      octokit,
      repo: { owner, repo },
    } = context;

    const tags: GitHubTag[] = [];
    let totalRequests = 0;
    const paginationOptions: ListTagsParams = {
      per_page,
      page,
      ...rest,
    };

    for await (const response of octokit.paginate.iterator(octokit.rest.repos.listTags, {
      ...paginationOptions,
      owner,
      repo,
    })) {
      totalRequests++;
      for (const tag of response.data) {
        tags.push({
          name: tag.name,
          commitSHA: tag.commit.sha,
        });
      }
    }

    debug(`Total page requests: ${totalRequests}`);
    info(`Found ${tags.length} tag${tags.length !== 1 ? 's' : ''}.`);
    debug(JSON.stringify(tags, null, 2));

    return tags;
  } catch (error) {
    let errorMessage: string;
    if (error instanceof RequestError) {
      errorMessage = `Failed to fetch tags: ${error.message.trim()} (status: ${error.status})`;
    } else if (error instanceof Error) {
      errorMessage = `Failed to fetch tags: ${error.message.trim()}`;
    } else {
      errorMessage = String(error).trim();
    }

    throw new Error(errorMessage, { cause: error });
  } finally {
    console.timeEnd('Elapsed time fetching tags');
    endGroup();
  }
}

/**
 * Deletes specified tags from the repository.
 *
 * This function takes an array of tag names and deletes them from the GitHub repository.
 * It's a declarative approach where you simply specify which tags to delete.
 *
 * @param {string[]} tagsToDelete - Array of tag names to delete from the repository
 * @returns {Promise<void>} A promise that resolves when all tags are deleted
 * @throws {Error} When tag deletion fails due to permissions or API errors
 *
 * @example
 * ```typescript
 * await deleteTags(['v1.0.0', 'legacy-tag', 'module/v2.0.0']);
 * ```
 */
export async function deleteTags(tagsToDelete: string[]): Promise<void> {
  if (tagsToDelete.length === 0) {
    info('No tags found to delete. Skipping.');
    return;
  }

  startGroup('Deleting tags');

  info(`Deleting ${tagsToDelete.length} tag${tagsToDelete.length !== 1 ? 's' : ''}`);
  info(JSON.stringify(tagsToDelete, null, 2));

  console.time('Elapsed time deleting tags');

  const {
    octokit,
    repo: { owner, repo },
  } = context;

  let tag = ''; // used for better error handling below.
  try {
    for (tag of tagsToDelete) {
      info(`Deleting tag: ${tag}`);
      await octokit.rest.git.deleteRef({
        owner,
        repo,
        ref: `tags/${tag}`,
      });
    }
  } catch (error) {
    const requestError = error as RequestError;
    if (requestError.status === 403) {
      throw new Error(
        [
          `Failed to delete repository tag: ${tag} ${requestError.message}.\nEnsure that the`,
          'GitHub Actions workflow has the correct permissions to delete tags by ensuring that',
          'your workflow YAML file has the following block under "permissions":\n\npermissions:\n',
          ' contents: write',
        ].join(' '),
        { cause: error },
      );
    }
    throw new Error(`Failed to delete tag: [Status = ${requestError.status}] ${requestError.message}`, {
      cause: error,
    });
  } finally {
    console.timeEnd('Elapsed time deleting tags');
    endGroup();
  }
}
