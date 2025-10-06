import type { PaginateInterface } from '@octokit/plugin-paginate-rest';
import type { Api } from '@octokit/plugin-rest-endpoint-methods';

/**
 * GitHub API and repository related types
 */

/**
 * Custom type that extends Octokit with pagination support
 */
export type OctokitRestApi = Api & { paginate: PaginateInterface };

/**
 * GitHub tag information
 */
export interface GitHubTag {
  /**
   * The tag name. E.g. `modules/aws/vpc/v1.0.0`
   */
  name: string;

  /**
   * The commit SHA that this tag points to
   */
  commitSHA: string;
}

/**
 * GitHub release information
 */
export interface GitHubRelease {
  /**
   * The release ID
   */
  id: number;

  /**
   * The title of the release.
   */
  title: string;

  /**
   * The body content of the release.
   */
  body: string;

  /**
   * The tag name associated with this release. E.g. `modules/aws/vpc/v1.0.0`
   */
  tagName: string;
}

/**
 * Details about a specific commit. Used by pull request to list commits and then we aggregate files associated
 * with that commit to ultimately determine which files are changed in the pull request.
 */
export interface CommitDetails {
  /**
   * The commit message.
   */
  message: string;

  /**
   * The SHA-1 hash of the commit.
   */
  sha: string;

  /**
   * An array of relative file paths associated with the commit. Important Note: Files are relative
   */
  files: string[];
}

/**
 * Interface representing the repository structure of a GitHub repo in the form of the owner and name.
 */
export interface Repo {
  /**
   * The owner of the repository, typically a GitHub user or an organization.
   */
  owner: string;

  /**
   * The name of the repository.
   */
  repo: string;
}
