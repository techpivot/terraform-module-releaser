import { execSync } from 'node:child_process';
import type { ExecSyncOptions } from 'node:child_process';
import fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { endGroup, info, startGroup } from '@actions/core';
import { context } from '@actions/github';
import pLimit from 'p-limit';
import { getModuleReleaseChangelog } from './changelog';
import { config } from './config';
import { GITHUB_ACTIONS_BOT_EMAIL, GITHUB_ACTIONS_BOT_NAME } from './github';
import { generateTerraformDocs } from './terraform-docs';
import type { TerraformModule } from './terraform-module';

export enum WikiStatus {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
  DISABLED = 'DISABLED',
}

// Special subdirectory inside the primary repository where the wiki is checked out.
const WIKI_SUBDIRECTORY = '.wiki';

const WIKI_DIRECTORY = path.resolve(config.workspaceDir, WIKI_SUBDIRECTORY);

// Directory where the wiki generated Terraform modules will reside. Since GitHub doesn't use
// folder/namespacing this folder will be transparent but will be helpful to keep generated
// content separated from some special top level files (e.g. _Sidebar.md).
const WIKI_GENERATED_DIRECTORY = path.resolve(WIKI_DIRECTORY, 'generated');

const execWikiOpts: ExecSyncOptions = { cwd: WIKI_DIRECTORY, stdio: 'inherit' };

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
export const checkoutWiki = (): void => {
  const wikiHtmlUrl = `${config.repoUrl}.wiki`;

  startGroup(`Checking out wiki repository [${wikiHtmlUrl}]`);

  info('Adding repository directory to the temporary git global config as a safe directory');
  execSync(`git config --global --add safe.directory ${WIKI_DIRECTORY}`, { stdio: 'inherit' });

  info('Initializing the repository');
  if (!fs.existsSync(WIKI_SUBDIRECTORY)) {
    fs.mkdirSync(WIKI_SUBDIRECTORY);
  }
  execSync(`git init --initial-branch=master ${WIKI_DIRECTORY}`, execWikiOpts);

  info('Setting up origin');
  execSync(`git remote add origin ${wikiHtmlUrl}`, execWikiOpts);

  info('Configuring authentication');
  // Configure Git to use the PAT for the wiki repository (emulating the behavior of GitHub Actions
  // from the checkout@v4 action.
  const basicCredential = Buffer.from(`x-access-token:${config.githubToken}`, 'utf8').toString('base64');
  try {
    execSync(`git config --local --unset-all 'http.https://github.com/.extraheader'`, execWikiOpts);
  } catch (error) {
    // This returns exit code 5 if not set. Not a problem. Let's ignore./
  }
  execSync(
    `git config --local http.https://github.com/.extraheader "Authorization: Basic ${basicCredential}"`,
    execWikiOpts,
  );

  try {
    info('Fetching the repository');

    execSync(
      [
        'git',
        '-c protocol.version=2',
        'fetch --no-tags --prune --no-recurse-submodules --depth=1 origin',
        '+refs/heads/master*:refs/remotes/origin/master*',
        '+refs/tags/master*:refs/tags/master*',
      ].join(' '),
      execWikiOpts,
    );
    execSync('git checkout master', execWikiOpts);

    info('Successfully checked out wiki repository');

    // Since we 100% regenerate 100% of the modules, we can simply remove the generated folder if it exists
    // as this helps us 100% ensure we don't have any stale content.
    if (fs.existsSync(WIKI_GENERATED_DIRECTORY)) {
      fs.rmSync(WIKI_GENERATED_DIRECTORY, { recursive: true });
      info(`Removed existing wiki generated directory [${WIKI_GENERATED_DIRECTORY}]`);
    }
  } finally {
    endGroup();
  }
};

/**
 * Generates the markdown content for a Terraform module's wiki file.
 *
 * This function creates a markdown file that includes usage instructions, generated Terraform documentation,
 * and the changelog for the module. The generated usage section provides a sample HCL configuration for referencing
 * the module. The Terraform documentation is auto-generated and included between special tags.
 *
 * @param {TerraformModule} terraformModule - An object containing details of the Terraform module, including:
 *   - `moduleName`: The name of the Terraform module.
 *   - `currentTag`: The current version tag of the module.
 * @param {string} changelog - The changelog content for the module, detailing recent changes.
 * @returns {Promise<string>} A promise that resolves with the generated markdown content for the wiki file.
 * @throws {Error} Throws an error if the Terraform documentation generation fails.
 */
const getWikiFileMarkdown = async ($terraformModule: TerraformModule, $changelog: string): Promise<string> => {
  const { moduleName, latestTag } = $terraformModule;

  return [
    '# Usage\n',
    'To use this module in your Terraform, refer to the below module example:\n',
    '```hcl',
    `module "${moduleName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}" {`,
    `  source = "git::${config.repoUrl}.git?ref=${latestTag}"`,
    '\n  # See inputs below for additional required parameters',
    '}',
    '```',
    '\n# Attributes\n',
    '<!-- BEGIN_TF_DOCS -->',
    await generateTerraformDocs($terraformModule),
    '<!-- END_TF_DOCS -->',
    '\n# Changelog\n',
    $changelog,
  ].join('\n');
};

/**
 * Writes the provided content to the appropriate wiki file for the specified Terraform module.
 * Ensures that the directory structure is created if it doesn't exist and handles overwriting
 * the existing wiki file.
 *
 * @param {string} moduleName - The name of the Terraform module.
 * @param {string} content - The markdown content to write to the wiki file.
 * @returns {Promise<string>} The path to the wiki file that was written.
 * @throws Will throw an error if the file cannot be written.
 */
