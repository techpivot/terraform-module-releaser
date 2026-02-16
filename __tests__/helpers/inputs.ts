import { getActionDefaults } from '@/tests/helpers/action-defaults';
import type { Config } from '@/types';
import { ACTION_INPUTS } from '@/utils/metadata';
import { vi } from 'vitest';

// Load action defaults once globally
const ACTION_DEFAULTS = getActionDefaults();

// Generate input type arrays from centralized metadata
export const requiredInputs = Object.entries(ACTION_INPUTS)
  .filter(([, metadata]) => metadata.required)
  .map(([inputName]) => inputName);

export const optionalInputs = Object.entries(ACTION_INPUTS)
  .filter(([, metadata]) => !metadata.required)
  .map(([inputName]) => inputName);

export const booleanInputs = Object.entries(ACTION_INPUTS)
  .filter(([, metadata]) => metadata.type === 'boolean')
  .map(([inputName]) => inputName);

export const arrayInputs = Object.entries(ACTION_INPUTS)
  .filter(([, metadata]) => metadata.type === 'array')
  .map(([inputName]) => inputName);

export const stringInputs = Object.entries(ACTION_INPUTS)
  .filter(([, metadata]) => metadata.type === 'string')
  .map(([inputName]) => inputName);

export const numberInputs = Object.entries(ACTION_INPUTS)
  .filter(([, metadata]) => metadata.type === 'number')
  .map(([inputName]) => inputName);

/**
 * Converts an input name to its corresponding config key.
 * @param inputName The input name (e.g., 'github_token', 'module-path-ignore')
 * @returns The corresponding config key as a keyof Config
 */
export function getConfigKey(inputName: string): keyof Config {
  const metadata = ACTION_INPUTS[inputName];
  if (!metadata) {
    throw new Error(`Unknown input: ${inputName}`);
  }

  return metadata.configKey;
}

/**
 * Converts an input name to its corresponding environment variable name.
 * This is the exact inverse of what @actions/core getInput() does.
 * @param inputName The input name (e.g., 'github_token', 'module-path-ignore')
 * @returns The environment variable name (e.g., 'INPUT_GITHUB_TOKEN', 'INPUT_MODULE_PATH_IGNORE')
 */
function inputToEnvVar(inputName: string): string {
  return `INPUT_${inputName.replace(/ /g, '_').toUpperCase()}`;
}

/**
 * Sets up test environment with action defaults and optional overrides.
 * This replaces the previous stubInputEnv function with a cleaner approach
 * that loads defaults from action.yml and applies test-specific overrides.
 *
 * @param overrides - Test-specific overrides for input values.
 */
export function setupTestInputs(overrides: Record<string, string> = {}) {
  // Start with action.yml defaults and apply test-specific defaults
  const allInputs = {
    ...ACTION_DEFAULTS,
    github_token: 'ghp_test_token_2c6912E7710c838347Ae178B4',
    ...overrides,
  };

  // Set environment variables for all values (undefined is valid for vi.stubEnv)
  for (const [inputName, value] of Object.entries(allInputs)) {
    vi.stubEnv(inputToEnvVar(inputName), value);
  }
}

/**
 * Clears a specific action input environment variable.
 *
 * Useful for testing scenarios where you need to remove a specific input. Wrapper around
 * vi.stubEnv which has an unusual syntax for clearing environment variables.
 *
 * @param inputName The input name to clear (e.g., 'github_token', 'module-path-ignore')
 */
export function clearEnvironmentInput(inputName: string): void {
  vi.stubEnv(inputToEnvVar(inputName), undefined);
}
