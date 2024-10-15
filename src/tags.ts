import { debug, endGroup, info, startGroup } from '@actions/core';
import { RequestError } from '@octokit/request-error';
import { config } from './config';
import { context } from './context';

/**
 * Fetches all tags from the specified GitHub repository.
 *
 * This function utilizes pagination to retrieve all tags, returning them as an array of strings.
 *
 * @returns {Promise<string[]>} A promise that resolves to an array of tag names.
 * @throws {RequestError} Throws an error if the request to fetch tags fails.
 */
export async function getAllTags(): Promise<string[]> {
  console.time('Elapsed time fetching tags');
  startGroup('Fetching repository tags');

  try {
    const {
      octokit,
      repo: { owner, repo },
    } = context;

    const tags: string[] = [];

    for await (const response of octokit.paginate.iterator(octokit.rest.repos.listTags, {
      owner,
      repo,
    })) {
      for (const tag of response.data) {
        tags.push(tag.name);
      }
    }

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
 * Deletes legacy Terraform module tags.
 *
 * This function takes an array of module names and all tags,
 * and deletes the tags that match the format {moduleName}/vX.Y.Z.
 *
 * @param {string[]} terraformModuleNames - Array of Terraform module names to delete.
 * @param {string[]} allTags - Array of all tags in the repository.
 * @returns {Promise<void>}
 */
export async function deleteLegacyTags(terraformModuleNames: string[], allTags: string[]): Promise<void> {
  if (!config.deleteLegacyTags) {
    info('Deletion of legacy tags/releases is disabled. Skipping.');
    return;
  }

  startGroup('Deleting legacy Terraform module tags');

  // Filter tags that match the format {moduleName} or {moduleName}/vX.Y.Z
  const tagsToDelete = allTags.filter((tag) => {
    return terraformModuleNames.some((name) => new RegExp(`^${name}(?:/v\\d+\\.\\d+\\.\\d+)?$`).test(tag));
  });

  if (tagsToDelete.length === 0) {
    info('No legacy tags found to delete. Skipping.');
    return;
  }

  info(`Found ${tagsToDelete.length} legacy tag${tagsToDelete.length !== 1 ? 's' : ''} to delete.`);
  info(JSON.stringify(tagsToDelete, null, 2));

  console.time('Elapsed time deleting legacy tags');

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
    console.timeEnd('Elapsed time deleting legacy tags');
    endGroup();
  }
}
