import type { PaginateInterface } from '@octokit/plugin-paginate-rest';
import type { Api } from '@octokit/plugin-rest-endpoint-methods';

// Custom type that extends Octokit with pagination support
export type OctokitRestApi = Api & { paginate: PaginateInterface };

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
   * The tag name assocaited with this release. E.g. `modules/aws/vpc/v1.0.0`
   */
  tagName: string;
}

// Define a type for the release type options
export type ReleaseType = 'major' | 'minor' | 'patch';

/**
 * Represents a Terraform module.
 */
export interface TerraformModule {
  /**
   * The relative Terraform module path used for tagging with some special characters removed.
   */
  moduleName: string;

  /**
   * The relative path to the directory where the module is located. (This may include other non-name characters)
   */
  directory: string;

  /**
   * Array of tags relevant to this module
   */
  tags: string[];

  /**
   * Array of releases relevant to this module
   */
  releases: GitHubRelease[];

  /**
   * Specifies the full tag associated with the module or null if no tag is found.
   */
  latestTag: string | null;

  /**
   * Specifies the tag version associated with the module (vX.Y.Z) or null if no tag is found.
   */
  latestTagVersion: string | null;
}

/**
 * Represents a changed Terraform module, which indicates that a pull request contains file changes
 * associated with a corresponding Terraform module directory.
 */
export interface TerraformChangedModule extends TerraformModule {
  /**
   *
   */
  isChanged: true;

  /**
   * An array of commit messages associated with the module's changes.
   */
  commitMessages: string[];

  /**
   * The type of release (e.g., major, minor, patch) to be applied to the module.
   */
  releaseType: ReleaseType;

  /**
   * The tag that will be applied to the module for the next release.
   * This should follow the pattern of 'module-name/vX.Y.Z'.
   */
  nextTag: string;

  /**
   * The version string of the next tag, which is formatted as 'vX.Y.Z'.
   */
  nextTagVersion: string;
}

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
   * An array of relative file paths associated with the commit.
   */
  files: string[];
}

/**
 * Configuration interface used for defining key GitHub Action input configuration.
 */
export interface Config {
  /**
   * List of keywords to identify major changes (e.g., breaking changes).
   * These keywords are used to trigger a major version bump in semantic versioning.
   */
  majorKeywords: string[];

  /**
   * List of keywords to identify minor changes.
   * These keywords are used to trigger a minor version bump in semantic versioning.
   */
  minorKeywords: string[];

  /**
   * List of keywords to identify patch changes (e.g., bug fixes).
   * These keywords are used to trigger a patch version bump in semantic versioning.
   */
  patchKeywords: string[];

  /**
   * Default first tag for initializing repositories without existing tags.
   * This serves as the fallback tag when no tags are found in the repository.
   */
  defaultFirstTag: string;

  /**
   * The version of terraform-docs to be used for generating documentation for Terraform modules.
   */
  terraformDocsVersion: string;

  /**
   * Whether to delete legacy tags (tags that do not follow the semantic versioning format or from
   * modules that have been since removed) from the repository.
   */
  deleteLegacyTags: boolean;

  /**
   * Whether to disable wiki generation for Terraform modules.
   * By default, this is set to false. Set to true to prevent wiki documentation from being generated.
   */
  disableWiki: boolean;

  /**
   * An integer that specifies how many changelog entries are displayed in the sidebar per module.
   */
  wikiSidebarChangelogMax: number;

  /**
   * Flag to control whether the small branding link should be disabled or not in the
   * pull request (PR) comments. When branding is enabled, a link to the action's
   * repository is added at the bottom of comments. Setting this flag to `true`
   * will remove that link. This is useful for cleaner PR comments in enterprise environments
   * or where third-party branding is undesirable.
   */
  disableBranding: boolean;

  /**
   * The GitHub token (`GITHUB_TOKEN`) used for API authentication.
   * This token is required to make secure API requests to GitHub during the action.
   */
  githubToken: string;

  /**
   * A comma-separated list of file patterns to exclude from triggering version changes in Terraform modules.
   * These patterns follow glob syntax (e.g., ".gitignore,*.md") and are relative to each Terraform module directory within
   * the repository, rather than the workspace root. Patterns are used for filtering files within module directories, allowing
   * for specific exclusions like documentation or non-Terraform code changes that do not require a version increment.
   */
  moduleChangeExcludePatterns: string[];
  /**
   * A comma-separated list of file patterns to exclude when bundling a Terraform module for tag/release.
   * These patterns follow glob syntax (e.g., "tests/**") and are relative to each Terraform module directory within
   * the repository. By default, all non-functional Terraform files and directories are excluded to reduce the size of the
   * bundled assets. This helps ensure that any imported file is correctly mapped, while allowing for further exclusions of
   * tests and other non-functional files as needed.
   */
  moduleAssetExcludePatterns: string[];
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
