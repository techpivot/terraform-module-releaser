import type { ActionInputMetadata, Config } from '@/types';
import { getBooleanInput, getInput } from '@actions/core';

/**
 * Factory functions to reduce duplication in ACTION_INPUTS metadata definitions.
 * These functions create standardized metadata objects for common input patterns.
 */
const requiredString = (configKey: keyof Config): ActionInputMetadata => ({
  configKey,
  required: true,
  type: 'string',
});

const requiredBoolean = (configKey: keyof Config): ActionInputMetadata => ({
  configKey,
  required: true,
  type: 'boolean',
});

const requiredArray = (configKey: keyof Config): ActionInputMetadata => ({
  configKey,
  required: true,
  type: 'array',
});

const requiredNumber = (configKey: keyof Config): ActionInputMetadata => ({
  configKey,
  required: true,
  type: 'number',
});

const optionalArray = (configKey: keyof Config): ActionInputMetadata => ({
  configKey,
  required: false,
  type: 'array',
});

/**
 * Complete mapping of all GitHub Action inputs to their metadata.
 * This is the single source of truth for input configuration.
 * Note: defaultValue is removed as defaults come from action.yml at runtime
 */
export const ACTION_INPUTS: Record<string, ActionInputMetadata> = {
  'major-keywords': requiredArray('majorKeywords'),
  'minor-keywords': requiredArray('minorKeywords'),
  'patch-keywords': requiredArray('patchKeywords'),
  'default-first-tag': requiredString('defaultFirstTag'),
  'terraform-docs-version': requiredString('terraformDocsVersion'),
  'delete-legacy-tags': requiredBoolean('deleteLegacyTags'),
  'disable-wiki': requiredBoolean('disableWiki'),
  'wiki-sidebar-changelog-max': requiredNumber('wikiSidebarChangelogMax'),
  'wiki-usage-template': requiredString('wikiUsageTemplate'),
  'disable-branding': requiredBoolean('disableBranding'),
  'module-path-ignore': optionalArray('modulePathIgnore'),
  'module-change-exclude-patterns': optionalArray('moduleChangeExcludePatterns'),
  'module-asset-exclude-patterns': optionalArray('moduleAssetExcludePatterns'),
  'use-ssh-source-format': requiredBoolean('useSSHSourceFormat'),
  github_token: requiredString('githubToken'),
  'tag-directory-separator': requiredString('tagDirectorySeparator'),
  'use-version-prefix': requiredBoolean('useVersionPrefix'),
  'module-ref-mode': requiredString('moduleRefMode'),
} as const;

/**
 * Creates a config object by reading inputs using GitHub Actions API and converting them
 * according to the metadata definitions. This provides a dynamic way to build the config
 * without manually mapping each input.
 */
export function createConfigFromInputs(): Config {
  const config = {} as Config;

  for (const [inputName, metadata] of Object.entries(ACTION_INPUTS)) {
    const { configKey, required, type } = metadata;

    try {
      let value: unknown;

      if (type === 'boolean') {
        // Use getBooleanInput for boolean types for proper parsing
        value = getBooleanInput(inputName, { required });
      } else if (type === 'array') {
        // Handle array inputs with special parsing
        const input = getInput(inputName, { required });

        if (!input || input.trim() === '') {
          value = [];
        } else {
          value = Array.from(
            new Set(
              input
                .split(',')
                .map((item: string) => item.trim())
                .filter(Boolean),
            ),
          );
        }
      } else if (type === 'number') {
        // Handle number inputs with parseInt
        const input = getInput(inputName, { required });
        value = Number.parseInt(input, 10);
      } else {
        // Handle string inputs
        value = getInput(inputName, { required });
      }

      // Safely assign to config using the configKey
      Object.assign(config, { [configKey]: value });
    } catch (error) {
      throw new Error(
        `Failed to process input '${inputName}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return config;
}
