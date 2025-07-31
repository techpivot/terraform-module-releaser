/**
 * Configuration related types
 */

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

  /**
   * If true, the wiki will use the SSH format for the source URL of the repository.
   * This changes the format of the source URL in the generated wiki documentation to use the SSH format.
   *
   * Example:
   * - SSH format: git::ssh://git@github.com/techpivot/terraform-module-releaser.git
   * - HTTPS format: git::https://github.com/techpivot/terraform-module-releaser.git
   *
   * When set to true, the SSH standard format (non scp variation) will be used. Otherwise, the HTTPS format will be used.
   */
  useSSHSourceFormat: boolean;

  /**
   * A list of module paths to completely ignore when processing. Any module whose path matches
   * one of these patterns will not be processed for versioning, release, or documentation.
   * Paths are relative to the workspace directory.
   */
  modulePathIgnore: string[];

  /**
   * A raw, multi-line string to override the default 'Usage' section in the generated wiki.
   * If not provided, a default usage block will be generated.
   */
  wikiUsageTemplate?: string;
}
