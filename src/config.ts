import { endGroup, getInput, info, startGroup } from '@actions/core';

/**
 * Configuration interface used for defining key GitHub Action input configuration.
 */
interface Config {
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
   * The GitHub token (`GITHUB_TOKEN`) used for API authentication.
   * This token is required to make secure API requests to GitHub during the action.
   */
  githubToken: string;
}

// The config object will be initialized lazily
let configInstance: Config | null = null;

// Function to split keywords
const getKeywords = (inputName: string): string[] => {
  return getInput(inputName, { required: true }).split(',');
};

/**
 * Lazy-initialized configuration object.
 */
function initializeConfig(): Config {
  if (configInstance) {
    return configInstance;
  }

  startGroup('Initializing Config');

  // Initialize the config instance
  configInstance = {
    majorKeywords: getKeywords('major-keywords'),
    minorKeywords: getKeywords('minor-keywords'),
    patchKeywords: getKeywords('patch-keywords'),
    defaultFirstTag: getInput('default-first-tag', { required: true }),
    terraformDocsVersion: getInput('terraform-docs-version', { required: true }),
    deleteLegacyTags: getInput('delete-legacy-tags', { required: true }).toLowerCase() === 'true',
    disableWiki: getInput('disable-wiki', { required: true }).toLowerCase() === 'true',
    wikiSidebarChangelogMax: Number.parseInt(getInput('wiki-sidebar-changelog-max', { required: true }), 10),
    githubToken: getInput('github_token', { required: true }),
  };

  info(`Major Keywords: ${configInstance.majorKeywords.join(', ')}`);
  info(`Minor Keywords: ${configInstance.minorKeywords.join(', ')}`);
  info(`Patch Keywords: ${configInstance.patchKeywords.join(', ')}`);
  info(`Default First Tag: ${configInstance.defaultFirstTag}`);
  info(`Terraform Docs Version: ${configInstance.terraformDocsVersion}`);
  info(`Delete Legacy Tags: ${configInstance.deleteLegacyTags}`);
  info(`Disable Wiki: ${configInstance.disableWiki}`);
  info(`Wiki Sidebar Changelog Max: ${configInstance.wikiSidebarChangelogMax}`);

  endGroup();

  return configInstance;
}

export const config: Config = initializeConfig();
