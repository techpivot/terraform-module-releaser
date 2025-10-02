import { execFileSync } from 'node:child_process';
import { context } from '@/context';
import { info } from '@actions/core';
import which from 'which';

/**
 * Resolves a git tag to its commit SHA.
 *
 * This function uses `git rev-parse` to resolve a tag name to the commit SHA it points to.
 * This is useful for generating immutable references to module versions, as commit SHAs
 * cannot be deleted from GitHub as easily as tags.
 *
 * @param {string} tag - The tag name to resolve (e.g., 'aws/vpc-endpoint/v1.1.3')
 * @returns {string} The full commit SHA (40 characters) that the tag points to
 * @throws {Error} If the tag does not exist or git command fails
 *
 * @example
 * ```typescript
 * const sha = resolveTagToCommitSHA('aws/vpc-endpoint/v1.1.3');
 * // Returns: 'ee4e1294eb806447b36eaa5e000947449eab4fc4'
 * ```
 */
export function resolveTagToCommitSHA(tag: string): string {
  const gitPath = which.sync('git');
  const cwd = context.workspaceDir;

  try {
    // Use git rev-parse to resolve the tag to a commit SHA
    // The ^{} suffix dereferences the tag to get the actual commit object
    const sha = execFileSync(gitPath, ['rev-parse', `${tag}^{}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    info(`Resolved tag '${tag}' to commit SHA: ${sha}`);
    return sha;
  } catch (error) {
    // If the tag doesn't exist or there's an error, throw with a descriptive message
    throw new Error(
      `Failed to resolve tag '${tag}' to commit SHA: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
