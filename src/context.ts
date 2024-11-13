import * as fs from 'node:fs';
import { config } from '@/config';
import type { Context } from '@/types';
import { endGroup, info, startGroup } from '@actions/core';
import { Octokit } from '@octokit/core';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';
import type { PullRequestEvent } from '@octokit/webhooks-types';
import { homepage, version } from '../package.json';

// The context object will be initialized lazily
let contextInstance: Context | null = null;

/**
 * Retrieves a required environment variable.
 * This function checks if the environment variable exists and is a valid string.
 * If it is missing or invalid, an error is thrown to halt the workflow execution.
 *
 * @param {string} name - The name of the environment variable to retrieve.
 * @returns {string} The value of the environment variable.
 * @throws {Error} If the environment variable is missing or invalid.
 */
function getRequiredEnvironmentVar(name: string): string {
  const value = process.env[name];
  if (!value || typeof value !== 'string') {
    throw new Error(
      `The ${name} environment variable is missing or invalid. This variable should be automatically set by GitHub for each workflow run. If this variable is missing or not correctly set, it indicates a serious issue with the GitHub Actions environment, potentially affecting the execution of subsequent steps in the workflow. Please review the workflow setup or consult the documentation for proper configuration.`,
    );
  }

  return value;
}

/**
 * Additional type guard to check if an object is a valid PullRequestEvent. By definition, we know that
 * because the GITHUB_EVENT_NAME is "pull_request" the payload will be a PullRequestEvent. However,
 * this validates runtime data additionally.
 */
function isPullRequestEvent(payload: unknown): payload is PullRequestEvent {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'pull_request' in payload &&
    typeof (payload as PullRequestEvent).pull_request === 'object' &&
    typeof (payload as PullRequestEvent).pull_request.number === 'number' &&
    typeof (payload as PullRequestEvent).pull_request.title === 'string' &&
    ((payload as PullRequestEvent).pull_request.body === null ||
      typeof (payload as PullRequestEvent).pull_request.body === 'string') &&
    'repository' in payload &&
    typeof (payload as PullRequestEvent).repository === 'object' &&
    typeof (payload as PullRequestEvent).repository.full_name === 'string'
  );
}

/**
 * Clears the cached context instance during testing.
 *
 * This utility function is specifically designed for testing scenarios where
 * multiple different configurations need to be tested. It resets the singleton
 * instance to null, allowing the next context initialization to start fresh with
 * new mocked values.
 *
 * @remarks
 * - This function only works when NODE_ENV is set to 'test'
 * - It is intended for testing purposes only and should not be used in production code
 * - Typically used in beforeEach() test setup or before testing different context variations
 *
 * @throws {Error} Will not clear config if NODE_ENV !== 'test'
 */
export function clearContextForTesting(): void {
  if (process.env.NODE_ENV === 'test') {
    contextInstance = null;
  }
}

/**
 * Lazily initializes the context object that contains details about the pull request and repository.
 * The context is only created once and reused for subsequent calls.
 *
 * If the action is not run in the context of a pull request, an error will be thrown.
 *
 * @function initializeContext
 * @returns {Context} The context object containing GitHub client and pull request information.
 * @throws {Error} If this workflow is not running in the context of a pull request.
 */
function initializeContext(): Context {
  if (contextInstance) {
    return contextInstance;
  }

  try {
    startGroup('Initializing Context');

    // Get required environment variables
    const eventName = getRequiredEnvironmentVar('GITHUB_EVENT_NAME');
    const serverUrl = getRequiredEnvironmentVar('GITHUB_SERVER_URL');
    const repository = getRequiredEnvironmentVar('GITHUB_REPOSITORY');
    const eventPath = getRequiredEnvironmentVar('GITHUB_EVENT_PATH');
    const workspaceDir = getRequiredEnvironmentVar('GITHUB_WORKSPACE');
    const [owner, repo] = repository.split('/');

    if (eventName !== 'pull_request') {
      throw new Error(
        'This workflow is not running in the context of a pull request. Ensure this workflow is triggered by a pull request event.',
      );
    }

    if (!fs.existsSync(eventPath)) {
      throw new Error(`Specified GITHUB_EVENT_PATH ${eventPath} does not exist`);
    }

    const payload: PullRequestEvent = JSON.parse(fs.readFileSync(eventPath, { encoding: 'utf8' }));

    // Good, we know we have a valid pull_request payload. Let's cast this as our interface
    if (isPullRequestEvent(payload) === false) {
      throw new Error('Event payload did not match expected pull_request event payload');
    }

    // Extend Octokit with REST API methods and pagination support using the plugins
    const OctokitRestApi = Octokit.plugin(restEndpointMethods, paginateRest);

    contextInstance = {
      repo: { owner, repo },
      repoUrl: `${serverUrl}/${owner}/${repo}`,
      octokit: new OctokitRestApi({
        auth: `token ${config.githubToken}`,
        userAgent: `[octokit] terraform-module-releaser/${version} (${homepage})`,
      }),
      prNumber: payload.pull_request.number,
      prTitle: payload.pull_request.title.trim(),
      prBody: payload.pull_request.body ?? '',
      issueNumber: payload.pull_request.number,
      workspaceDir,
      isPrMergeEvent: payload.action === 'closed' && payload.pull_request.merged === true,
    };

    info(`Event Name: ${eventName}`);
    info(`Repository: ${contextInstance.repo.owner}/${contextInstance.repo.repo}`);
    info(`Repository URL: ${contextInstance.repoUrl}`);
    info(`Pull Request Number: ${contextInstance.prNumber}`);
    info(`Pull Request Title: ${contextInstance.prTitle}`);
    info(`Pull Request Body: ${contextInstance.prBody}`);
    info(`Issue Number: ${contextInstance.issueNumber}`);
    info(`Workspace Directory: ${contextInstance.workspaceDir}`);
    info(`Is Pull Request Merge Event: ${contextInstance.isPrMergeEvent}`);

    return contextInstance;
  } finally {
    endGroup();
  }
}

// Create a getter for the context that initializes on first use
export const getContext = (): Context => {
  return initializeContext();
};

// For backward compatibility and existing usage
export const context: Context = new Proxy({} as Context, {
  get(target, prop) {
    return getContext()[prop as keyof Context];
  },
});
