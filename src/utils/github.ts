import { execFileSync } from 'node:child_process';
import type { ExecFileSyncOptions } from 'node:child_process';
import { config } from '@/config';
import { context } from '@/context';
import type { ExecSyncError } from '@/types';
import { GITHUB_ACTIONS_BOT_USERNAME } from '@/utils/constants';

/**
 * Retrieves the GitHub Actions bot email address dynamically by querying the GitHub API.
 * This function handles both GitHub.com and GitHub Enterprise Server environments.
 *
 * The email format follows GitHub's standard: {user_id}+{username}@users.noreply.github.com
 *
 * @returns {Promise<string>} The GitHub Actions bot email address
 * @throws {Error} If the API request fails or the user information cannot be retrieved
 */
export async function getGitHubActionsBotEmail(): Promise<string> {
  const response = await context.octokit.rest.users.getByUsername({
    username: GITHUB_ACTIONS_BOT_USERNAME,
  });

  return `${response.data.id}+${GITHUB_ACTIONS_BOT_USERNAME}@users.noreply.github.com`;
}

/**
 * Configures Git authentication for HTTPS operations using the GitHub token.
 *
 * This function sets up Git's HTTP extraheader configuration to authenticate
 * HTTPS operations (like push/fetch) using the provided GitHub token. It uses
 * the same authentication mechanism as GitHub Actions' checkout action.
 *
 * The function:
 * 1. Extracts the server domain from the repository URL
 * 2. Unsets any existing authentication headers (ignoring errors if none exist)
 * 3. Sets a new authentication header with the GitHub token as a base64-encoded credential
 *
 * @param {string} gitPath - The path to the git executable
 * @param {ExecFileSyncOptions} execOptions - Options for executing git commands (e.g., cwd, env)
 * @throws {Error} If git configuration fails (except for status 5 when unsetting non-existent config)
 *
 * @example
 * ```typescript
 * const gitPath = await which('git');
 * const execOptions = { cwd: '/path/to/repo' };
 * configureGitAuthentication(gitPath, execOptions);
 * // Now git push/fetch operations will be authenticated
 * ```
 */
export function configureGitAuthentication(gitPath: string, execOptions: ExecFileSyncOptions): void {
  // Extract the domain from the repository URL for the extraheader configuration
  const serverDomain = new URL(context.repoUrl).hostname;
  const extraHeaderKey = `http.https://${serverDomain}/.extraheader`;
  const basicCredential = Buffer.from(`x-access-token:${config.githubToken}`, 'utf8').toString('base64');

  // Unset any existing extraheader configuration
  try {
    execFileSync(gitPath, ['config', '--local', '--unset-all', extraHeaderKey], execOptions);
  } catch (error) {
    // Git exits with status 5 if the config key doesn't exist to be unset.
    // This is not a failure condition, so we ignore it.
    if (error instanceof Error && (error as unknown as ExecSyncError).status !== 5) {
      throw error;
    }
  }

  // Set authentication header
  execFileSync(gitPath, ['config', '--local', extraHeaderKey, `Authorization: Basic ${basicCredential}`], execOptions);
}
