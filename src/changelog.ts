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
      const releaseTag = terraformModule.getReleaseTag();
      if (releaseTag !== null) {
        pullRequestChangelog.push(createTerraformModuleChangelogEntry(releaseTag, terraformModule.commitMessages));
      }
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

/**
 * Generates and writes CHANGELOG.md files for Terraform modules that need a release.
 *
 * This function creates a CHANGELOG.md file in each module's directory containing the complete
 * release history. The changelog includes:
 * - A header with the module name
 * - All release entries in reverse chronological order (newest first)
 * - Properly formatted markdown sections for each release
 *
 * The function only processes modules that need a release and have commit messages.
 * It creates the changelog content by combining the new release entry with historical
 * release notes from the module's previous releases.
 *
 * @param {TerraformModule[]} terraformModules - Array of Terraform modules to process
 * @returns {Promise<string[]>} Array of file paths to the generated CHANGELOG.md files
 *
 * @example
 * ```typescript
 * const changelogFiles = await generateChangelogFiles(terraformModules);
 * console.log(changelogFiles);
 * // Output: ['/path/to/module1/CHANGELOG.md', '/path/to/module2/CHANGELOG.md']
 * ```
 */
export async function generateChangelogFiles(terraformModules: TerraformModule[]): Promise<string[]> {
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { endGroup, info, startGroup } = await import('@actions/core');

  console.time('Elapsed time generating changelog files');
  startGroup('Generating CHANGELOG.md files');

  const changelogFiles: string[] = [];
  const modulesToRelease = terraformModules.filter((module) => module.needsRelease());

  if (modulesToRelease.length === 0) {
    info('No modules need release. Skipping changelog file generation.');
    endGroup();
    console.timeEnd('Elapsed time generating changelog files');
    return changelogFiles;
  }

  for (const terraformModule of modulesToRelease) {
    const changelogPath = join(terraformModule.directory, 'CHANGELOG.md');

    // Get the new release entry
    const newReleaseEntry = createTerraformModuleChangelog(terraformModule);

    if (!newReleaseEntry) {
      continue;
    }

    // Get historical changelog (existing releases)
    const historicalChangelog = getTerraformModuleFullReleaseChangelog(terraformModule);

    // Combine new entry with historical data
    const changelogContent = [
      `# Changelog - ${terraformModule.name}`,
      '',
      'All notable changes to this module will be documented in this file.',
      '',
      newReleaseEntry,
    ];

    // Add historical changelog if it exists
    if (historicalChangelog) {
      changelogContent.push('');
      changelogContent.push(historicalChangelog);
    }

    const fullChangelog = changelogContent.join('\n');

    await writeFile(changelogPath, fullChangelog, 'utf8');
    info(`Generated CHANGELOG.md for module: ${terraformModule.name}`);
    changelogFiles.push(changelogPath);
  }

  info(`Generated ${changelogFiles.length} CHANGELOG.md file${changelogFiles.length !== 1 ? 's' : ''}`);
  endGroup();
  console.timeEnd('Elapsed time generating changelog files');

  return changelogFiles;
}
