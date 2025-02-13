import { context } from '@/context';
import type { TerraformChangedModule, TerraformModule } from '@/types';

/**
 * Creates a changelog entry for a Terraform module.
 *
 * The changelog contains a heading and a list of commits formatted with a timestamp.
 *
 * @param {string} heading - The version or tag heading for the changelog entry.
 * @param {Array<string>} commits - An array of commit messages to include in the changelog.
 * @returns {string} A formatted changelog entry as a string.
 */
function createModuleChangelogEntry(heading: string, commits: string[]): string {
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
    .map((commitMessage) => commitMessage.trim().replace(/(\n)/g, '<br>'));

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
 * @param {TerraformChangedModule[]} terraformChangedModules - An array of changed Terraform modules.
 * @returns {string} The content of the global pull request changelog.
 */
export function getPullRequestChangelog(terraformChangedModules: TerraformChangedModule[]): string {
  const pullRequestChangelog: string[] = [];
  const { prNumber, prTitle } = context;

  for (const { nextTag, commitMessages } of terraformChangedModules) {
    pullRequestChangelog.push(createModuleChangelogEntry(nextTag, commitMessages));
  }

  return pullRequestChangelog.join('\n\n');
}

/**
 * Retrieves the changelog for a specific Terraform module.
 *
 * @param {ChangedTerraformModule} changedTerraformModule - The Terraform module whose changelog is to be retrieved.
 * @returns {string} The content of the module's changelog.
 */
export function getModuleChangelog(terraformChangedModule: TerraformChangedModule): string {
  const { prNumber, prTitle, repoUrl } = context;
  const { nextTagVersion, commitMessages } = terraformChangedModule;

  return createModuleChangelogEntry(nextTagVersion, commitMessages);
}

/**
 * Generates a changelog for a given Terraform module by concatenating the body
 * content of each release associated with the module.
 *
 * @param {TerraformModule} terraformModule - The Terraform module for which to generate the changelog.
 * @returns {string} A string containing the concatenated body content of all releases.
 */
export function getModuleReleaseChangelog(terraformModule: TerraformModule): string {
  // Enumerate over the releases of the given Terraform module
  return terraformModule.releases.map((release) => `${release.body}`).join('\n\n');
}
