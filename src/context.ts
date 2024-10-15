import { existsSync, readFileSync } from 'node:fs';
import { endGroup, info, setFailed, startGroup } from '@actions/core';
import { Octokit } from '@octokit/core';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';
import type { PullRequestEvent } from '@octokit/webhooks-types';
import { homepage, version } from '../package.json';
import { config } from './config';

// Extend Octokit with REST API methods and pagination support using the plugins
const OctokitRestApi = Octokit.plugin(restEndpointMethods, paginateRest);

/**
 * Interface representing the repository structure of a GitHub repo in the form of the owner and name.
 */
interface Repo {
  /**
   * The owner of the repository, typically a GitHub user or an organization.
   */
  owner: string;

  /**
   * The name of the repository.
   */
  repo: string;
}

/**
 * Interface representing the context required by this GitHub Action.
 * It contains the necessary GitHub API client, repository details, and pull request information.
 */
interface Context {
  /**
   * The repository details (owner and name).
   */
  repo: Repo;

  /**
   * The URL of the repository. (e.g. https://github.com/techpivot/terraform-module-releaser)
   */
  repoUrl: string;

  /**
   * An instance of the Octokit class with REST API and pagination plugins enabled.
   * This instance is authenticated using a GitHub token and is used to interact with GitHub's API.
   */
  octokit: InstanceType<typeof OctokitRestApi>;

  /**
   * The pull request number associated with the workflow run.
   */
  prNumber: number;

  /**
   * The title of the pull request.
   */
  prTitle: string;

  /**
   * The body of the pull request.
   */
  prBody: string;

  /**
   * The GitHub API issue number associated with the pull request.
   */
  issueNumber: number;

  /**
   * The workspace directory where the repository is checked out during the workflow run.
   */
  workspaceDir: string;

  /**
   * Flag to indicate if the current event is a pull request merge event.
   */
  isPrMergeEvent: boolean;
}

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
    const errorMessage = `The ${name} environment variable is missing or invalid. This variable should be automatically set by GitHub for each workflow run. If this variable is missing or not correctly set, it indicates a serious issue with the GitHub Actions environment, potentially affecting the execution of subsequent steps in the workflow. Please review the workflow setup or consult the documentation for proper configuration.`;
    setFailed(errorMessage);
    throw new Error(errorMessage);
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

    const eventName = getRequiredEnvironmentVar('GITHUB_EVENT_NAME');
    info(`Event Name: ${eventName}`);

    if (eventName !== 'pull_request') {
      const errorMessage =
        'This workflow is not running in the context of a pull request. Ensure this workflow is triggered by a pull request event.';
      setFailed(errorMessage);
      throw new Error(errorMessage);
    }

    const [owner, repo] = getRequiredEnvironmentVar('GITHUB_REPOSITORY').split('/');
    const payloadPath = getRequiredEnvironmentVar('GITHUB_EVENT_PATH');
    let payload: PullRequestEvent;
    if (existsSync(payloadPath)) {
      payload = JSON.parse(readFileSync(payloadPath, { encoding: 'utf8' }));
    } else {
      const errorMessage = `Specified GITHUB_EVENT_PATH ${payloadPath} does not exist`;
      setFailed(errorMessage);
      throw new Error(errorMessage);
    }

    // Good, we know we have a valid pull_request payload. Let's cast this as our interface
    if (isPullRequestEvent(payload) === false) {
      const errorMessage = 'Event payload did not match expected pull_request event payload';
      setFailed(errorMessage);
      throw new Error(errorMessage);
    }

    contextInstance = {
      repo: { owner, repo },
      repoUrl: `${getRequiredEnvironmentVar('GITHUB_SERVER_URL')}/${owner}/${repo}`,
      octokit: new OctokitRestApi({
        auth: `token ${config.githubToken}`,
        userAgent: `[octokit] terraform-module-releaser/${version} (${homepage})`,
      }),
      prNumber: payload.pull_request.number,
      prTitle: payload.pull_request.title,
      prBody: payload.pull_request.body || '',
      issueNumber: payload.pull_request.number,
      workspaceDir: getRequiredEnvironmentVar('GITHUB_WORKSPACE'),
      isPrMergeEvent: payload.action === 'closed' && payload.pull_request.merged === true,
    };

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

/**
 * The exported `context` object, lazily initialized on first access, provides information about the repository,
 * pull request, and GitHub API client.
 */
export const context: Context = initializeContext();
