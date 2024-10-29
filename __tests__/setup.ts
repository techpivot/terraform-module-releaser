import { afterEach, beforeEach, vi } from 'vitest';
import { configMock } from './__mocks__/config.mock';
import { contextMock } from './__mocks__/context.mock';

vi.mock('../src/config', () => ({
  config: configMock,
}));

vi.mock('../src/context', () => ({
  context: contextMock,
}));

// Mock the entire @actions/core module
export const mockCore = {
  getInput: vi.fn(),
  getBooleanInput: vi.fn(),
  info: vi.fn(),
  startGroup: vi.fn(),
  endGroup: vi.fn(),
  setFailed: vi.fn(),
};

vi.mock('@actions/core', () => ({
  ...mockCore,
}));

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
  // Unstub all environment variables
  vi.unstubAllEnvs();

  // Clear mocks before each test
  vi.resetAllMocks();
});
