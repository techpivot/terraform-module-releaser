import type { Config } from '@/types';
import { endGroup, getBooleanInput, getInput, info, startGroup } from '@actions/core';

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
        .map((item: string) => item.trim())
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
      deleteLegacyTags: getBooleanInput('delete-legacy-tags', { required: true }),
      disableWiki: getBooleanInput('disable-wiki', { required: true }),
      wikiSidebarChangelogMax: Number.parseInt(getInput('wiki-sidebar-changelog-max', { required: true }), 10),
      disableBranding: getBooleanInput('disable-branding', { required: true }),
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
export function getConfig(): Config {
  return initializeConfig();
}

// For backward compatibility and existing usage
export const config: Config = new Proxy({} as Config, {
  get(target, prop) {
    return getConfig()[prop as keyof Config];
  },
});
