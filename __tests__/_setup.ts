import { afterEach, beforeEach, vi } from 'vitest';

// Mocked node modules (./__mocks__/*)
vi.mock('@actions/core');

// Mocked internal modules
vi.mock('@/config');
vi.mock('@/context');

const defaultEnvironmentVariables = {
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_REPOSITORY: 'techpivot/terraform-module-releaser',
  GITHUB_EVENT_PATH: '/path/to/event.json',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_WORKSPACE: '/workspace',
};

beforeEach(() => {
  // Initialize environment
  for (const [key, value] of Object.entries(defaultEnvironmentVariables)) {
    vi.stubEnv(key, value);
  }
});

afterEach(() => {
  // Unstub all environment variables.
  vi.unstubAllEnvs();

  // Clear all mocked functions usage data and state
  vi.clearAllMocks();
});
