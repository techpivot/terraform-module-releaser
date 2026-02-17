import { setupTestInputs } from '@/tests/helpers/inputs';
import { afterEach, beforeEach, vi } from 'vitest';
import type { ConfigWithMethods } from '@/mocks/config';
import { config as _config } from '@/config';

// Mocked node modules (./__mocks__/*)
vi.mock('@actions/core');

// Mocked internal modules
vi.mock('@/config', () => import('@/mocks/config'));
vi.mock('@/context', () => import('@/mocks/context'));

// Import mock config singleton for global lifecycle reset.
// This import resolves to the mocked module above (not the real one).
// Cast to ConfigWithMethods to access .resetDefaults() without ts-expect-error.
const config = _config as ConfigWithMethods;

// Mock console time/timeEnd to be a no-op
vi.spyOn(console, 'time').mockImplementation(() => {});
vi.spyOn(console, 'timeEnd').mockImplementation(() => {});

const defaultEnvironmentVariables = {
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_REPOSITORY: 'techpivot/terraform-module-releaser',
  GITHUB_EVENT_PATH: '/path/to/event.json',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_WORKSPACE: '/workspace',
};

beforeEach(() => {
  // Initialize GitHub mock pull request environment
  for (const [key, value] of Object.entries(defaultEnvironmentVariables)) {
    vi.stubEnv(key, value);
  }

  // Set up action input defaults for testing
  setupTestInputs();

  // Clear all mocked functions usage data and state
  vi.clearAllMocks();
});

afterEach(() => {
  // Reset mock config to default state, preventing state leakage between tests.
  // This ensures tests that call config.set() don't pollute subsequent tests.
  // Note: context is NOT reset globally because some integration test suites use
  // beforeAll/afterAll to manage real Octokit instances across multiple tests.
  config.resetDefaults();

  // Unstub all environment variables.
  vi.unstubAllEnvs();

  // Clear all mocked functions usage data and state
  vi.clearAllMocks();
});
