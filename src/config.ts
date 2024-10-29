import { endGroup, getBooleanInput, getInput, info, startGroup } from '@actions/core';

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

// Keep configInstance private to this module
let configInstance: Config | null = null;

/**
 * Retrieves an array of values from a comma-separated input string. Duplicates any empty values
 * are removed and each value is trimmed of whitespace.
 *
 * @param inputName - Name of the input to retrieve.
 * @returns An array of trimmed and filtered values.
 */
const getArrayInput = (inputName: string): string[] => {
  const input = getInput(inputName, { required: true });

  return Array.from(
    new Set(
      input
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
};

/**
 * Clears the cached config instance during testing.
 *
 * This utility function is specifically designed for testing scenarios where
 * multiple different configurations need to be tested. It resets the singleton
 * instance to null, allowing the next config initialization to start fresh with
 * new mocked values.
 *
 * @remarks
 * - This function only works when NODE_ENV is set to 'test'
 * - It is intended for testing purposes only and should not be used in production code
 * - Typically used in beforeEach() test setup or before testing different config variations
 *
 * @throws {Error} Will not clear config if NODE_ENV !== 'test'
 */
export function clearConfigForTesting(): void {
  if (process.env.NODE_ENV === 'test') {
    configInstance = null;
  }
}

/**
 * Lazy-initialized configuration object. This is kept separate from the exported
 * config to allow testing utilities to be imported without triggering initialization.
 */
function initializeConfig(): Config {
  if (configInstance) {
    return configInstance;
  }

  try {
    startGroup('Initializing Config');

    // Initialize the config instance
    configInstance = {
      majorKeywords: getArrayInput('major-keywords'),
      minorKeywords: getArrayInput('minor-keywords'),
      patchKeywords: getArrayInput('patch-keywords'),
      defaultFirstTag: getInput('default-first-tag', { required: true }),
      terraformDocsVersion: getInput('terraform-docs-version', { required: true }),
      deleteLegacyTags: getBooleanInput('delete-legacy-tags'),
      disableWiki: getBooleanInput('disable-wiki'),
      wikiSidebarChangelogMax: Number.parseInt(getInput('wiki-sidebar-changelog-max', { required: true }), 10),
      disableBranding: getBooleanInput('disable-branding'),
      githubToken: getInput('github_token', { required: true }),
      moduleChangeExcludePatterns: getArrayInput('module-change-exclude-patterns'),
      moduleAssetExcludePatterns: getArrayInput('module-asset-exclude-patterns'),
    };

    // Validate that *.tf is not in excludePatterns
    if (configInstance.moduleChangeExcludePatterns.some((pattern) => pattern === '*.tf')) {
      throw new TypeError('Exclude patterns cannot contain "*.tf" as it is required for module detection');
    }
    if (configInstance.moduleAssetExcludePatterns.some((pattern) => pattern === '*.tf')) {
      throw new TypeError('Asset exclude patterns cannot contain "*.tf" as these files are required');
    }

    // Validate WikiSidebar Changelog Max is a number and greater than zero
    if (configInstance.wikiSidebarChangelogMax < 1 || Number.isNaN(configInstance.wikiSidebarChangelogMax)) {
      throw new TypeError('Wiki Sidebar Change Log Max must be an integer greater than or equal to one');
    }

    info(`Major Keywords: ${configInstance.majorKeywords.join(', ')}`);
    info(`Minor Keywords: ${configInstance.minorKeywords.join(', ')}`);
    info(`Patch Keywords: ${configInstance.patchKeywords.join(', ')}`);
    info(`Default First Tag: ${configInstance.defaultFirstTag}`);
    info(`Terraform Docs Version: ${configInstance.terraformDocsVersion}`);
    info(`Delete Legacy Tags: ${configInstance.deleteLegacyTags}`);
    info(`Disable Wiki: ${configInstance.disableWiki}`);
    info(`Wiki Sidebar Changelog Max: ${configInstance.wikiSidebarChangelogMax}`);
    info(`Module Change Exclude Patterns: ${configInstance.moduleChangeExcludePatterns.join(', ')}`);
    info(`Module Asset Exclude Patterns: ${configInstance.moduleAssetExcludePatterns.join(', ')}`);

    return configInstance;
  } finally {
    endGroup();
  }
}

// Create a getter for the config that initializes on first use
export const getConfig = (): Config => {
  return initializeConfig();
};

// For backward compatibility and existing usage
export const config: Config = new Proxy({} as Config, {
  get(target, prop) {
    return getConfig()[prop as keyof Config];
  },
});
