import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { context } from '@/context';
import { info } from '@actions/core';
import { minimatch } from 'minimatch';

/**
 * Checks if a directory contains any Terraform (.tf) files.
 *
 * @param {string} dirPath - The path of the directory to check.
 * @returns {boolean} True if the directory contains at least one .tf file, otherwise false.
 */
export function isTerraformDirectory(dirPath: string): boolean {
  return existsSync(dirPath) && readdirSync(dirPath).some((file) => extname(file) === '.tf');
}

/**
 * Checks if a module path should be ignored based on provided ignore patterns.
 *
 * This function evaluates whether a given relative module path matches any of the specified ignore patterns
 * using the minimatch library for glob pattern matching. It is called after all Terraform module directories
 * are found, to filter them using the patterns provided via the 'module-path-ignore' flag.
 *
 * @remarks
 * Important pattern matching behavior notes:
 * - A pattern like "dir/**" will match files/directories INSIDE "dir" but NOT "dir" itself
 * - To match both a directory and its contents, you must include both patterns:
 *   ["dir", "dir/**"]
 * - The function uses matchBase: false for precise path structure matching
 * - The modulePath parameter must be a path relative to the workspace root directory
 *
 * @example
 * // Will return { shouldIgnore: false }
 * shouldIgnoreModulePath('tf-modules/kms/examples/complete', ['tf-modules/kms/examples/complete/**']);
 *
 * @example
 * // Will return { shouldIgnore: true, matchedPattern: 'tf-modules/kms/examples/complete' }
 * shouldIgnoreModulePath('tf-modules/kms/examples/complete', ['tf-modules/kms/examples/complete']);
 *
 * @param {string} relativeModulePath - The relative path of the module to check.
 * @param {string[]} ignorePatterns - Array of path patterns to ignore.
 * @returns {{ shouldIgnore: boolean, matchedPattern?: string }} Object containing whether to ignore and the matched pattern.
 */
export function shouldIgnoreModulePath(
  relativeModulePath: string,
  ignorePatterns: string[],
): {
  /** Whether the module should be ignored */
  shouldIgnore: boolean;
  /** The pattern that matched (if any) */
  matchedPattern?: string;
} {
  if (!ignorePatterns || ignorePatterns.length === 0) {
    return { shouldIgnore: false };
  }

  for (const pattern of ignorePatterns) {
    if (minimatch(relativeModulePath, pattern, { matchBase: false })) {
      return { shouldIgnore: true, matchedPattern: pattern };
    }
  }

  return { shouldIgnore: false };
}

/**
 * Recursively finds Terraform module directories within a given workspace directory.
 *
 * This function traverses the directory structure starting from the specified workspace directory
 * and identifies directories that contain Terraform configurations. It skips '.terraform' directories
 * and any paths that match the provided ignore patterns.
 *
 * @param workspaceDir - The root directory to start searching from
 * @param modulePathIgnore - Optional array of patterns for module paths to ignore
 * @returns An array of absolute paths to Terraform module directories
 */
