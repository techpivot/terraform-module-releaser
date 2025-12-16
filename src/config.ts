import type { Config } from '@/types';
import {
  ALLOWED_MODULE_REF_MODES,
  RELEASE_TYPE,
  VALID_TAG_DIRECTORY_SEPARATORS,
  VERSION_TAG_REGEX,
} from '@/utils/constants';
import { createConfigFromInputs } from '@/utils/metadata';
import { endGroup, info, startGroup } from '@actions/core';

// Keep configInstance private to this module
let configInstance: Config | null = null;

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

    // Initialize the config instance using action metadata
    configInstance = createConfigFromInputs();

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

    // Validate tag directory separator
    if (configInstance.tagDirectorySeparator.length !== 1) {
      throw new TypeError('Tag directory separator must be exactly one character');
    }
    if (!VALID_TAG_DIRECTORY_SEPARATORS.includes(configInstance.tagDirectorySeparator)) {
      throw new TypeError(
        `Tag directory separator must be one of: ${VALID_TAG_DIRECTORY_SEPARATORS.join(', ')}. Got: '${
          configInstance.tagDirectorySeparator
        }'`,
      );
    }
    // Validate default first tag format
    if (!VERSION_TAG_REGEX.test(configInstance.defaultFirstTag)) {
      throw new TypeError(
        `Default first tag must be in format v#.#.# or #.#.# (e.g., v1.0.0 or 1.0.0). Got: '${configInstance.defaultFirstTag}'`,
      );
    }

    // If we aren't using "v" prefix but the default first tag was specified with a "v"
    // prefix, then strip this to enforce.
    if (!configInstance.useVersionPrefix && configInstance.defaultFirstTag.startsWith('v')) {
      configInstance.defaultFirstTag = configInstance.defaultFirstTag.substring(1);
    }

    // Validate module ref mode
    if (!ALLOWED_MODULE_REF_MODES.includes(configInstance.moduleRefMode)) {
      throw new TypeError(
        `Invalid module_ref_mode '${configInstance.moduleRefMode}'. Must be one of: ${ALLOWED_MODULE_REF_MODES.join(', ')}`,
      );
    }

    // Validate default semver level
    const validSemverLevels = [RELEASE_TYPE.PATCH, RELEASE_TYPE.MINOR, RELEASE_TYPE.MAJOR];
    if (!validSemverLevels.includes(configInstance.defaultSemverLevel as never)) {
      throw new TypeError(
        `Invalid default-semver-level '${configInstance.defaultSemverLevel}'. Must be one of: ${validSemverLevels.join(', ')}`,
      );
    }

    info(`Major Keywords: ${configInstance.majorKeywords.join(', ')}`);
    info(`Minor Keywords: ${configInstance.minorKeywords.join(', ')}`);
    info(`Patch Keywords: ${configInstance.patchKeywords.join(', ')}`);
    info(`Default Semver Level: ${configInstance.defaultSemverLevel}`);
    info(`Default First Tag: ${configInstance.defaultFirstTag}`);
    info(`Terraform Docs Version: ${configInstance.terraformDocsVersion}`);
    info(`Delete Legacy Tags: ${configInstance.deleteLegacyTags}`);
    info(`Disable Wiki: ${configInstance.disableWiki}`);
    info(`Wiki Sidebar Changelog Max: ${configInstance.wikiSidebarChangelogMax}`);
    info(`Module Paths to Ignore: ${configInstance.modulePathIgnore.join(', ')}`);
    info(`Module Change Exclude Patterns: ${configInstance.moduleChangeExcludePatterns.join(', ')}`);
    info(`Module Asset Exclude Patterns: ${configInstance.moduleAssetExcludePatterns.join(', ')}`);
    info(`Use SSH Source Format: ${configInstance.useSSHSourceFormat}`);
    info(`Tag Directory Separator: ${configInstance.tagDirectorySeparator}`);
    info(`Use Version Prefix: ${configInstance.useVersionPrefix}`);
    info(`Module Ref Mode: ${configInstance.moduleRefMode}`);

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
  get(_target, prop) {
    return getConfig()[prop as keyof Config];
  },
});
