import fs from 'node:fs';
import path from 'node:path';
import { debug, endGroup, info, startGroup } from '@actions/core';
import type { CommitDetails } from './pull-request';
import type { GitHubRelease } from './releases';
import type { ReleaseType } from './semver';
import { determineReleaseType, getNextTagVersion } from './semver';

/**
 * Represents a Terraform module.
 */
export interface TerraformModule {
  /**
   * The relative Terraform module path used for tagging with some special characters removed.
   */
  moduleName: string;

  /**
   * The relative path to the directory where the module is located. (This may include other non-name characters)
   */
  directory: string;

  /**
   * Array of tags relevant to this module
   */
  tags: string[];

  /**
   * Array of releases relevant to this module
   */
  releases: GitHubRelease[];

  /**
   * Specifies the full tag associated with the module or null if no tag is found.
   */
  latestTag: string | null;

  /**
   * Specifies the tag version associated with the module (vX.Y.Z) or null if no tag is found.
   */
  latestTagVersion: string | null;
}

/**
 * Represents a changed Terraform module, which indicates that a pull request contains file changes
 * associated with a corresponding Terraform module directory.
 */
export interface TerraformChangedModule extends TerraformModule {
  /**
   *
   */
  isChanged: true;

  /**
   * An array of commit messages associated with the module's changes.
   */
  commitMessages: string[];

  /**
   * The type of release (e.g., major, minor, patch) to be applied to the module.
   */
  releaseType: ReleaseType;

  /**
   * The tag that will be applied to the module for the next release.
   * This should follow the pattern of 'module-name/vX.Y.Z'.
   */
  nextTag: string;

  /**
   * The version string of the next tag, which is formatted as 'vX.Y.Z'.
   */
  nextTagVersion: string;
}

/**
 * Filters an array of Terraform modules to return only those that are marked as changed.
 *
 * @param modules - An array of TerraformModule or TerraformChangedModule objects.
 * @returns An array of TerraformChangedModule objects that have been marked as changed.
 */
export const getTerraformChangedModules = (
  modules: (TerraformModule | TerraformChangedModule)[],
): TerraformChangedModule[] => {
  return modules.filter((module): module is TerraformChangedModule => {
    return (module as TerraformChangedModule).isChanged === true;
  });
};

/**
 * Checks if a directory contains any Terraform (.tf) files.
 *
 * @param {string} dirPath - The path of the directory to check.
 * @returns {boolean} True if the directory contains at least one .tf file, otherwise false.
 */
const isTerraformDirectory = (dirPath: string): boolean => {
  return fs.existsSync(dirPath) && fs.readdirSync(dirPath).some((file) => path.extname(file) === '.tf');
};

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
 * @param {string} terraformDir - The directory path from which to generate the module name.
 * @returns {string} A valid Terraform module name based on the provided directory path.
 */
const getTerraformModuleNameFromDirectory = (terraformDirectory: string): string => {
  return terraformDirectory
    .trim() // Remove leading/trailing whitespace
    .replace(/[^a-zA-Z0-9/_-]+/g, '-') // Remove invalid characters, allowing a-z, A-Z, 0-9, /, _, -
    .replace(/\/{2,}/g, '/') // Replace multiple consecutive slashes with a single slash
    .replace(/\/\.+/g, '/') // Remove slashes followed by dots
    .replace(/(^\/|\/$)/g, '') // Remove leading/trailing slashes
    .replace(/\.+$/, '') // Remove trailing dots
    .replace(/\.\.+/g, '.') // Replace consecutive dots with a single dot
    .replace(/\-\-+/g, '-') // Replace consecutive hyphens with a single hyphen
    .replace(/\s+/g, '') // Remove any remaining whitespace
    .toLowerCase(); // All of our module names will be lowercase
};

/**
 * Retrieves the Terraform module name associated with a specified file path.
 *
 * This function navigates upwards from the file's directory to find the nearest
 * Terraform directory. If a Terraform directory is found, it returns the
 * module name relative to the current working directory.
 *
 * @param {string} filePath - The absolute or relative path of the file to analyze.
 * @returns {string | null} The name of the associated Terraform module, or null
 *                          if no Terraform directory is found before reaching the root.
 */
const getTerraformModuleNameAssociatedWithFile = (filePath: string): string | null => {
  let directory = path.resolve(path.dirname(filePath)); // Convert to absolute path
  const cwd = process.cwd();
  const rootDir = path.resolve(cwd); // Get absolute path to current working directory

  // Loop upwards until the current working directory (rootDir) is reached
  while (directory !== rootDir && directory !== path.resolve(directory, '..')) {
    if (isTerraformDirectory(directory)) {
      return getTerraformModuleNameFromDirectory(path.relative(cwd, directory));
    }

    directory = path.resolve(directory, '..'); // Move up a directory
  }

  // Root folder is not allowed as we need a name
  return null;
};

