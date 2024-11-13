import type { Config } from '@/types';
import { vi } from 'vitest';

const INPUT_KEY = 'INPUT_';

type BooleanConfigKeys = {
  [K in keyof Config]: Config[K] extends boolean ? K : never;
}[keyof Config];

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
  'module-change-exclude-patterns': '.gitignore,*.md',
  'module-asset-exclude-patterns': 'tests/**,examples/**',
  github_token: 'ghp_test_token_2c6912E7710c838347Ae178B4',
};
export const requiredInputs = Object.keys(defaultInputs);
export const booleanInputs = ['delete-legacy-tags', 'disable-wiki', 'disable-branding'];
export const booleanConfigKeys: BooleanConfigKeys[] = ['deleteLegacyTags', 'disableWiki', 'disableBranding'];

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