const writeFileToWiki = async (moduleName: string, content: string): Promise<string> => {
  try {
    // Define the path for the module's wiki file
    const wikiFile = path.join(WIKI_GENERATED_DIRECTORY, `${moduleName}.md`);
    const wikiFilePath = path.dirname(wikiFile);

    // Ensure the wiki subdirectory exists, create if it doesn't
    // Note that the wiki file can be nested in directories and therefore we need to account for this.
    await fsp.mkdir(wikiFilePath, { recursive: true });

    // Write the markdown content to the wiki file, overwriting if it exists
    await fsp.writeFile(wikiFile, content, 'utf8');

    info(`Successfully wrote wiki file for module: ${moduleName}`);

    return wikiFile;
  } catch (error) {
    console.error(`Error writing wiki file for module: ${moduleName}`, error);
    throw error;
  }
};

const updateWikiSidebar = async (terraformModules: TerraformModule[]): Promise<void> => {
  const { owner, repo } = context.repo;
  const sideBarFile = path.join(WIKI_DIRECTORY, '_Sidebar.md');
  const repoBaseUrl = `/${owner}/${repo}`;
  let moduleSidebarContent = '';

  for (const module of terraformModules) {
    const { moduleName } = module;
    // The wiki file slug needs to match GitHub syntax. It doesn't take into account folder/namespace. If it
    // did much of this sidebar behavior would be potentially unnecessary.
    const gitHubSlug = path.basename(moduleName).replace(/\.[^/.]+$/, '');
    const baselink = `${repoBaseUrl}/wiki/${gitHubSlug}`;

    // Generate module changelog string by limiting to wikiSidebarChangelogMax
    const changelogContent = getModuleReleaseChangelog(module);

    // Regex to capture all headings starting with '## ' on a single line
    const headingRegex = /^(?:#{2,3})\s+(.+)$/gm; // Matches '##' or '###' headings

    // Initialize changelog entries
    const changelogEntries = [];
    let headingMatch = null;
    do {
      // If a match is found, process it
      if (headingMatch) {
        const heading = headingMatch[1].trim();

        // Convert heading into a valid ID string (keep only [a-zA-Z0-9-_]) But we need spaces to go to a '-'
        const idString = heading.replace(/[ ]+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');

        // Append the entry to changelogEntries
        changelogEntries.push(`<li><a href="${baselink}#${idString}">${heading.replace(/[`]/g, '')}</a></li>`);
      }

      // Execute the regex again for the next match
      headingMatch = headingRegex.exec(changelogContent);
    } while (headingMatch);

    // Limit to the maximum number of changelog entries defined in config
    let limitedChangelogEntries = changelogEntries.slice(0, config.wikiSidebarChangelogMax).join('');

    // Wrap changelog in <ul> if it's not empty
    if (limitedChangelogEntries.length > 0) {
      limitedChangelogEntries = `<ul>${limitedChangelogEntries}</ul>`;
    }

    moduleSidebarContent += [
      '<li>',
      '<details>',
      `<summary><a href="${baselink}"><b>${moduleName}</b></a></summary>`,
      '<ul>',
      `<li><a href="${baselink}#usage">Usage</a></li>`,
      `<li><a href="${baselink}#attributes">Attributes</a></li>`,
      `<li><a href="${baselink}#changelog">Changelog</a>`,
      limitedChangelogEntries,
      '</li>',
      '</ul>',
      '</details>',
      '</li>',
    ].join('\n');
  }

  const content = `[Home](${repoBaseUrl}/wiki/Home)\n\n## Terraform Modules\n\n<ul>${moduleSidebarContent}</ul>`;

  await fsp.writeFile(sideBarFile, content, 'utf8');
};

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
export const updateWiki = async (terraformModules: TerraformModule[]): Promise<string[]> => {
  startGroup('Generating wiki documentation');

  const parallelism = os.cpus().length + 2;

  info(`Using parallelism: ${parallelism}`);

  const limit = pLimit(parallelism);
  const updatedFiles: string[] = [];
  const tasks = terraformModules.map((module) => {
    return limit(async () => {
      const { moduleName } = module;
      const changelog = getModuleReleaseChangelog(module);
      const wikiFileContent = await getWikiFileMarkdown(module, changelog);

      await writeFileToWiki(moduleName, wikiFileContent);
      updatedFiles.push(path.join(WIKI_GENERATED_DIRECTORY, `${moduleName}.md`));
    });
  });
  await Promise.all(tasks);

  info('Wiki files generated:');
  console.log(updatedFiles);
  endGroup();

  // Generate sidebar
  await updateWikiSidebar(terraformModules);

  startGroup('Committing and pushing changes to wiki');

  try {
    const { prBody, prNumber, prTitle } = config;
    const commitMessage = `PR #${prNumber} - ${prTitle}\n\n${prBody}`.trim();

    // Check if there are any changes (otherwise add/commit/push will error)
    info('Checking for changes in wiki repository');
    const status = execSync('git status --porcelain', { cwd: WIKI_DIRECTORY }); // ensure stdio is not set to inherit
    info(`git status output: ${status.toString().trim()}`);

    if (status !== null && status.toString().trim() !== '') {
      // There are changes, commit and push
      execSync(`git config --local user.name "${GITHUB_ACTIONS_BOT_NAME}"`, execWikiOpts);
      execSync(`git config --local user.email "${GITHUB_ACTIONS_BOT_EMAIL}"`, execWikiOpts);
      execSync('git add .', execWikiOpts);
      execSync(`git commit -m "${commitMessage.trim()}"`, execWikiOpts);
      execSync('git push --set-upstream origin master', execWikiOpts);
      info('Changes committed and pushed to wiki repository');
    } else {
      info('No changes detected, skipping commit and push');
    }
  } finally {
    endGroup();
  }

  return updatedFiles;
};
