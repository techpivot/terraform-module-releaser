import { config } from '@/config';
import { context } from '@/context';
import { TerraformModule } from '@/terraform-module';
import type { CommitDetails, GitHubRelease } from '@/types';
import {
  findTerraformModuleDirectories,
  getRelativeTerraformModulePathFromFilePath,
  shouldExcludeFile,
} from '@/utils/file';
import { endGroup, info, startGroup } from '@actions/core';

/**
 * Parses the workspace to identify and instantiate Terraform modules, tracking changes across commits.
 *
 * This function performs a three-phase parsing process:
 * 1. Discovers all Terraform module directories in the workspace
 * 2. Creates TerraformModule instances for each directory
 * 3. Associates commits with their respective modules by analyzing changed files
 *
 * The implementation processes commits iteratively and adds each commit to the appropriate
 * TerraformModule instance. This approach is more efficient than having each TerraformModule
 * individually scan for relevant commits, as it only requires a single pass through the commit data.
 * The TerraformModule class provides mutator methods to allow this externally-driven change association.
 *
 * @param commits - Array of commit details including message, SHA, and changed files
 * @param allTags - Optional array of all Git tags in the repository
 * @param allReleases - Optional array of all GitHub releases in the repository
 * @returns Array of TerraformModule instances sorted alphabetically by module name
 */
export function parseTerraformModules(
  commits: CommitDetails[],
  allTags: string[] = [],
  allReleases: GitHubRelease[] = [],
): TerraformModule[] {
  startGroup('Parsing Terraform modules');
  console.time('Elapsed time parsing terraform modules');

  //
  // Phase 1: Find all module directories
  //
  const workspaceDir = context.workspaceDir;
  info(`Searching for Terraform modules in ${workspaceDir}`);
  const moduleDirectories = findTerraformModuleDirectories(workspaceDir, config.modulePathIgnore);
  info(
    `Found ${moduleDirectories.length} Terraform module ${moduleDirectories.length === 1 ? 'directory' : 'directories'}:`,
  );
  info(JSON.stringify(moduleDirectories, null, 2));

  //
  // Phase 2: Create TerraformModule instances for each directory
  //
  info('Creating TerraformModule instances for each module directory...');
  const terraformModulesMap: Record<string, TerraformModule> = {};
  for (const directory of moduleDirectories) {
    const module = new TerraformModule(directory);
    terraformModulesMap[module.name] = module;
  }

  //
  // Phase 3: Process commits to find changed modules
  //
  info('Processing commits to find changed modules...');
  for (const commit of commits) {
    const { message, sha, files } = commit;
    info(`🔍 Parsing commit ${sha}: ${message.trim().split('\n')[0].trim()} (Changed Files = ${files.length})`);

    // Track which modules should get this commit (only modules with at least one non-excluded file)
    const modulesToCommitMap = new Map<string, boolean>();

    for (const relativeFilePath of files) {
      const relativeModulePath = getRelativeTerraformModulePathFromFilePath(relativeFilePath);

      if (relativeModulePath === null) {
        // File isn't associated with a Terraform module - continue to next file.
        info(`✗ Skipping file "${relativeFilePath}" ➜  No associated Terraform module`);
        continue;
      }

      const moduleName = TerraformModule.getTerraformModuleNameFromRelativePath(relativeModulePath);
      const module = terraformModulesMap[moduleName];

      // If the module is not found in the map, it means the file's path does not correspond to any known
      // Terraform module directory. This can happen if the module was deleted, renamed, or excluded via the
      // modulePathIgnore flag during initial discovery. In such cases, any changed files in these directories
      // are also excluded from release bumping, as they are not part of the current release set. This is not
      // an error: we simply skip these files and do not attempt to process them for release logic.
      if (!module) {
        info(
          `✗ Skipping file "${relativeFilePath}" ➜  No associated active Terraform module "${moduleName}" (Likely due to module ignoring).`,
        );
        continue;
      }

      // For checking should exclude file, we need the relative path from the module root
      // Example:
      //  relativeFilePath         modules/vpc/main.tf
      //  relativeModulePath       modules/vpc
      //  relativeModuleFilePath   main.tf
      const relativeModuleFilePath = relativeFilePath.replace(`${relativeModulePath}/`, '');
      const excludeResult = shouldExcludeFile(relativeModuleFilePath, config.moduleChangeExcludePatterns);
      if (excludeResult.shouldExclude) {
        info(
          `✗ Skipping file "${relativeFilePath}" ➜  Excluded by via module-change-exclude-pattern "${excludeResult.matchedPattern}"`,
        );
        continue;
      }

      // Mark this module as having at least one non-excluded file
      modulesToCommitMap.set(moduleName, true);
      info(`✓ Found changed file "${relativeFilePath}" in module "${moduleName}"`);
    }

    // Only add the commit to modules that have at least one non-excluded file
    for (const moduleName of modulesToCommitMap.keys()) {
      const module = terraformModulesMap[moduleName];
      module.addCommit(commit);
    }
  }

  const terraformModules = Object.values(terraformModulesMap);

  info('Adding tags and releases...');
  for (const terraformModule of terraformModules) {
    terraformModule.setTags(TerraformModule.getTagsForModule(terraformModule.name, allTags));
    terraformModule.setReleases(TerraformModule.getReleasesForModule(terraformModule.name, allReleases));
  }

  info('Sorting by name...');
  terraformModules.sort((a, b) => a.name.localeCompare(b.name));

  info(`Successfully parsed and instantiated ${terraformModules.length} Terraform modules:`);
  for (const terraformModule of terraformModules) {
    info(terraformModule.toString());
  }

  console.timeEnd('Elapsed time parsing terraform modules');
  endGroup();

  return terraformModules;
}
