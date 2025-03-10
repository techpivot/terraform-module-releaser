import type { Config } from '@/types';
import { vi } from 'vitest';

const INPUT_KEY = 'INPUT_';

/**
 * Type-safe mapping from input names to config keys.
 * This ensures that each value is a valid key in the Config type.
 */
export const inputToConfigKeyMap: Record<string, keyof Config> = {
  'major-keywords': 'majorKeywords',
  'minor-keywords': 'minorKeywords',
  'patch-keywords': 'patchKeywords',
  'default-first-tag': 'defaultFirstTag',
  'terraform-docs-version': 'terraformDocsVersion',
  'delete-legacy-tags': 'deleteLegacyTags',
  'disable-wiki': 'disableWiki',
  'wiki-sidebar-changelog-max': 'wikiSidebarChangelogMax',
  'disable-branding': 'disableBranding',
  github_token: 'githubToken',
  'module-path-ignore': 'modulePathIgnore',
  'module-change-exclude-patterns': 'moduleChangeExcludePatterns',
  'module-asset-exclude-patterns': 'moduleAssetExcludePatterns',
  'use-ssh-source-format': 'useSSHSourceFormat',
};

// Create reverse mapping from config keys to input names
export const configKeyToInputMap = Object.entries(inputToConfigKeyMap).reduce(
  (acc, [inputName, configKey]) => {
    acc[configKey] = inputName;
    return acc;
  },
  {} as Record<keyof Config, string>,
);

// Default inputs used for testing @actions/core behavior
export const defaultInputs = {
  'major-keywords': 'MAJOR CHANGE,BREAKING CHANGE,!',
  'minor-keywords': 'feat,feature',
  'patch-keywords': 'fix,chore',
  'default-first-tag': 'v0.1.0',
  'terraform-docs-version': 'v0.19.0',
  'delete-legacy-tags': 'false',
  'disable-wiki': 'false',
  'wiki-sidebar-changelog-max': '10',
  'disable-branding': 'false',
  'module-path-ignore': 'tf-modules/kms/examples/complete',
  'module-change-exclude-patterns': '.gitignore,*.md',
  'module-asset-exclude-patterns': 'tests/**,examples/**',
  github_token: 'ghp_test_token_2c6912E7710c838347Ae178B4',
  'use-ssh-source-format': 'false',
};
export const requiredInputs = [
  'major-keywords',
  'minor-keywords',
  'patch-keywords',
  'default-first-tag',
  'terraform-docs-version',
  'delete-legacy-tags',
  'disable-wiki',
  'wiki-sidebar-changelog-max',
  'disable-branding',
  'github_token',
  'use-ssh-source-format',
];
export const optionalInputs = Object.keys(defaultInputs).filter((key) => !requiredInputs.includes(key));
export const booleanInputs = ['delete-legacy-tags', 'disable-wiki', 'disable-branding', 'use-ssh-source-format'];
export const arrayInputs = [
  'major-keywords',
  'minor-keywords',
  'patch-keywords',
  'module-path-ignore',
  'module-change-exclude-patterns',
  'module-asset-exclude-patterns',
];
export const stringInputs = ['default-first-tag', 'terraform-docs-version', 'github_token'];
export const numberInputs = ['wiki-sidebar-changelog-max'];

/**
 * Converts a dash-case input name to its corresponding camelCase config key
 * Prefer using the inputToConfigKeyMap directly for known input keys
 *
 * @param inputName The input name to convert
 * @returns The corresponding config key as a string
 */
export function inputToConfigKey(inputName: string): string {
  // Check if the input name is in our mapping first
  if (inputName in inputToConfigKeyMap) {
    return inputToConfigKeyMap[inputName];
  }

  // Fallback to the conversion logic
  return inputName.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Stubs environment variables with an `INPUT_` prefix using a set of default values,
 * while allowing specific overrides. By default, this function sets a baseline of
 * sane default environment values that would typically be used in tests.
 *
 * Overrides can be provided as key-value pairs, where:
 * - A `string` value sets or replaces the environment variable.
 * - A `null` value skips the setting, allowing for flexibility in customizing the stubbed environment.
 *
 * @param {Record<string, string | null>} overrides - An object specifying environment variable overrides.
 *   Keys in this object correspond to the environment variable names (without the `INPUT_` prefix),
 *   and values specify the desired values or `null` to skip setting.
 */
export function stubInputEnv(inputs: Record<string, string | null> = {}) {
  // Merge default inputs with overrides, giving precedence to overrides
  const mergedInputs = { ...defaultInputs, ...inputs };

  for (const [key, value] of Object.entries(mergedInputs)) {
    if (value === null) {
      continue;
    }

    const prefixedKey = `${INPUT_KEY}${key.replace(/ /g, '_').toUpperCase()}`;
    vi.stubEnv(prefixedKey, value);
  }
}
