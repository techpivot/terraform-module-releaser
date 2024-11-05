import { context } from '@/context';
import type { TerraformChangedModule, TerraformModule } from '@/terraform-module';

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
  const currentDate = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
  const changelogContent: string[] = [`## \`${heading}\` (${currentDate})\n`];

  for (const commit of commits) {
    changelogContent.push(`- ${commit}`);
  }

  return changelogContent.join('\n');
}

/**
 * Retrieves the global pull request changelog.
 *
 * @param {TerraformChangedModule[]} terraformChangedModules - An array of changed Terraform modules.
 * @returns {string} The content of the global pull request changelog.
 */
export function getPullRequestChangelog(terraformChangedModules: TerraformChangedModule[]): string {
  const pullRequestChangelog: string[] = [];
  const { prNumber, prTitle } = context;

  for (const { nextTag, commitMessages } of terraformChangedModules) {
    const cleanedCommitMessages = commitMessages.map((commitMessage) => {
      // Trim the commit message and for markdown, newlines that are part of a list format
      // better if they use a <br> tag instead of a newline character.
      return commitMessage.trim().replace(/(\n)/g, '<br>');
    });

    const commitMessagesWithPR = [
      `PR #${prNumber} - ${prTitle}`,
      ...cleanedCommitMessages.filter((msg) => msg.trim() !== prTitle),
    ];

    pullRequestChangelog.push(createModuleChangelogEntry(nextTag, commitMessagesWithPR));
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

  const cleanedCommitMessages = commitMessages.map((commitMessage) => {
    // Trim the commit message and for markdown, newlines that are part of a list format
    // better if they use a <br> tag instead of a newline character.
    return commitMessage.trim().replace(/(\n)/g, '<br>');
  });

  // Determine whether to hyperlink the PR #XX references in the Changelog since GitHub automatically does this
  // in the Pull Request comment fields but not automatically in the wiki. In the releases, it will automatically
  // find it with a link; however, recommend to hyperlink here.

  const commitMessagesWithPR = [
    `[PR #${prNumber}](${repoUrl}/pull/${prNumber}) - ${prTitle}`,
    ...cleanedCommitMessages.filter((msg) => msg.trim() !== prTitle),
  ];

  return createModuleChangelogEntry(nextTagVersion, commitMessagesWithPR);
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
