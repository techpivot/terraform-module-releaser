import { execFileSync } from 'node:child_process';
import type { ExecSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { getModuleReleaseChangelog } from '@/changelog';
import { config } from '@/config';
import { context } from '@/context';
import { generateTerraformDocs } from '@/terraform-docs';
import type { ExecSyncError, TerraformModule } from '@/types';
import {
  BRANDING_WIKI,
  GITHUB_ACTIONS_BOT_EMAIL,
  GITHUB_ACTIONS_BOT_NAME,
  PROJECT_URL,
  WIKI_TITLE_REPLACEMENTS,
} from '@/utils/constants';
import { removeDirectoryContents } from '@/utils/file';
import { endGroup, info, startGroup } from '@actions/core';
import pLimit from 'p-limit';
import which from 'which';

export enum WikiStatus {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
  DISABLED = 'DISABLED',
}

// Special subdirectory inside the primary repository where the wiki is checked out.
const WIKI_SUBDIRECTORY_NAME = '.wiki';

/**
 * Clones the wiki repository for the current GitHub repository into a specified subdirectory.
 *
 * This function constructs the wiki Git URL using the current repository context and executes
 * a `git clone` command with a depth of 1 to fetch only the latest commit. The subdirectory
 * for the wiki is created if it doesn't already exist. If the wiki does not exist or is not enabled,
 * an error will be caught and logged.
 *
 * Note: It's important we clone via SSH and not HTTPS. Will likely need to test cloning this for
 * self-hosted GitHub enterprise on custom domain as this hasn't been done.
 *
 * @throws {Error} If the `git clone` command fails due to issues such as the wiki not existing.
 */
export function checkoutWiki(): void {
  const wikiHtmlUrl = `${context.repoUrl}.wiki`;
  const wikiDirectory = resolve(context.workspaceDir, WIKI_SUBDIRECTORY_NAME);
  const execWikiOpts: ExecSyncOptions = { cwd: wikiDirectory, stdio: 'inherit' };

  startGroup(`Checking out wiki repository [${wikiHtmlUrl}]`);

  const gitPath = which.sync('git');

  info('Adding repository directory to the temporary git global config as a safe directory');
  execFileSync(gitPath, ['config', '--global', '--add', 'safe.directory', wikiDirectory], { stdio: 'inherit' });

  // Create directory if it doesn't exist
  if (!existsSync(wikiDirectory)) {
    mkdirSync(wikiDirectory);
  }

  // Initialize repository if needed
  const isExistingRepo = existsSync(join(wikiDirectory, '.git'));
  if (!isExistingRepo) {
    info('Initializing new repository');
    execFileSync(gitPath, ['init', '--initial-branch=master', wikiDirectory], execWikiOpts);
  }

  // Set or update the remote URL
  info('Configuring remote URL');
  try {
    execFileSync(gitPath, ['remote', 'set-url', 'origin', wikiHtmlUrl], execWikiOpts);
  } catch {
    execFileSync(gitPath, ['remote', 'add', 'origin', wikiHtmlUrl], execWikiOpts);
  }

  info('Configuring authentication');
  const basicCredential = Buffer.from(`x-access-token:${config.githubToken}`, 'utf8').toString('base64');
  try {
    execFileSync(gitPath, ['config', '--local', '--unset-all', 'http.https://github.com/.extraheader'], execWikiOpts);
  } catch (error) {
    // Type guard to ensure we're handling the correct error type
    // Only ignore specific status code if needed
    if (error instanceof Error && (error as unknown as ExecSyncError).status !== 5) {
      throw error;
    }
  }

  execFileSync(
    gitPath,
    ['config', '--local', 'http.https://github.com/.extraheader', `Authorization: Basic ${basicCredential}`],
    execWikiOpts,
  );

  try {
    info('Fetching the repository');
    execFileSync(
      gitPath,
      [
        'fetch',
        '--no-tags',
        '--prune',
        '--no-recurse-submodules',
        '--depth=1',
        'origin',
        '+refs/heads/master*:refs/remotes/origin/master*',
        '+refs/tags/master*:refs/tags/master*',
      ],
      execWikiOpts,
    );

    execFileSync(gitPath, ['checkout', 'master'], execWikiOpts);

    info('Successfully checked out wiki repository');
  } finally {
    endGroup();
  }
}

/**
 * Generates a sanitized slug for a GitHub Wiki title by replacing specific characters in the
 * provided module name with visually similar substitutes to avoid path conflicts and improve display.
 * This function dynamically creates a regular expression from the keys in the `WIKI_TITLE_REPLACEMENTS`
 * map, ensuring any added replacements in the map will be automatically accounted for in future
 * conversions.
 *
 * **Important**: Refer to `WIKI_TITLE_REPLACEMENTS` in `constants.ts` to add or update replacement mappings.
 *
 * @param {string} moduleName - The original module name to be transformed into a GitHub Wiki-compatible slug.
 * @returns {string} - The modified module name, with specified characters replaced by corresponding entries
 * in the `WIKI_TITLE_REPLACEMENTS` map.
 *
 * @example
 * // Example usage:
 * // Assuming WIKI_TITLE_REPLACEMENTS = { '/': '∕', '-': '‒' }
 * const moduleName = 'my-module/name';
 * const wikiSlug = getWikiSlug(moduleName);
 * // Returns: "my‒module∕name"
 *
 * @remarks
 * This function avoids manual regex maintenance by dynamically building a character class from the keys in
 * `WIKI_TITLE_REPLACEMENTS`. To handle special characters in these keys, the `escapeForRegex` helper function
 * escapes regex metacharacters as needed.
 *
 * The `escapeForRegex` helper:
 * - Escapes metacharacters (e.g., `*`, `.`, `+`, `?`, `^`, `$`, `{`, `}`, `(`, `)`, `|`, `[`, `]`, `\`)
 *   to ensure they are interpreted literally within the regular expression.
 *
 * Dynamic regex creation:
 * - `Object.keys(WIKI_TITLE_REPLACEMENTS).map(escapeForRegex).join('')` generates an escaped sequence
 *   of characters for replacement and constructs a character class for the `pattern` regex.
 *
 * Replacement logic:
 * - `moduleName.replace(pattern, match => WIKI_TITLE_REPLACEMENTS[match])` matches each specified character
 *   in `moduleName` and replaces it with the mapped character from `WIKI_TITLE_REPLACEMENTS`.
 */
function getWikiSlug(moduleName: string): string {
  const escapeForRegex = (char: string): string => {
    return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape special characters for regex
  };

  const pattern = new RegExp(`[${Object.keys(WIKI_TITLE_REPLACEMENTS).map(escapeForRegex).join('')}]`, 'g');

  return moduleName.replace(pattern, (match) => WIKI_TITLE_REPLACEMENTS[match]);
}

/**
 * Generates a URL to the wiki page for a given Terraform module.
 *
 * @param {string} moduleName - The name of the Terraform module. The function extracts the base name and
 *   removes the file extension (if any) to form the slug.
 * @param {boolean} [relative=true] - A flag indicating whether to return a relative URL
 *   (default) or an absolute URL.
 *   - If `true`, returns a relative URL based on the repository owner and name.
 *   - If `false`, uses the full repository URL from `context.repoUrl`.
 * @returns {string} - The full wiki link for the module based on the provided module name and URL
 *   type (relative or absolute).
 *
 * @example
 * // Returns a relative URL for a module
 * getWikiLink('terraform-aws-vpc'); // "/owner/repo/wiki/terraform-aws-vpc"
 *
 * @example
 * // Returns an absolute URL for a module
 * getWikiLink('aws/terraform-aws-vpc', false); // "https://github.com/owner/repo/wiki/terraform-aws-vpc"
 */
export function getWikiLink(moduleName: string, relative = true): string {
  let baseUrl: string;
  if (relative) {
    baseUrl = `/${context.repo.owner}/${context.repo.repo}`;
  } else {
    baseUrl = context.repoUrl;
  }

  return `${baseUrl}/wiki/${getWikiSlug(moduleName)}`;
}

/**
 * Formats the module source URL based on configuration settings.
 *
 * @param repoUrl - The repository URL
 * @param useSSH - Whether to use SSH format
 * @returns The formatted source URL for the module
 */
function formatModuleSource(repoUrl: string, useSSH: boolean): string {
  if (useSSH) {
    // Convert HTTPS URL to SSH format
    // From: https://github.com/owner/repo
    // To:   ssh://git@github.com/owner/repo
    return `ssh://${repoUrl.replace(/^https:\/\/github\.com/, 'git@github.com')}.git`;
  }
  return `${repoUrl}.git`;
}

/**
 * Generates the wiki file associated with the specified Terraform module.
 * Ensures that the directory structure is created if it doesn't exist and handles overwriting
 * the existing wiki file.
 *
 * @param {string} moduleName - The name of the Terraform module.
 * @param {string} content - The markdown content to write to the wiki file.
 * @returns {Promise<string>} The path to the wiki file that was written.
 * @throws Will throw an error if the file cannot be written.
 */
async function generateWikiModule(terraformModule: TerraformModule): Promise<string> {
  const { moduleName, latestTag } = terraformModule;

  const wikiSlugFile = `${getWikiSlug(moduleName)}.md`;
  const wikiFile = join(context.workspaceDir, WIKI_SUBDIRECTORY_NAME, wikiSlugFile);

  // Generate a module changelog
  const changelog = getModuleReleaseChangelog(terraformModule);
  const tfDocs = await generateTerraformDocs(terraformModule);
  const moduleSource = formatModuleSource(context.repoUrl, config.useSSHSourceFormat);
  const wikiContent = [
    '# Usage\n',
    'To use this module in your Terraform, refer to the below module example:\n',
    '```hcl',
    `module "${moduleName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}" {`,
    `  source = "git::${moduleSource}?ref=${latestTag}"`,
    '\n  # See inputs below for additional required parameters',
    '}',
    '```',
    '\n# Attributes\n',
    '<!-- BEGIN_TF_DOCS -->',
    tfDocs,
    '<!-- END_TF_DOCS -->',
    '\n# Changelog\n',
    changelog,
  ].join('\n');

  // Write the markdown content to the wiki file, overwriting if it exists
  await fsp.writeFile(wikiFile, wikiContent, 'utf8');

  info(`Generated: ${wikiSlugFile}`);

  return wikiFile;
}

/**
 * Generates the Wiki sidebar with a list of Terraform modules, including changelog entries for each.
 *
 * This function generates a dynamic sidebar for the GitHub Wiki by iterating over the provided
 * Terraform modules, extracting their changelog content, and formatting it into a nested list
 * with relevant links to sections within each module's Wiki page (e.g., "Usage", "Attributes",
 * and "Changelog"). The generated content is then written to the `_Sidebar.md` file.
 *
 * @param {TerraformModule[]} terraformModules - An array of Terraform modules for which the Wiki
 *   sidebar will be updated. Each module contains the `moduleName`, and its changelog is fetched
 *   to generate sidebar entries.
 * @returns {Promise<string>} - A promise that resolves with the path of the sidebar file once it has been
 *   successfully updated and written.
 *
 * Function Details:
 * - Uses the `context.repo` object to get the repository owner and name for building links.
 * - The sidebar file is located in the `WIKI_DIRECTORY` and is named `_Sidebar.md`.
 * - For each module, it uses `getWikiLink()` to create the base link and `getModuleReleaseChangelog()`
 *   to extract relevant changelog headings (matching `##` or `###`).
 * - Headings are converted into valid HTML IDs and displayed as linked list items (`<li>`),
 *   limiting the number of changelog entries based on the configuration
 *   (`config.wikiSidebarChangelogMax`).
 * - Writes the final content, including links to Home and the module Wiki pages, to the sidebar file.
 *
 * Example Sidebar Entry:
 * ```
 * <li>
 *   <details>
 *     <summary><a href="/techpivot/terraform-modules-demo/wiki/random"><b>null/random</b></a></summary>
 *     <ul>
 *       <li><a href="/techpivot/terraform-modules-demo/wiki/random#usage">Usage</a></li>
 *       <li><a href="/techpivot/terraform-modules-demo/wiki/random#attributes">Attributes</a></li>
 *       <li><a href="/techpivot/terraform-modules-demo/wiki/random#changelog">Changelog</a>
 *         <ul>
 *            <li><a href="/techpivot/terraform-modules-demo/wiki/random#v120-2024-10-15">v1.2.0 (2024-10-15)</a></li>
 *            <li><a href="/techpivot/terraform-modules-demo/wiki/random#v110-2024-10-11">v1.1.0 (2024-10-11)</a></li>
 *            <li><a href="/techpivot/terraform-modules-demo/wiki/random#v100-2024-10-10">v1.0.0 (2024-10-10)</a></li>
 *         </ul>
 *       </li>
 *     </ul>
 *   </details>
 * </li>
 * ```
 */
async function generateWikiSidebar(terraformModules: TerraformModule[]): Promise<string> {
  const sidebarFile = join(context.workspaceDir, WIKI_SUBDIRECTORY_NAME, '_Sidebar.md');
  const { owner, repo } = context.repo;
  const repoBaseUrl = `/${owner}/${repo}`;
  let moduleSidebarContent = '';

  for (const module of terraformModules) {
    const { moduleName } = module;

    // Get the baselink which is used throughout the sidebar
    const baselink = getWikiLink(moduleName, true);

    // Generate module changelog string by limiting to wikiSidebarChangelogMax
    const changelogContent = getModuleReleaseChangelog(module);

    // Regex to capture all headings starting with '## ' on a single line
    // Note: Use ([^\n]+) Instead of (.+):
    // The pattern [^\n]+ matches one or more characters that are not a newline. This restricts matches
    // to a single line and reduces backtracking possibilities since it won't consume any newlines.
    const headingRegex = /^(?:#{2,3})\s+([^\n]+)/gm; // Matches '##' or '###' headings

    // Initialize changelog entries
    const changelogEntries = [];
    let headingMatch = null;
    do {
      // If a match is found, process it
      if (headingMatch) {
        const heading = headingMatch[1].trim();

        // Convert heading into a valid ID string (keep only [a-zA-Z0-9-_]) But we need spaces to go to a '-'
        const idString = heading.replace(/ +/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');

        // Append the entry to changelogEntries
        changelogEntries.push(
          `            <li><a href="${baselink}#${idString}">${heading.replace(/`/g, '')}</a></li>`,
        );
      }

      // Execute the regex again for the next match
      headingMatch = headingRegex.exec(changelogContent);
    } while (headingMatch);

    // Limit to the maximum number of changelog entries defined in config
    const limitedChangelogEntries = changelogEntries.slice(0, config.wikiSidebarChangelogMax).join('\n');

    // Wrap changelog in <ul> if it's not empty
    let changelog = '</li>';
    if (limitedChangelogEntries.length > 0) {
      changelog = `\n          <ul>\n${limitedChangelogEntries}\n          </ul>\n        </li>`;
    }

    moduleSidebarContent += [
      '\n  <li>',
      '    <details>',
      `      <summary><a href="${baselink}"><b>${moduleName}</b></a></summary>`,
      '      <ul>',
      `        <li><a href="${baselink}#usage">Usage</a></li>`,
      `        <li><a href="${baselink}#attributes">Attributes</a></li>`,
      `        <li><a href="${baselink}#changelog">Changelog</a>${changelog}`,
      '      </ul>',
      '    </details>',
      '  </li>',
    ].join('\n');
  }

  const content = `[Home](${repoBaseUrl}/wiki/Home)\n\n## Terraform Modules\n\n<ul>${moduleSidebarContent}\n</ul>`;

  await fsp.writeFile(sidebarFile, content, 'utf8');

  info('Generated: _Sidebar.md');

  return sidebarFile;
}

/**
 * Generates the `_Footer.md` file in the wiki directory to maintain consistent branding content.
 *
 * This function checks whether branding is enabled:
 * - If branding is disabled, the function exits early without making any changes.
 * - If branding is enabled, it creates or updates the `_Footer.md` file with the specified branding content.
 *
 * @returns {Promise<string | undefined>} A promise that resolves to the footer file path if updated, or undefined if no update is necessary.
 * @throws {Error} Logs an error if the file creation or update fails.
 */
async function generateWikiFooter(): Promise<string | undefined> {
  if (config.disableBranding) {
    info('Skipping footer generation as branding is disabled');
    return;
  }

  const footerFile = join(context.workspaceDir, WIKI_SUBDIRECTORY_NAME, '_Footer.md');
  await fsp.writeFile(footerFile, BRANDING_WIKI, 'utf8');
  info('Generated: _Footer.md');
  return footerFile;
}

/**
 * Generates the Home.md file for the Terraform Modules Wiki.
 *
 * This function creates a Markdown file that serves as an index for all available Terraform modules,
 * providing an overview of their functionality and the latest versions. It includes sections for current
 * modules, usage instructions, and contribution guidelines.
 *
 * @param {TerraformModule[]} terraformModules - An array of TerraformModule objects containing the
 *                                                names and latest version tags of the modules.
 * @returns {Promise<string>} A promise that resolves to the path of the generated Home.md file.
 * @throws {Error} Throws an error if the file writing operation fails.
 */
async function generateWikiHome(terraformModules: TerraformModule[]): Promise<string> {
  const homeFile = join(context.workspaceDir, WIKI_SUBDIRECTORY_NAME, 'Home.md');

  const content = [
    '# Terraform Modules Home',
    '\nWelcome to the Terraform Modules Wiki! This page serves as an index for all the available Terraform modules,',
    'providing an overview of their functionality and the latest versions.',
    '\n## Current Terraform Modules',
    '\n| Module Name | Latest Version |',
    '| -- | -- |',
    terraformModules
      .map(
        ({ moduleName, latestTagVersion }) =>
          `| [${moduleName}](${getWikiLink(moduleName, true)}) | ${latestTagVersion} |`,
      )
      .join('\n'),
    '\n## How to Use',
    '\nEach module listed above can be imported into your Terraform configurations. For detailed instructions on',
    'usage and examples, refer to the documentation links provided in the table.',
    '\n## Contributing',
    'If you would like to contribute to these modules or report issues, please visit the ',
    `[GitHub Repository](${context.repoUrl}) for more information.`,
    '\n---',
    `\n*This wiki is automatically generated as part of the [Terraform Module Releaser](${PROJECT_URL}) project.`,
    'For the latest updates, please refer to the individual module documentation links above.*',
  ].join('\n');

  await fsp.writeFile(homeFile, content, 'utf8');
  info('Generated: Home.md');

  return homeFile;
}

/**
 * Updates the wiki documentation for a list of Terraform modules.
 *
 * This function generates markdown content for each Terraform module by calling
 * `getWikiFileMarkdown` and appending its associated changelog, then writes the
 * content to the wiki. It commits and pushes the changes to the wiki repository.
 *
 * The function limits the number of concurrent wiki updates by using `pLimit`.
 * Once all wiki files are updated, it commits and pushes the changes to the repository.
 *
 * @param {TerraformModule[]} terraformModules - A list of Terraform modules to update in the wiki.
 *
 * @returns {Promise<string[]>} A promise that resolves to a list of file paths of the updated wiki files.
 */
export async function generateWikiFiles(terraformModules: TerraformModule[]): Promise<string[]> {
  startGroup('Generating wiki ...');

  // Clears the contents of the Wiki directory to ensure no stale content remains,
  // as the Wiki is fully regenerated during each run.
  //
  // This process:
  // - Logs the cleanup action for tracking purposes.
  // - Removes all files and directories within `WIKI_DIRECTORY` except `.git`,
  //   which is preserved to maintain version control and Git history.
  //
  // This approach supports:
  // - Ensuring the Wiki remains up-to-date without leftover or outdated files.
  // - Avoiding conflicts or unexpected results due to stale data.
  info('Removing existing wiki files...');
  removeDirectoryContents(join(context.workspaceDir, WIKI_SUBDIRECTORY_NAME), ['.git']);

  const parallelism = cpus().length + 2;

  info(`Using parallelism: ${parallelism}`);

  const limit = pLimit(parallelism);
  const updatedFiles: string[] = [];
  const tasks = terraformModules.map((module) => {
    return limit(async () => {
      updatedFiles.push(await generateWikiModule(module));
    });
  });
  await Promise.all(tasks);

  updatedFiles.push(await generateWikiHome(terraformModules));
  updatedFiles.push(await generateWikiSidebar(terraformModules));
  const footerFile = await generateWikiFooter();
  if (footerFile) {
    updatedFiles.push(footerFile);
  }

  info('Wiki files generated:');
  console.log(updatedFiles);
  endGroup();

  return updatedFiles;
}

/**
 * Commits and pushes changes to the wiki repository.
 *
 * This function checks for any changes in the wiki directory, and if there are changes,
 * it commits and pushes them using the provided commit message.
 *
 * @returns {void}
 */
export function commitAndPushWikiChanges(): void {
  startGroup('Committing and pushing changes to wiki');

  try {
    const { prBody, prNumber, prTitle } = context;
    const commitMessage = `PR #${prNumber} - ${prTitle}\n\n${prBody}`.trim();
    const wikiDirectory = resolve(context.workspaceDir, WIKI_SUBDIRECTORY_NAME);
    const execWikiOpts: ExecSyncOptions = { cwd: wikiDirectory, stdio: 'inherit' };
    const gitPath = which.sync('git');

    // Check if there are any changes (otherwise add/commit/push will error)
    info('Checking for changes in wiki repository');
    const status = execFileSync(gitPath, ['status', '--porcelain'], { cwd: wikiDirectory });
    info(`git status output: ${status.toString().trim()}`);

    if (status !== null && status.toString().trim() !== '') {
      // There are changes, commit and push
      for (const cmd of [
        ['config', '--local', 'user.name', GITHUB_ACTIONS_BOT_NAME],
        ['config', '--local', 'user.email', GITHUB_ACTIONS_BOT_EMAIL],
        ['add', '.'],
        ['commit', '-m', commitMessage.trim()],
        ['push', 'origin'],
      ]) {
        execFileSync(gitPath, cmd, execWikiOpts);
      }

      info('Changes committed and pushed to wiki repository');
    } else {
      info('No changes detected, skipping commit and push');
    }
  } finally {
    endGroup();
  }
}
