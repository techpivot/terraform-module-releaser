import { readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { config } from '@/config';
import { context } from '@/context';
import type { CommitDetails, GitHubRelease, TerraformChangedModule, TerraformModule } from '@/types';
import { isTerraformDirectory, shouldExcludeFile, shouldIgnoreModulePath } from '@/utils/file';
import { determineReleaseType, getNextTagVersion } from '@/utils/semver';
import { removeTrailingDots } from '@/utils/string';
import { debug, endGroup, info, startGroup } from '@actions/core';

/**
 * Type guard function to determine if a given module is a `TerraformChangedModule`.
 *
 * This function checks if the `module` object has the property `isChanged` set to `true`.
 * It can be used to narrow down the type of the module within TypeScript's type system.
 *
 * @param {TerraformModule | TerraformChangedModule} module - The module to check.
 * @returns {module is TerraformChangedModule} - Returns `true` if the module is a `TerraformChangedModule`, otherwise `false`.
 */
export function isChangedModule(module: TerraformModule | TerraformChangedModule): module is TerraformChangedModule {
  return 'isChanged' in module && module.isChanged === true;
}

/**
 * Filters an array of Terraform modules to return only those that are marked as changed.
 *
 * @param modules - An array of TerraformModule or TerraformChangedModule objects.
 * @returns An array of TerraformChangedModule objects that have been marked as changed.
 */
export function getTerraformChangedModules(
  modules: (TerraformModule | TerraformChangedModule)[],
): TerraformChangedModule[] {
  return modules.filter((module): module is TerraformChangedModule => {
    return (module as TerraformChangedModule).isChanged === true;
  });
}

/**
 * Generates a valid Terraform module name from the given directory path.
 *
 * The function transforms the directory path by:
 * - Trimming whitespace
 * - Replacing invalid characters with hyphens
 * - Normalizing slashes
 * - Removing leading/trailing slashes
 * - Handling consecutive dots and hyphens
 * - Removing any remaining whitespace
 * - Lowercase (for consistency)
 *
 * @param {string} terraformDirectory - The directory path from which to generate the module name.
 * @returns {string} A valid Terraform module name based on the provided directory path.
 */
function getTerraformModuleNameFromRelativePath(terraformDirectory: string): string {
  const cleanedDirectory = terraformDirectory
    .trim() // Remove leading/trailing whitespace
    .replace(/[^a-zA-Z0-9/_-]+/g, '-') // Remove invalid characters, allowing a-z, A-Z, 0-9, /, _, -
    .replace(/\/{2,}/g, '/') // Replace multiple consecutive slashes with a single slash
    .replace(/\/\.+/g, '/') // Remove slashes followed by dots
    .replace(/(^\/|\/$)/g, '') // Remove leading/trailing slashes
    .replace(/\.\.+/g, '.') // Replace consecutive dots with a single dot
    .replace(/--+/g, '-') // Replace consecutive hyphens with a single hyphen
    .replace(/\s+/g, '') // Remove any remaining whitespace
    .toLowerCase(); // All of our module names will be lowercase

  return removeTrailingDots(cleanedDirectory);
}

/**
 * Gets the relative path of the Terraform module directory associated with a specified file.
 *
 * Traverses upward from the file's directory to locate the nearest Terraform module directory.
 * Returns the module's path relative to the current working directory.
 *
 * @param {string} filePath - The absolute or relative path of the file to analyze.
 * @returns {string | null} Relative path to the associated Terraform module directory, or null
 *                          if no directory is found.
 */
function getTerraformModuleDirectoryRelativePath(filePath: string): string | null {
  const rootDir = resolve(context.workspaceDir);
  const absoluteFilePath = isAbsolute(filePath) ? filePath : resolve(context.workspaceDir, filePath); // Handle relative/absolute
  let directory = dirname(absoluteFilePath);

  // Traverse upward until the current working directory (rootDir) is reached
  while (directory !== rootDir && directory !== resolve(directory, '..')) {
    if (isTerraformDirectory(directory)) {
      return relative(rootDir, directory);
    }

    directory = resolve(directory, '..'); // Move up a directory
  }

  // Return null if no Terraform module directory is found
  return null;
}

/**
 * Retrieves the tags for a specified module directory, filtering tags that match the module pattern
 * and sorting by versioning in descending order.
 *
 * @param {string} moduleName - The Terraform module name to find current tags.
 * @param {string[]} allTags - An array of all available tags.
 * @returns {Object} An object with the latest tag, latest tag version, and an array of all matching tags.
 */
function getTagsForModule(
  moduleName: string,
  allTags: string[],
): {
  latestTag: string | null;
  latestTagVersion: string | null;
  tags: string[];
} {
  // Filter tags that match the module directory pattern
  const tags = allTags
    .filter((tag) => tag.startsWith(`${moduleName}/v`))
    .sort((a, b) => {
      const aParts = a.replace(`${moduleName}/v`, '').split('.').map(Number);
      const bParts = b.replace(`${moduleName}/v`, '').split('.').map(Number);
      return bParts[0] - aParts[0] || bParts[1] - aParts[1] || bParts[2] - aParts[2]; // Sort in descending order
    });

  // Return the latest tag, latest tag version, and all matching tags
  return {
    latestTag: tags.length > 0 ? tags[0] : null, // Keep the full tag
    latestTagVersion: tags.length > 0 ? tags[0].replace(`${moduleName}/`, '') : null, // Extract version only
    tags,
  };
}

/**
 * Retrieves the relevant GitHub releases for a specified module directory.
 *
 * Filters releases for the module and sorts by version in descending order.
 *
 * @param {string} moduleName - The Terraform module name for which to find relevant release tags.
 * @param {GitHubRelease[]} allReleases - An array of GitHub releases.
 * @returns {GitHubRelease[]} An array of releases relevant to the module, sorted with the latest first.
 */
function getReleasesForModule(moduleName: string, allReleases: GitHubRelease[]): GitHubRelease[] {
  // Filter releases that are relevant to the module directory
  const relevantReleases = allReleases
    .filter((release) => release.title.startsWith(`${moduleName}/`))
    .sort((a, b) => {
      // Sort releases by their title or release date (depending on what you use for sorting)
      // Assuming latest release is at the top by default or using a versioning format like vX.Y.Z
      const aVersion = a.title.replace(`${moduleName}/v`, '').split('.').map(Number);
      const bVersion = b.title.replace(`${moduleName}/v`, '').split('.').map(Number);
      return bVersion[0] - aVersion[0] || bVersion[1] - aVersion[1] || bVersion[2] - aVersion[2];
    });

  return relevantReleases;
}

/**
 * Retrieves all Terraform modules within the specified workspace directory and any changes based on commits.
 * Analyzes the directory structure to identify modules and checks commit history for changes.
 *
 * @param {CommitDetails[]} commits - Array of commit details to analyze for changes.
 * @param {string[]} allTags - List of all tags associated with the modules.
 * @param {GitHubRelease[]} allReleases - GitHub releases for the modules.
 * @returns {(TerraformModule | TerraformChangedModule)[]} Array of Terraform modules with their corresponding
 *   change details.
 * @throws {Error} - If a module associated with a file is missing from the terraformModulesMap.
 */

export function getAllTerraformModules(
  commits: CommitDetails[],
  allTags: string[],
  allReleases: GitHubRelease[],
): (TerraformModule | TerraformChangedModule)[] {
  startGroup('Finding all Terraform modules with corresponding changes');
  console.time('Elapsed time finding terraform modules'); // Start timing

  const terraformModulesMap: Record<string, TerraformModule | TerraformChangedModule> = {};
  const workspaceDir = context.workspaceDir;

  // Terraform only processes .tf and .tf.json files in the current working directory where you run the terraform commands. It does not automatically scan or include files from subdirectories.

  // Helper function to recursively search for Terraform modules
  const searchDirectory = (dir: string) => {
    const files = readdirSync(dir);

    for (const file of files) {
      const filePath = join(dir, file);
      const stat = statSync(filePath);

      // If it's a directory, recursively search inside it
      if (stat.isDirectory()) {
        if (isTerraformDirectory(filePath)) {
          const relativePath = relative(workspaceDir, filePath);

          // Check if this module path should be ignored
          if (shouldIgnoreModulePath(relativePath, config.modulePathIgnore)) {
            info(`Skipping module in ${relativePath} due to module-path-ignore match`);
            continue;
          }

          const moduleName = getTerraformModuleNameFromRelativePath(relativePath);
          terraformModulesMap[moduleName] = {
            moduleName,
            directory: filePath,
            ...getTagsForModule(moduleName, allTags),
            releases: getReleasesForModule(moduleName, allReleases),
          };
        }

        // We'll always recurse into subdirectories to find terraform modules even after we've found a match.
        // This is because we want to find all modules in the workspace and although not conventional, there are
        // cases where a module could be completely nested within another module and be 100% separate.
        searchDirectory(filePath); // Recurse into subdirectories
      }
    }
  };

  // Start the search from the workspace root directory
  info(`Searching for Terraform modules in ${workspaceDir}`);
  searchDirectory(workspaceDir);

  const totalModulesFound = Object.keys(terraformModulesMap).length;
  info(`Found ${totalModulesFound} Terraform module${totalModulesFound !== 1 ? 's' : ''}`);
  info('Terraform Modules:');
  info(JSON.stringify(terraformModulesMap, null, 2));

  // Now process commits to find changed modules
  for (const { message, sha, files } of commits) {
    info(`Parsing commit ${sha}: ${message.trim().split('\n')[0].trim()} (Changed Files = ${files.length})`);

    for (const relativeFilePath of files) {
      info(`Analyzing file: ${relativeFilePath}`);
      const moduleRelativePath = getTerraformModuleDirectoryRelativePath(relativeFilePath);

      if (moduleRelativePath === null) {
        // File isn't associated with a Terraform module
        continue;
      }

      // Check if this module path should be ignored
      if (shouldIgnoreModulePath(moduleRelativePath, config.modulePathIgnore)) {
        info(`  (skipping) ➜ Matches module-path-ignore pattern for path \`${moduleRelativePath}\``);
        continue;
      }

      const moduleName = getTerraformModuleNameFromRelativePath(moduleRelativePath);

      // Skip excluded files based on provided pattern
      if (shouldExcludeFile(moduleRelativePath, relativeFilePath, config.moduleChangeExcludePatterns)) {
        info(`  (skipping) ➜ Matches module-change-exclude-pattern for path \`${moduleRelativePath}\``);
        continue;
      }

      const module = terraformModulesMap[moduleName];

      /* c8 ignore start */
      if (!module) {
        // Module not found in the map, this should not happen
        throw new Error(
          `Found changed file "${relativeFilePath}" associated with a terraform module "${moduleName}"; however, associated module does not exist`,
        );
      }
      /* c8 ignore stop */

      // Update the module with the TerraformChangedModule properties
      const releaseType = determineReleaseType(message, (module as TerraformChangedModule)?.releaseType);
      const nextTagVersion = getNextTagVersion(module.latestTagVersion, releaseType);
      const commitMessages = (module as TerraformChangedModule).commitMessages || [];

      if (!commitMessages.includes(message)) {
        commitMessages.push(message);
      }

      // Update the existing module properties
      Object.assign(module, {
        isChanged: true, // Mark as changed
        commitMessages,
        releaseType,
        nextTag: `${moduleName}/${nextTagVersion}`,
        nextTagVersion,
      });
    }
  }

  // Sort terraform modules by module name
  const sortedTerraformModules = Object.values(terraformModulesMap)
    .slice()
    .sort((a, b) => {
      return a.moduleName.localeCompare(b.moduleName);
    });

  info('Finished analyzing directory tree, terraform modules, and commits');
  info(`Found ${sortedTerraformModules.length} terraform module${sortedTerraformModules.length !== 1 ? 's' : ''}.`);

  let terraformChangedModules: TerraformChangedModule[] | null = getTerraformChangedModules(sortedTerraformModules);
  info(
    `Found ${terraformChangedModules.length} changed Terraform module${terraformChangedModules.length !== 1 ? 's' : ''}.`,
  );
  // Free up memory by unsetting terraformChangedModules
  terraformChangedModules = null;

  debug('Terraform Modules:');
  debug(JSON.stringify(sortedTerraformModules, null, 2));

  console.timeEnd('Elapsed time finding terraform modules');
  endGroup();

  return sortedTerraformModules;
}

/**
 * Determines an array of Terraform module names that need to be removed.
 *
 * @param {string[]} allTags - A list of all tags associated with the modules.
 * @param {TerraformModule[]} terraformModules - An array of Terraform modules.
 * @returns {string[]} An array of Terraform module names that need to be removed.
 */
export function getTerraformModulesToRemove(allTags: string[], terraformModules: TerraformModule[]): string[] {
  startGroup('Finding all Terraform modules that should be removed');

  // Get an array of all module names from the tags
  const moduleNamesFromTags = Array.from(
    new Set(
      allTags
        // Currently, we will remove all tags. If we wanted to allow other tags that didnt
        // take the form of moduleName/vX.Y.Z, we could filter them out here. However, the purpose
        // of this monorepo terraform releaser is repo-encompassing and thus if someone has a
        // dangling tag, we should ideally remove it.
        //.filter((tag) => {
        //  return /^.*\/v\d+\.\d+\.\d+$/.test(tag);
        //})
        .map((tag) => tag.replace(/\/v\d+\.\d+\.\d+$/, '')),
    ),
  );

  // Get an array of all module names from the terraformModules
  const moduleNamesFromModules = terraformModules.map((module) => module.moduleName);

  // Perform a diff between the two arrays to find the module names that need to be removed
  const moduleNamesToRemove = moduleNamesFromTags.filter((moduleName) => !moduleNamesFromModules.includes(moduleName));

  info('Terraform modules to remove');
  info(JSON.stringify(moduleNamesToRemove, null, 2));

  endGroup();

  return moduleNamesToRemove;
}
