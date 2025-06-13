import type { ActionInputMetadata, Config } from '@/types';
import { getBooleanInput, getInput } from '@actions/core';

/**
 * Complete mapping of all GitHub Action inputs to their metadata.
 * This is the single source of truth for input configuration.
 * Note: defaultValue is removed as defaults come from action.yml at runtime
 */
export const ACTION_INPUTS: Record<string, ActionInputMetadata> = {
  'major-keywords': {
    configKey: 'majorKeywords',
    required: true,
    type: 'array',
  },
  'minor-keywords': {
    configKey: 'minorKeywords',
    required: true,
    type: 'array',
  },
  'patch-keywords': {
    configKey: 'patchKeywords',
    required: true,
    type: 'array',
  },
  'default-first-tag': {
    configKey: 'defaultFirstTag',
    required: true,
    type: 'string',
  },
  'terraform-docs-version': {
    configKey: 'terraformDocsVersion',
    required: true,
    type: 'string',
  },
  'delete-legacy-tags': {
    configKey: 'deleteLegacyTags',
    required: true,
    type: 'boolean',
  },
  'disable-wiki': {
    configKey: 'disableWiki',
    required: true,
    type: 'boolean',
  },
  'wiki-sidebar-changelog-max': {
    configKey: 'wikiSidebarChangelogMax',
    required: true,
    type: 'number',
  },
  'disable-branding': {
    configKey: 'disableBranding',
    required: true,
    type: 'boolean',
  },
  'module-path-ignore': {
    configKey: 'modulePathIgnore',
    required: false,
    type: 'array',
  },
  'module-change-exclude-patterns': {
    configKey: 'moduleChangeExcludePatterns',
    required: false,
    type: 'array',
  },
  'module-asset-exclude-patterns': {
    configKey: 'moduleAssetExcludePatterns',
    required: false,
    type: 'array',
  },
  'use-ssh-source-format': {
    configKey: 'useSSHSourceFormat',
    required: true,
    type: 'boolean',
  },
  github_token: {
    configKey: 'githubToken',
    required: true,
    type: 'string',
  },
  'tag-directory-separator': {
    configKey: 'tagDirectorySeparator',
    required: true,
    type: 'string',
  },
  'use-version-prefix': {
    configKey: 'useVersionPrefix',
    required: true,
    type: 'boolean',
  },
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
