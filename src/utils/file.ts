import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
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
 * This function evaluates whether a given module path matches any of the specified ignore patterns
 * using the minimatch library for glob pattern matching.
 *
 * @remarks
 * Important pattern matching behavior notes:
 * - A pattern like "dir/**" will match files/directories INSIDE "dir" but NOT "dir" itself
 * - To match both a directory and its contents, you must include both patterns:
 *   ["dir", "dir/**"]
 * - The function uses matchBase: false for precise path structure matching
 *
 * @example
 * // Will return false (doesn't match the directory itself)
 * shouldIgnoreModulePath('tf-modules/kms/examples/complete', ['tf-modules/kms/examples/complete/**']);
 *
 * @example
 * // Will return true (matches the exact path)
 * shouldIgnoreModulePath('tf-modules/kms/examples/complete', ['tf-modules/kms/examples/complete']);
 *
 * @param {string} modulePath - The path of the module to check.
 * @param {string[]} ignorePatterns - Array of path patterns to ignore.
 * @returns {boolean} True if the module should be ignored, false otherwise.
 */
export function shouldIgnoreModulePath(modulePath: string, ignorePatterns: string[]): boolean {
  if (!ignorePatterns || ignorePatterns.length === 0) {
    return false;
  }

  return ignorePatterns.some((pattern: string) => minimatch(modulePath, pattern, { matchBase: false }));
}

/**
 * Checks if a file should be excluded from matching based on the defined exclude patterns
 * and relative paths from the base directory.
 *
 * @param {string} baseDirectory - The base directory to resolve relative paths against.
 * @param {string} filePath - The path of the file to check.
 * @param {string[]} excludePatterns - An array of patterns to match against for exclusion.
 * @returns {boolean} True if the file should be excluded, false otherwise.
 */
export function shouldExcludeFile(baseDirectory: string, filePath: string, excludePatterns: string[]): boolean {
  const relativePath = relative(baseDirectory, filePath);

  // Expand patterns to include both directories and their contents, then remove duplicates
  const expandedPatterns = Array.from(
    new Set(
      excludePatterns.flatMap((pattern) => [
        pattern, // Original pattern
        pattern.replace(/\/(?:\*\*)?$/, ''), // Match directories themselves, like `tests2/`
      ]),
    ),
  );

  return expandedPatterns.some((pattern: string) => minimatch(relativePath, pattern, { matchBase: true }));
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
    } else if (!shouldExcludeFile(baseDir, filePath, excludePatterns)) {
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
    if (!shouldExcludeFile(directory, itemPath, exceptions)) {
      //if (!exceptions.includes(item)) {
      rmSync(itemPath, { recursive: true, force: true });
    }
  }
  info(`Removed contents of directory [${directory}], preserving items: ${exceptions.join(', ')}`);
}
