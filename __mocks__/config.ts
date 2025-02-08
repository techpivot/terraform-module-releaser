import type { Config } from '@/types';

/**
 * Configuration interface with added utility methods
 */
interface ConfigWithMethods extends Config {
  set: (overrides: Partial<Config>) => void;
  resetDefaults: () => void;
}

/**
 * Default configuration object.
 */
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
  useSSHSourceFormat: false,
};

/**
 * Valid configuration keys.
 */
const validConfigKeys = [
  'majorKeywords',
  'minorKeywords',
  'patchKeywords',
  'defaultFirstTag',
  'terraformDocsVersion',
  'deleteLegacyTags',
  'disableWiki',
  'wikiSidebarChangelogMax',
  'disableBranding',
  'moduleChangeExcludePatterns',
  'moduleAssetExcludePatterns',
  'githubToken',
  'useSSHSourceFormat',
] as const;

type ValidConfigKey = (typeof validConfigKeys)[number];

// Store the actual configuration data
let currentConfig: Config = { ...defaultConfig };

/**
 * Config proxy handler.
 */
const configProxyHandler: ProxyHandler<ConfigWithMethods> = {
  set(target: ConfigWithMethods, key: string, value: unknown): boolean {
    if (!validConfigKeys.includes(key as ValidConfigKey)) {
      throw new Error(`Invalid config key: ${key}`);
    }

    const typedKey = key as keyof Config;
    const expectedValue = defaultConfig[typedKey];

    if ((Array.isArray(expectedValue) && Array.isArray(value)) || typeof expectedValue === typeof value) {
      // @ts-ignore - we know that the key is valid and that the value is correct
      currentConfig[typedKey] = value as typeof expectedValue;
      return true;
    }

    throw new TypeError(`Invalid value type for config key: ${key}`);
  },

  get(target: ConfigWithMethods, prop: string | symbol): unknown {
    if (typeof prop === 'string') {
      if (prop === 'set') {
        return (overrides: Partial<Config> = {}) => {
          // Note: No need for deep merge
          currentConfig = { ...currentConfig, ...overrides } as Config;
        };
      }
      if (prop === 'resetDefaults') {
        return () => {
          currentConfig = { ...defaultConfig };
        };
      }

      return currentConfig[prop as keyof Config];
    }
    return undefined;
  },
};

/**
 * Returns the current configuration.
 */
export function getConfig(): Config {
  return currentConfig;
}

/**
 * Create and export the config object directly with the proxy
 */
export const config: ConfigWithMethods = new Proxy({} as ConfigWithMethods, configProxyHandler);
