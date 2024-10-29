import { merge } from 'ts-deepmerge';
import type { Config } from '../../src/config';

type InputMap = {
  [key: string]: string;
};

const defaultInputs: InputMap = {
  'major-keywords': 'MAJOR CHANGE,BREAKING CHANGE,!',
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
  majorKeywords: ['BREAKING CHANGE', '!', 'MAJOR CHANGE'],
  minorKeywords: ['feat', 'feature'],
  patchKeywords: ['fix', 'chore'],
  defaultFirstTag: 'v1.0.0',
  terraformDocsVersion: 'v0.19.0',
  deleteLegacyTags: false,
  disableWiki: false,
  wikiSidebarChangelogMax: 10,
  disableBranding: false,
  moduleChangeExcludePatterns: ['.gitignore', '*.md'],
  moduleAssetExcludePatterns: ['tests/**', 'examples/**'],
  githubToken: 'ghp_test_token_2c6912E7710c838347Ae178B4',
};

// Create a mock inputs factory function
export function createInputsMock(inputs: InputMap = {}): InputMap {
  return merge(defaultInputs, inputs);
}

// Create a mocked config object with a set method to deep merge additional ovverides.
export const configMock: Config & {
  reset: () => void;
  set: (overrides?: Partial<Config>) => void;
} = {
  ...defaultConfig,

  reset: () => {
    for (const key of Object.keys(defaultConfig)) {
      if (key !== 'reset' && key !== 'set') {
        configMock[key] = defaultConfig[key];
      }
    }
  },

  // Method to update specific values
  set: (overrides: Partial<Config> = {}) => {
    const updated = merge(configMock, overrides);
    for (const key of Object.keys(updated)) {
      if (key !== 'reset' && key !== 'set') {
        configMock[key] = updated[key];
      }
    }
  },
};
