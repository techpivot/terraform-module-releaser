import { setupTestInputs } from '@/tests/helpers/inputs';
import type { Config } from '@/types';
import type { ActionInputMetadata } from '@/types';
import { ACTION_INPUTS, createConfigFromInputs } from '@/utils/metadata';

/**
 * Configuration interface with added utility methods.
 */
export interface ConfigWithMethods extends Config {
  set: (overrides: Partial<Config>) => void;
  resetDefaults: () => void;
}

/**
 * Load default configuration from action.yml.
 */
const createDefaultConfig = (): Config => {
  setupTestInputs();
  return createConfigFromInputs();
};

/**
 * Default configuration object loaded from action.yml.
 */
const defaultConfig: Config = createDefaultConfig();

/**
 * Valid configuration keys derived from ACTION_INPUTS.
 */
const validConfigKeys = (Object.values(ACTION_INPUTS) as ActionInputMetadata[]).map(
  (metadata) => metadata.configKey,
) as Array<keyof Config>;

type ValidConfigKey = (typeof validConfigKeys)[number];

// Store the actual configuration data
let currentConfig: Config = { ...defaultConfig };

/**
 * Config proxy handler.
 */
const configProxyHandler: ProxyHandler<ConfigWithMethods> = {
  set(_target: ConfigWithMethods, key: string, value: unknown): boolean {
    if (!validConfigKeys.includes(key as ValidConfigKey)) {
      throw new Error(`Invalid config key: ${key}`);
    }

    const typedKey = key as keyof Config;
    const expectedValue = defaultConfig[typedKey];

    if ((Array.isArray(expectedValue) && Array.isArray(value)) || typeof expectedValue === typeof value) {
      // @ts-expect-error - we know that the key is valid and that the value is correct
      currentConfig[typedKey] = value as typeof expectedValue;
      return true;
    }

    throw new TypeError(`Invalid value type for config key: ${key}`);
  },

  get(_target: ConfigWithMethods, prop: string | symbol): unknown {
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