export function findTerraformModuleDirectories(workspaceDir: string, modulePathIgnore: string[] = []): string[] {
  const modulePaths: string[] = [];

  const searchDirectory = (dir: string): void => {
    const files = readdirSync(dir);

    for (const file of files) {
      // Skip .terraform directories entirely
      if (file === '.terraform') {
        continue;
      }

      const fullPath = join(dir, file);
      const stat = statSync(fullPath);

      // If this isn't a directory, skip it
      if (!stat.isDirectory()) {
        continue;
      }

      if (isTerraformDirectory(fullPath)) {
        const relativeModulePath = relative(workspaceDir, fullPath);

        // Check if this module path should be ignored
        const ignore = shouldIgnoreModulePath(relativeModulePath, modulePathIgnore);
        if (ignore.shouldIgnore) {
          info(
            `Skipping module in '${relativeModulePath}' due to module-path-ignore match: "${ignore.matchedPattern}"`,
          );
          continue;
        }

        modulePaths.push(fullPath);
      }

      // Recurse into subdirectories
      searchDirectory(fullPath);
    }
  };

  searchDirectory(workspaceDir);

  return modulePaths;
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
export function getRelativeTerraformModulePathFromFilePath(filePath: string): string | null {
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
 * Checks if a file should be excluded from triggering a module version bump based on exclude patterns.
 * Returns an object with match status and the matched pattern (if any).
 *
 * @example
 * // Given a file 'tests/sub/test.tftest.hcl' and patterns ['*.md', '*.tftest.hcl', 'tests/**']:
 * // shouldExcludeFile('tests/sub/test.tftest.hcl', ['*.md', '*.tftest.hcl', 'tests/**'])
 * //   => { shouldExclude: true, matchedPattern: 'tests/**' }
 *
 * @param relativeFilePath - The file path to check, relative to the module directory (no leading slash)
 * @param excludePatterns - Array of glob patterns (relative to the module directory)
 * @returns { shouldExclude: boolean, matchedPattern?: string }
 */
export function shouldExcludeFile(
  relativeFilePath: string,
  excludePatterns: string[],
): { shouldExclude: boolean; matchedPattern?: string } {
  for (const pattern of excludePatterns) {
    if (minimatch(relativeFilePath, pattern, { matchBase: true })) {
      return { shouldExclude: true, matchedPattern: pattern };
    }
  }
  return { shouldExclude: false };
}

/**
 * Recursively copies the contents of a directory to a temporary directory,
 * excluding files that match specified patterns.
 *
 * @param {string} directory - The directory to copy from.
 * @param {string} tmpDir - The temporary directory to copy to.
 * @param {string[]} excludePatterns - An array of patterns to match against for exclusion.
 * @param {string} [baseDirectory] - The base directory for exclusion pattern matching.
 *                                    Defaults to the source directory if not provided.
 */
export function copyModuleContents(
  directory: string,
  tmpDir: string,
  excludePatterns: string[],
  baseDirectory?: string,
) {
  const baseDir = baseDirectory ?? directory;

  // Read the directory contents
  const filesToCopy = readdirSync(directory);

  info(`Copying "${directory}" to directory: ${tmpDir}`);
  for (const file of filesToCopy) {
    const filePath = join(directory, file);
    const stats = statSync(filePath);

    if (stats.isDirectory()) {
      // If the item is a directory, create the directory in tmpDir and copy its contents
      const newDir = join(tmpDir, file);
      mkdirSync(newDir, { recursive: true });
      // Note: Important we pass the original base directory.
      copyModuleContents(filePath, newDir, excludePatterns, baseDir); // Recursion for directory contents
    } else if (!shouldExcludeFile(relative(baseDir, filePath), excludePatterns).shouldExclude) {
      // Handle file copying
      copyFileSync(filePath, join(tmpDir, file));
    } else {
      info(`Excluding file: ${filePath}`);
    }
  }
}

/**
 * Removes all contents of a specified directory except for specified items to preserve.
 *
 * @param directory - The path of the directory to clear.
 * @param exceptions - An array of filenames or directory names to preserve within the directory.
 *
 * This function removes all files and subdirectories within the specified directory while
 * retaining any items listed in the `exceptions` array. The names in `exceptions` should be
 * relative to the `directory` (e.g., `['.git', 'README.md']`), referring to items within the
 * directory you want to keep.
 *
 * ### Example Usage:
 *
 * Suppose you have a directory structure:
 * ```
 * /example-directory/
 * ├── .git/
 * ├── config.json
 * ├── temp/
 * └── README.md
 * ```
 *
 * Using `removeDirectoryContents('/example-directory', ['.git', 'README.md'])` will:
 * - Remove `config.json` and the `temp` folder.
 * - Preserve the `.git` directory and `README.md` file within `/example-directory`.
 *
 * **Note:**
 * - Items in `exceptions` are matched only by their names relative to the given `directory`.
 * - If the `.git` directory or `README.md` file were in a nested subdirectory within `/example-directory`,
 *   you would need to adjust the `exceptions` parameter accordingly to reflect the correct relative path.
 *
 * @example
 * removeDirectoryContents('/home/user/project', ['.git', 'important-file.txt']);
 * // This would remove all contents inside `/home/user/project`, except for the `.git` directory
 * // and the `important-file.txt` file.
 */
export function removeDirectoryContents(directory: string, exceptions: string[] = []): void {
  if (!existsSync(directory)) {
    return;
  }

  for (const item of readdirSync(directory)) {
    const itemPath = join(directory, item);

    // Skip removal for items listed in the exceptions array
    if (!shouldExcludeFile(relative(directory, itemPath), exceptions).shouldExclude) {
      rmSync(itemPath, { recursive: true, force: true });
    }
  }
  info(`Removed contents of directory [${directory}], preserving items: ${exceptions.join(', ')}`);
}
