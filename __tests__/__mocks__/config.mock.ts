import { merge } from 'ts-deepmerge';
import { vi } from 'vitest';
import type { Config } from '../../src/config';

type InputMap = {
  [key: string]: string;
};

const defaultInputs: InputMap = {
  'major-keywords': 'BREAKING CHANGE,!',
  'minor-keywords': 'feat,feature',
  'patch-keywords': 'fix,chore',
  'default-first-tag': 'v0.1.0',
  'terraform-docs-version': 'v0.16.0',
  'delete-legacy-tags': 'false',
  'disable-wiki': 'false',
  'wiki-sidebar-changelog-max': '10',
  'disable-branding': 'false',
  'module-change-exclude-patterns': '.gitignore,*.md',
  'module-asset-exclude-patterns': 'tests/**,examples/**',
  github_token: 'test-token',
};

const defaultConfig: Config = {
  majorKeywords: ['BREAKING CHANGE', '!'],
  minorKeywords: ['feat', 'feature'],
  patchKeywords: ['fix', 'chore'],
  defaultFirstTag: 'v0.1.0',
  terraformDocsVersion: 'v0.19.0',
  deleteLegacyTags: false,
  disableWiki: false,
  wikiSidebarChangelogMax: 10,
  disableBranding: false,
  moduleChangeExcludePatterns: ['.gitignore', '*.md'],
  moduleAssetExcludePatterns: ['tests/**', 'examples/**'],
  githubToken: 'ghp_test_token_2c6912E7710c838347Ae178B4',
};

// Create a mock factory function
export const createConfigMock = (overrides: Partial<Config> = {}) => ({
  ...defaultConfig,
  ...overrides,
});

// Create a mock inputs factory function
export function createInputsMock(inputs: InputMap = {}): InputMap {
  return merge(defaultInputs, inputs);
}

// Create the mock handler
export const configMock = vi.fn(() => defaultConfig);
