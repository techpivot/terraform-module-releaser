/**
 * Configuration related types
 */

export type ModuleRefMode = 'tag' | 'sha';

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
   * This serves as the fallback tag when no tags are found in the repository. Note this may
   * be in the format of `v#.#.#` or `#.#.#` (e.g., `v1.0.0` or `1.0.0`).
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
   * A raw, multi-line string to override the default 'Usage' section in the generated wiki.
   * If not provided, a default usage block will be generated. Supports template variables like:
   * - {{module_name}}: The name of the module
   * - {{latest_tag}}: The latest git tag for the module
   * - {{latest_tag_version_number}}: The version number from the latest tag
   * - {{module_source}}: The source URL for the module
   * - {{module_name_terraform}}: The module name formatted for Terraform usage (alphanumeric and underscores only)
   */
  wikiUsageTemplate: string;

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
   * A list of module paths to completely ignore when processing. Any module whose path matches
   * one of these patterns will not be processed for versioning, release, or documentation.
   * Paths are relative to the workspace directory.
   */
  modulePathIgnore: string[];

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
   * The character used to separate directory path components when creating Git tags from module paths.
   * This separator is applied throughout the entire directory structure conversion process, not just
   * between the module name and version.
   *
   * Must be a single character and one of: -, _, /, .
   *
   * When converting a module path like 'modules/aws/s3-bucket' to a Git tag, this separator determines
   * how directory separators (/) are replaced in the tag name portion:
   *
   * Examples with module path 'modules/aws/s3-bucket' and version 'v1.0.0':
   * - "/" (default): modules/aws/s3-bucket/v1.0.0
   * - "-": modules-aws-s3-bucket-v1.0.0
   * - "_": modules_aws_s3_bucket_v1.0.0
   * - ".": modules.aws.s3-bucket.v1.0.0
   *
   * This setting affects tag creation, tag parsing, and tag association logic throughout the system.
   */
  tagDirectorySeparator: string;

  /**
   * Whether to include the "v" prefix in version tags.
   *
   * When true (default), version tags will include the "v" prefix:
   * - Example: module/v1.2.3
   *
   * When false, version tags will not include the "v" prefix:
   * - Example: module/1.2.3
   *
   * For initial releases, this setting takes precedence over any "v" prefix specified in the
   * defaultFirstTag configuration. If useVersionPrefix is false and defaultFirstTag contains
   * a "v" prefix (e.g., "v1.0.0"), the "v" will be automatically removed to ensure consistency
   * with the useVersionPrefix setting (resulting in "1.0.0").
   */
  useVersionPrefix: boolean;

  /**
   * Controls how Terraform module usage examples reference versions in generated documentation.
   *
   * When "tag" (default), module examples use the tag name in the ref parameter:
   * - Example: source = "git::https://github.com/owner/repo.git?ref=aws/vpc-endpoint/v1.1.3"
   *
   * When "sha", module examples use the commit SHA with the tag as a comment:
   * - Example: source = "git::https://github.com/owner/repo.git?ref=abc123def456" # aws/vpc-endpoint/v1.1.3
   *
   * This allows users to pin to immutable commit SHAs (which cannot be deleted) while maintaining
   * human-readable tag references in comments. Useful when working with Renovate to handle
   * module removal scenarios where tags might be deleted.
   *
   * Note: This only affects generated documentation. Tag and release creation remains unchanged.
   */
  moduleRefMode: ModuleRefMode;

  /**
   * Whether to strip the 'terraform-<provider>-' prefix from directory names when calculating module names.
   *
   * When true, directory names that start with 'terraform-' will have the 'terraform-<provider>-' prefix
   * removed from the module name calculation. For example:
   * - 'terraform-aws-vpc' becomes 'vpc'
   * - 'terraform-azure-storage' becomes 'storage'
   *
   * Only affects directories that start with 'terraform-' and contain at least one additional hyphen
   * to identify the provider boundary. Directories like 'terraform-' or 'terraform-module' (without
   * a clear provider separator) will not be modified.
   *
   * When false (default), directory names are used as-is for module name calculation.
   */
  stripTerraformProviderPrefix: boolean;

  /**
   * Whether to include ancestor directory hierarchy in tag/release archives.
   *
   * When true, module content is placed under its full directory path within the archive instead of at the root.
   * This preserves the complete directory structure from the workspace root to the module directory.
   *
   * Examples:
   * - Module at 'terraform-tillo-metadata': archive contains 'terraform-tillo-metadata/main.tf'
   * - Module at 'aws/baseline/terraform-tillo-metadata': archive contains 'aws/baseline/terraform-tillo-metadata/main.tf'
   * - Module at 'modules/aws/networking/vpc': archive contains 'modules/aws/networking/vpc/main.tf'
   *
   * When false (default), module files are placed at the root of the archive.
   *
   * This is useful for tools like Scalr that expect specific directory structures in module archives.
   */
  includeAncestorDirectories: boolean;
}
