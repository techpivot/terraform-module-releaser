import * as fs from 'node:fs';
import * as path from 'node:path';
import { info } from '@actions/core';
import { minimatch } from 'minimatch';
import { config } from './config';

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
  return excludePatterns.some((pattern: string) => minimatch(relativePath, pattern, { matchBase: true }));
}

/**
 * Recursively copies the contents of a directory to a temporary directory,
 * excluding files that match specified patterns.
 *
 * @param {string} directory - The directory to copy from.
 * @param {string} tmpDir - The temporary directory to copy to.
 * @param {string} [baseDirectory] - The base directory for exclusion pattern matching.
 *                                    Defaults to the source directory if not provided.
 */
export function copyModuleContents(directory: string, tmpDir: string, baseDirectory?: string) {
  const baseDir = baseDirectory || directory;

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
      copyModuleContents(filePath, newDir, baseDir); // Recursion for directory contents
    } else if (!shouldExcludeFile(baseDir, filePath, config.moduleAssetExcludePatterns)) {
      // Handle file copying
      fs.copyFileSync(filePath, path.join(tmpDir, file));
    } else {
      info(`Excluding file: ${filePath}`);
    }
  }
}
