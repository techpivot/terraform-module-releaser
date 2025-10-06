import { execFileSync } from 'node:child_process';
import type { ExecFileSyncOptions } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '@/mocks/config';
import { context } from '@/mocks/context';
import type { ExecSyncError } from '@/types';
import { configureGitAuthentication, getGitHubActionsBotEmail } from '@/utils/github';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import which from 'which';

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

describe('utils/github', () => {
  describe('getGitHubActionsBotEmail - real API queries', () => {
    beforeAll(async () => {
      if (!process.env.GITHUB_TOKEN) {
        throw new Error('GITHUB_TOKEN environment variable must be set for these tests');
      }
      await context.useRealOctokit();
    });

    it('should return the correct email format for GitHub.com public API', async () => {
      // This test uses the real GitHub API and expects the standard GitHub.com user ID
      // for the github-actions[bot] user, which is 41898282

      const result = await getGitHubActionsBotEmail();

      // Assert
      expect(result).toBe('41898282+github-actions[bot]@users.noreply.github.com');
    });
  });

  describe('configureGitAuthentication', () => {
    let tmpDir: string;
    let gitPath: string;

    beforeEach(async () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'git-auth-test-'));
      mkdirSync(join(tmpDir, '.git'), { recursive: true });
      gitPath = await which('git');

      context.set({
        repoUrl: 'https://github.com/techpivot/terraform-module-releaser',
      });

      config.set({
        githubToken: 'test-token-12345',
      });

      vi.clearAllMocks();
    });

    afterEach(() => {
      if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should configure git authentication with extraheader', () => {
      const execOptions: ExecFileSyncOptions = { cwd: tmpDir };

      configureGitAuthentication(gitPath, execOptions);

      // Get all the git config commands that were called
      const gitCalls = vi.mocked(execFileSync).mock.calls.map((call) => call?.[1]?.join(' ') || '');

      // Should first try to unset existing extraheader
      expect(gitCalls).toContain('config --local --unset-all http.https://github.com/.extraheader');

      // Should then set the new extraheader with authentication
      expect(gitCalls).toEqual(
        expect.arrayContaining([
          expect.stringContaining('config --local http.https://github.com/.extraheader Authorization: Basic'),
        ]),
      );
    });

    it('should handle unsetting config extraheader and throw error when status is not 5', () => {
      const mockExecFileSync = vi.fn(
        (_command: string, args?: readonly string[] | undefined, _options?: ExecFileSyncOptions) => {
          if (args?.includes('--unset-all') && args.includes('http.https://github.com/.extraheader')) {
            const error = new Error('git config error') as ExecSyncError;
            error.status = 10;
            throw error;
          }

          return Buffer.from('');
        },
      );
      vi.mocked(execFileSync).mockImplementation(mockExecFileSync);

      const execOptions: ExecFileSyncOptions = { cwd: tmpDir };

      expect(() => configureGitAuthentication(gitPath, execOptions)).toThrow('git config error');
    });

    it('should handle unsetting config extraheader gracefully when status is 5', () => {
      const mockExecFileSync = vi.fn(
        (_command: string, args?: readonly string[] | undefined, _options?: ExecFileSyncOptions) => {
          if (args?.includes('--unset-all') && args.includes('http.https://github.com/.extraheader')) {
            const error = new Error('git config error') as ExecSyncError;
            error.status = 5; // Git status code 5 means config key doesn't exist
            throw error;
          }

          return Buffer.from('');
        },
      );
      vi.mocked(execFileSync).mockImplementation(mockExecFileSync);

      const execOptions: ExecFileSyncOptions = { cwd: tmpDir };

      // Should not throw because status 5 is ignored (config key doesn't exist)
      expect(() => configureGitAuthentication(gitPath, execOptions)).not.toThrow();
    });

    it('should use correct server domain from repoUrl', () => {
      context.set({
        repoUrl: 'https://github.example.com/org/repo',
      });

      const execOptions: ExecFileSyncOptions = { cwd: tmpDir };
      configureGitAuthentication(gitPath, execOptions);

      const gitCalls = vi.mocked(execFileSync).mock.calls.map((call) => call?.[1]?.join(' ') || '');

      // Should use the custom domain
      expect(gitCalls).toContain('config --local --unset-all http.https://github.example.com/.extraheader');
      expect(gitCalls).toEqual(
        expect.arrayContaining([
          expect.stringContaining('config --local http.https://github.example.com/.extraheader Authorization: Basic'),
        ]),
      );
    });

    it('should encode token correctly in base64', () => {
      const execOptions: ExecFileSyncOptions = { cwd: tmpDir };
      configureGitAuthentication(gitPath, execOptions);

      const gitCalls = vi.mocked(execFileSync).mock.calls;

      // Find the call that sets the extraheader (not the unset-all call)
      const authCall = gitCalls.find((call) => {
        const args = call[1];
        return (
          Array.isArray(args) &&
          args.includes('config') &&
          args.includes('--local') &&
          !args.includes('--unset-all') &&
          args.some((arg) => typeof arg === 'string' && arg.includes('Authorization: Basic'))
        );
      });

      expect(authCall).toBeDefined();

      // The last argument should contain the base64-encoded token
      const authHeader = authCall?.[1]?.[3];
      expect(authHeader).toContain('Authorization: Basic');

      // Decode and verify the credential format
      const base64Part = (authHeader as string).split('Authorization: Basic ')[1];
      const decoded = Buffer.from(base64Part, 'base64').toString('utf8');
      expect(decoded).toBe('x-access-token:test-token-12345');
    });
  });
});
