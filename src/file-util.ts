import * as fs from 'node:fs';
import * as path from 'node:path';
import { info } from '@actions/core';
import { minimatch } from 'minimatch';

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
  const relativePath = path.relative(baseDirectory, filePath);

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
  const filesToCopy = fs.readdirSync(directory);

  info(`Copying "${directory}" to directory: ${tmpDir}`);
  for (const file of filesToCopy) {
    const filePath = path.join(directory, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      // If the item is a directory, create the directory in tmpDir and copy its contents
      const newDir = path.join(tmpDir, file);
      fs.mkdirSync(newDir, { recursive: true });
      // Note: Important we pass the original base directory.
      copyModuleContents(filePath, newDir, excludePatterns, baseDir); // Recursion for directory contents
    } else if (!shouldExcludeFile(baseDir, filePath, excludePatterns)) {
      // Handle file copying
      fs.copyFileSync(filePath, path.join(tmpDir, file));
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
  if (!fs.existsSync(directory)) {
    return;
  }

  for (const item of fs.readdirSync(directory)) {
    const itemPath = path.join(directory, item);

    // Skip removal for items listed in the exceptions array
    if (!shouldExcludeFile(directory, itemPath, exceptions)) {
      //if (!exceptions.includes(item)) {
      fs.rmSync(itemPath, { recursive: true, force: true });
    }
  }
  info(`Removed contents of directory [${directory}], preserving items: ${exceptions.join(', ')}`);
}