/**
 * Retrieves the current tags and versions for a specified module directory.
 *
 * This helper function filters tags that match the module directory pattern,
 * sorts them based on versioning in descending order, and returns the latest tag,
 * the latest version, and an array of all matching tags.
 *
 * @param {string} moduleName - The terraform module name for which to find the current tags.
 * @param {string[]} allTags - An array of all available tags.
 * @returns {{latestTag: string | null, latestTagVersion: string | null, tags: string[]}} An object containing the latest tag, latest tag version, and an array of matching tags.
 */
const getTagsForModule = (
  moduleName: string,
  allTags: string[],
): {
  latestTag: string | null;
  latestTagVersion: string | null;
  tags: string[];
} => {
  // Filter tags that match the module directory pattern
  const tags = allTags
    .filter((tag) => tag.startsWith(`${moduleName}/v`))
    .sort((a, b) => {
      const aParts = a.replace(`${moduleName}/`, '').replace('v', '').split('.').map(Number);
      const bParts = b.replace(`${moduleName}/`, '').replace('v', '').split('.').map(Number);
      return bParts[0] - aParts[0] || bParts[1] - aParts[1] || bParts[2] - aParts[2]; // Sort in descending order
    });

  // Return the latest tag, latest tag version, and all matching tags
  return {
    latestTag: tags.length > 0 ? tags[0] : null, // Keep the full tag
    latestTagVersion: tags.length > 0 ? tags[0].replace(`${moduleName}/`, '') : null, // Extract version only
    tags,
  };
};

/**
 * Retrieves the relevant GitHub releases for a specified module directory.
 *
 * This function filters releases that are relevant to the module directory,
 * sorts them by the latest release (assuming the latest release is at the top),
 * and returns all relevant releases.
 *
 * @param {string} moduleName - The terraform module name for which to find the relevant releases tags.
 * @param {GitHubRelease[]} allReleases - An array of all GitHub releases.
 * @returns {GitHubRelease[]} An array of releases relevant to the module, sorted with the latest first.
 */
const getReleasesForModule = (moduleName: string, allReleases: GitHubRelease[]): GitHubRelease[] => {
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
};

/**
 * Retrieves all Terraform modules within the specified workspace directory,
 * along with any changes associated with commits provided. It analyzes
 * the directory structure to identify modules and checks commit history
 * to determine if any modules have changed, updating their details accordingly.
 *
 * @param {string} workspaceDir - The root directory of the workspace containing Terraform modules.
 * @param {CommitDetails[]} commits - An array of commit details to analyze for changes.
 * @param {string[]} allTags - A list of all tags associated with the modules.
 * @param {GitHubRelease[]} allReleases - An array of GitHub releases for the modules.
 * @returns {(TerraformModule | TerraformChangedModule)[]} - An array of Terraform modules, each containing their
 *    corresponding change details. The modules may either be of type `TerraformModule` or `TerraformChangedModule`.
 * @throws {Error} - Throws an error if a module associated with a file is not found in the
 *    terraformModulesMap, indicating a mismatch in expected module structure.
 */
export const getAllTerraformModules = (
  workspaceDir: string,
  commits: CommitDetails[],
  allTags: string[],
  allReleases: GitHubRelease[],
): (TerraformModule | TerraformChangedModule)[] => {
  startGroup('Finding all Terraform modules with corresponding changes');
  console.time('Elapsed time finding terraform modules'); // Start timing

  const terraformModulesMap: Record<string, TerraformModule | TerraformChangedModule> = {};

  // Helper function to recursively search for Terraform modules
  const searchDirectory = (dir: string) => {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      // If it's a directory, recursively search inside it
      if (stat.isDirectory()) {
        if (isTerraformDirectory(filePath)) {
          const moduleName = getTerraformModuleNameFromDirectory(path.relative(workspaceDir, filePath));
          terraformModulesMap[moduleName] = {
            moduleName,
            directory: filePath,
            ...getTagsForModule(moduleName, allTags),
            releases: getReleasesForModule(moduleName, allReleases),
          };
        } else {
          searchDirectory(filePath); // Recurse into subdirectories
        }
      }
    }
  };

  // Start the search from the workspace root directory
  searchDirectory(workspaceDir);

  // Now process commits to find changed modules
  for (const { message, sha, files } of commits) {
    info(`Parsing commit ${sha}: ${message}`);

    for (const filePath of files) {
      const moduleName = getTerraformModuleNameAssociatedWithFile(filePath);

      if (moduleName === null) {
        // File isn't associated with a Terraform module
        continue;
      }

      const module = terraformModulesMap[moduleName];

      if (!module) {
        // Module not found in the map, this should not happen
        debug(moduleName);
        throw new Error('Found code associated with a terraform module; however, associated module does not exist');
      }

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

  debug('Terraform Modules:');
  debug(JSON.stringify(sortedTerraformModules, null, 2));

  console.timeEnd('Elapsed time finding terraform modules');
  endGroup();

  return sortedTerraformModules;
};

/**
 * Determines an array of Terraform module names that need to be removed.
 *
 * @param {string[]} allTags - A list of all tags associated with the modules.
 * @param {TerraformModule[]} terraformModules - An array of Terraform modules.
 * @returns {string[]} An array of Terraform module names that need to be removed.
 */
export const getTerraformModulesToRemove = (allTags: string[], terraformModules: TerraformModule[]): string[] => {
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
};
