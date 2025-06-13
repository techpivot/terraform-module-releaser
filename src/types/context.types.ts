import type { OctokitRestApi, Repo } from '@/types/github.types';

/**
 * Context and runtime related types
 */

/**
 * Interface representing the context required by this GitHub Action.
 * It contains the necessary GitHub API client, repository details, and pull request information.
 */
export interface Context {
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
  octokit: OctokitRestApi;

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
