import { context } from '@/context';
import type { TerraformModule } from '@/terraform-module';

/**
 * Creates a changelog entry for a Terraform module.
 *
 * The changelog contains a heading and a list of commits formatted with a timestamp.
 *
 * @param {string} heading - The version or tag heading for the changelog entry.
 * @param {readonly string[]} commits - An array of commit messages to include in the changelog.
 * @returns {string} A formatted changelog entry as a string.
 */
function createTerraformModuleChangelogEntry(heading: string, commits: readonly string[]): string {
  const { prNumber, prTitle, repoUrl } = context;
  const currentDate = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
  const changelogContent: string[] = [`## \`${heading}\` (${currentDate})\n`];

  // Whether to hyperlink the PR number in the changelog entry. GitHub automatically
  // links the PR in the pull request comments but not automatically in the wiki markdown. In the releases section
  // it will automatically link just the #9 portion but not the PR part. If we link the whole section it
  // ends up being much cleaner.
  changelogContent.push(`- :twisted_rightwards_arrows:**[PR #${prNumber}](${repoUrl}/pull/${prNumber})** - ${prTitle}`);

  // Perform some normalization
  const normalizedCommitMessages = commits
    // If the PR title equals the message exactly, we'll skip it
    .filter((msg) => msg.trim() !== prTitle)

    // Trim the commit message and for markdown, newlines that are part of a list format
    // better if they use a <br> tag instead of a newline character.
    .map((commitMessage) => commitMessage.trim().replace(/\n/g, '<br>'));

  for (const normalizedCommit of normalizedCommitMessages) {
    changelogContent.push(`- ${normalizedCommit}`);
  }

  return changelogContent.join('\n');
}

/**
 * Retrieves the global pull request changelog.
 *
 * Aggregates changelog entries from all changed Terraform modules into a single view.
 * This aggregated changelog is used explicitly as a comment in the pull request message,
 * providing a concise summary of all module changes.
 *
 * @param {TerraformModule[]} terraformModules - An array of changed Terraform modules.
 * @returns {string} The content of the global pull request changelog.
 */
export function getPullRequestChangelog(terraformModules: TerraformModule[]): string {
  const pullRequestChangelog: string[] = [];

  for (const terraformModule of terraformModules) {
    if (terraformModule.needsRelease()) {
      // When needsRelease() is true, getReleaseTag() is guaranteed to return a non-null value
      const releaseTag = terraformModule.getReleaseTag() as string;
      pullRequestChangelog.push(createTerraformModuleChangelogEntry(releaseTag, terraformModule.commitMessages));
    }
  }

  return pullRequestChangelog.join('\n\n');
}

/**
 * Creates formatted changelog entries for a specific Terraform module that needs release.
 *
 * @param {TerraformModule} terraformModule - The Terraform module whose changelog is to be retrieved.
 * @returns {string} The content of the module's changelog, or empty string if no release is needed.
 */
export function createTerraformModuleChangelog(terraformModule: TerraformModule): string {
  if (terraformModule.needsRelease()) {
    const releaseTagVersion = terraformModule.getReleaseTagVersion();
    if (releaseTagVersion !== null) {
      return createTerraformModuleChangelogEntry(releaseTagVersion, terraformModule.commitMessages);
    }
  }

  return '';
}

/**
 * Retrieves the complete changelog as a markdown string for the specified Terraform module.
 *
 * This function concatenates the release notes from all releases associated with the module,
 * separated by double newlines to maintain proper markdown formatting. Empty release bodies
 * are filtered out to avoid unnecessary whitespace in the final changelog.
 *
 * @param {TerraformModule} terraformModule - The Terraform module instance containing release data
 * @returns {string} A markdown-formatted string containing all release notes, or an empty string if no releases exist
 *
 * @example
 * ```typescript
 * const changelog = getTerraformModuleFullReleaseChangelog(myModule);
 * console.log(changelog);
 * // Output:
 * // ## Release v1.2.0
 * // - Added new feature
 * //
 * // ## Release v1.1.0
 * // - Bug fixes
 * ```
 */
export function getTerraformModuleFullReleaseChangelog(terraformModule: TerraformModule): string {
  // Filter out releases with empty bodies and concatenate release notes with proper spacing
  return terraformModule.releases
    .map((release) => release.body?.trim())
    .filter((body): body is string => Boolean(body))
    .join('\n\n');
}
