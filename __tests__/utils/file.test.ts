import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyModuleContents, isTerraformDirectory, removeDirectoryContents, shouldExcludeFile } from '@/utils/file';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('utils/file', () => {
  let tmpDir: string;

  beforeEach(() => {
    // Create a temporary directory before each test
    tmpDir = mkdtempSync(join(tmpdir(), 'test-dir-'));
  });

  afterEach(() => {
    // Remove temporary directory
    rmSync(tmpDir, { recursive: true });
  });

  describe('isTerraformDirectory()', () => {
    it('should return true for a directory that has .tf files', () => {
      writeFileSync(join(tmpDir, 'main.tf'), '# terraform code');
      expect(isTerraformDirectory(tmpDir)).toBe(true);
    });

    it('should return false for a directory that has .tf files', () => {
      writeFileSync(join(tmpDir, 'README.md'), '# README');
      expect(isTerraformDirectory(tmpDir)).toBe(false);
    });

    it('should return false for invalid directory', () => {
      expect(isTerraformDirectory('/invalid-directory')).toBe(false);
    });
  });

  describe('shouldExcludeFile()', () => {
    it('should exclude file when pattern matches', () => {
      const baseDirectory = tmpDir;
      const filePath = join(tmpDir, 'file.txt');
      const excludePatterns = ['*.txt'];

      expect(shouldExcludeFile(baseDirectory, filePath, excludePatterns)).toBe(true);
    });

    it('should not exclude file when pattern does not match', () => {
      const baseDirectory = tmpDir;
      const filePath = join(tmpDir, 'file.txt');
      const excludePatterns = ['*.js'];

      expect(shouldExcludeFile(baseDirectory, filePath, excludePatterns)).toBe(false);
    });

    it('should handle relative paths correctly', () => {
      const baseDirectory = tmpDir;
      const filePath = join(tmpDir, 'subdir', 'file.txt');
      const excludePatterns = ['subdir/*.txt'];

      expect(shouldExcludeFile(baseDirectory, filePath, excludePatterns)).toBe(true);
    });

    it('should handle exclusion pattern: *.md', () => {
      const baseDirectory = tmpDir;
      const filePath1 = join(tmpDir, 'README.md');
      const filePath2 = join(tmpDir, 'nested', 'README.md');
      const excludePatterns = ['*.md'];

      expect(shouldExcludeFile(baseDirectory, filePath1, excludePatterns)).toBe(true);
      expect(shouldExcludeFile(baseDirectory, filePath2, excludePatterns)).toBe(true);
    });

    it('should handle exclusion pattern: **/*.md', () => {
      const baseDirectory = tmpDir;
      const filePath1 = join(tmpDir, 'README.md');
      const filePath2 = join(tmpDir, 'nested', 'README.md');
      const excludePatterns = ['**/*.md'];

      expect(shouldExcludeFile(baseDirectory, filePath1, excludePatterns)).toBe(true);
      expect(shouldExcludeFile(baseDirectory, filePath2, excludePatterns)).toBe(true);
    });

    it('should handle exclusion pattern: tests/**', () => {
      const baseDirectory = tmpDir;
      const filePath1 = join(tmpDir, 'tests/config.test.ts');
      const filePath2 = join(tmpDir, 'tests2/config.test.ts');
      const filePath3 = join(tmpDir, 'tests2/tests/config.test.ts');
      const excludePatterns = ['tests/**'];

      expect(shouldExcludeFile(baseDirectory, filePath1, excludePatterns)).toBe(true);
      expect(shouldExcludeFile(baseDirectory, filePath2, excludePatterns)).toBe(false);
      expect(shouldExcludeFile(baseDirectory, filePath3, excludePatterns)).toBe(false);
    });

    it('should handle exclusion pattern: **/tests/**', () => {
      const baseDirectory = tmpDir;
      const filePath1 = join(tmpDir, 'tests/config.test.ts');
      const filePath2 = join(tmpDir, 'tests2/config.test.ts');
      const filePath3 = join(tmpDir, 'tests2/tests/config.test.ts');
      const excludePatterns = ['**/tests/**'];

      expect(shouldExcludeFile(baseDirectory, filePath1, excludePatterns)).toBe(true);
      expect(shouldExcludeFile(baseDirectory, filePath2, excludePatterns)).toBe(false);
      expect(shouldExcludeFile(baseDirectory, filePath3, excludePatterns)).toBe(true);
    });
  });

  describe('copyModuleContents()', () => {
    beforeEach(() => {
      // Create src and dest directories for every test in this suite
      mkdirSync(join(tmpDir, 'src'), { recursive: true });
      mkdirSync(join(tmpDir, 'dest'), { recursive: true });
    });

    it('should copy directory contents excluding files that match patterns', () => {
      const srcDirectory = join(tmpDir, 'src');
      const destDirectory = join(tmpDir, 'dest');
      const excludePatterns = ['*.txt'];

      // Create files in src directory
      writeFileSync(join(srcDirectory, 'file.txt'), 'Hello World!');
      writeFileSync(join(srcDirectory, 'file.js'), 'console.log("Hello World!");');

      // Now perform the copy operation
      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      // Check that the file was copied
      expect(existsSync(join(destDirectory, 'file.txt'))).toBe(false);
      expect(existsSync(join(destDirectory, 'file.js'))).toBe(true);
    });

    it('should handle recursive directory copying', () => {
      const srcDirectory = join(tmpDir, 'src');
      const destDirectory = join(tmpDir, 'dest');
      const excludePatterns: string[] = [];

      // Create source structure
      mkdirSync(join(srcDirectory, 'subdir'), { recursive: true });
      writeFileSync(join(srcDirectory, 'file.txt'), 'Hello World!');
      writeFileSync(join(srcDirectory, 'subdir', 'file.js'), 'console.log("Hello World!");');

      // Perform the copy operation
      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      // Validate the destination contents
      expect(existsSync(join(destDirectory, 'file.txt'))).toBe(true);
      expect(existsSync(join(destDirectory, 'subdir', 'file.js'))).toBe(true);
    });

    it('should copy files excluding multiple patterns', () => {
      const srcDirectory = join(tmpDir, 'src');
      const destDirectory = join(tmpDir, 'dest');
      const excludePatterns = ['*.txt', '*.js'];

      writeFileSync(join(srcDirectory, 'file.txt'), 'Hello World!');
      writeFileSync(join(srcDirectory, 'file.js'), 'console.log("Hello World!");');
      writeFileSync(join(srcDirectory, 'file.md'), 'This is a markdown file.');

      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      expect(existsSync(join(destDirectory, 'file.txt'))).toBe(false);
      expect(existsSync(join(destDirectory, 'file.js'))).toBe(false);
      expect(existsSync(join(destDirectory, 'file.md'))).toBe(true);
    });

    it('should handle copying from an empty directory', () => {
      const srcDirectory = join(tmpDir, 'src');
      const destDirectory = join(tmpDir, 'dest');
      const excludePatterns = ['*.txt'];

      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      // Validate that the destination directory is still empty
      expect(readdirSync(destDirectory).length).toBe(0);
    });

    it('should throw an error if the source directory does not exist', () => {
      const nonExistentSrcDirectory = join(tmpDir, 'non-existent-src');
      const destDirectory = join(tmpDir, 'dest');
      const excludePatterns = ['*.txt'];

      expect(() => {
        copyModuleContents(nonExistentSrcDirectory, destDirectory, excludePatterns);
      }).toThrow(); // Assuming your implementation throws an error for non-existent directories
    });

    it('should copy files that do not match any exclusion patterns', () => {
      const srcDirectory = join(tmpDir, 'src');
      const destDirectory = join(tmpDir, 'dest');
      const excludePatterns = ['*.js'];

      writeFileSync(join(srcDirectory, 'file.txt'), 'Hello World!');
      writeFileSync(join(srcDirectory, 'file.js'), 'console.log("Hello World!");');

      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      expect(existsSync(join(destDirectory, 'file.txt'))).toBe(true);
      expect(existsSync(join(destDirectory, 'file.js'))).toBe(false);
    });

    it('should overwrite files in the destination if they have the same name and do not match exclusion patterns', () => {
      const srcDirectory = join(tmpDir, 'src');
      const destDirectory = join(tmpDir, 'dest');
      const excludePatterns: string[] = [];

      writeFileSync(join(srcDirectory, 'file.txt'), 'Hello World from source!');
      writeFileSync(join(destDirectory, 'file.txt'), 'Hello World from destination!');

      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      const destContent = readFileSync(join(destDirectory, 'file.txt'), 'utf-8');
      expect(destContent).toBe('Hello World from source!');
    });
  });

  describe('removeDirectoryContents()', () => {
    it('should remove directory contents except for specified exceptions', () => {
      const directory = join(tmpDir, 'dir');
      const exceptions = ['file.txt'];

      mkdirSync(directory);
      writeFileSync(join(directory, 'file.txt'), 'Hello World!');
      writeFileSync(join(directory, 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory, exceptions);

      expect(existsSync(join(directory, 'file.txt'))).toBe(true);
      expect(existsSync(join(directory, 'file.js'))).toBe(false);
    });

    it('should handle recursive directory removal', () => {
      const directory = join(tmpDir, 'dir');
      const exceptions: string[] = [];

      mkdirSync(directory);
      mkdirSync(join(directory, 'subdir'));
      writeFileSync(join(directory, 'file.txt'), 'Hello World!');
      writeFileSync(join(directory, 'subdir', 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory, exceptions);

      expect(existsSync(join(directory, 'file.txt'))).toBe(false);
      expect(existsSync(join(directory, 'subdir', 'file.js'))).toBe(false);
    });

    it('should handle exceptions correctly', () => {
      const directory = join(tmpDir, 'dir');
      const exceptions = ['file.txt', 'subdir'];

      mkdirSync(directory);
      mkdirSync(join(directory, 'subdir'));
      writeFileSync(join(directory, 'file.txt'), 'Hello World!');
      writeFileSync(join(directory, 'file.js'), 'console.log("Hello World!");');
      writeFileSync(join(directory, 'subdir', 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory, exceptions);

      expect(existsSync(join(directory, 'file.txt'))).toBe(true);
      expect(existsSync(join(directory, 'file.js'))).toBe(false);
      expect(existsSync(join(directory, 'subdir', 'file.js'))).toBe(true);
    });

    it('should handle an empty directory', () => {
      const directory = join(tmpDir, 'dir');
      const exceptions: string[] = [];

      mkdirSync(directory); // Create an empty directory
      removeDirectoryContents(directory, exceptions);

      // Validate that the directory is still empty
      expect(readdirSync(directory).length).toBe(0);
    });

    it('should not remove if only exceptions are present', () => {
      const directory = join(tmpDir, 'dir');
      const exceptions = ['file.txt'];

      mkdirSync(directory);
      writeFileSync(join(directory, 'file.txt'), 'Hello World!');

      removeDirectoryContents(directory, exceptions);

      expect(existsSync(join(directory, 'file.txt'))).toBe(true);
      expect(readdirSync(directory).length).toBe(1); // Only the exception should exist
    });

    it('should handle nested exceptions correctly', () => {
      const directory = join(tmpDir, 'dir');
      const exceptions = ['subdir'];

      mkdirSync(directory);
      mkdirSync(join(directory, 'subdir'));
      writeFileSync(join(directory, 'file.txt'), 'Hello World!');
      writeFileSync(join(directory, 'subdir', 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory, exceptions);

      expect(existsSync(join(directory, 'subdir'))).toBe(true);
      expect(existsSync(join(directory, 'file.txt'))).toBe(false);
      expect(existsSync(join(directory, 'subdir', 'file.js'))).toBe(true);
    });

    it('should not throw an error if the directory does not exist', () => {
      const nonExistentDirectory = join(tmpDir, 'non-existent-dir');
      const exceptions = ['file.txt'];

      expect(() => {
        removeDirectoryContents(nonExistentDirectory, exceptions);
      }).not.toThrow(); // Ensure no error is thrown
    });

    it('should handle exceptions that do not exist in the directory', () => {
      const directory = join(tmpDir, 'dir');
      const exceptions = ['file.txt'];

      mkdirSync(directory);
      writeFileSync(join(directory, 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory, exceptions);

      expect(existsSync(join(directory, 'file.js'))).toBe(false);
    });

    it('should remove directory contents when no exceptions specified', () => {
      const directory = join(tmpDir, 'dir');

      mkdirSync(directory);
      writeFileSync(join(directory, 'file.txt'), 'Hello World!');
      writeFileSync(join(directory, 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory);

      expect(existsSync(join(directory, 'file.txt'))).toBe(false);
      expect(existsSync(join(directory, 'file.js'))).toBe(false);
    });
  });
});