import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { copyModuleContents, removeDirectoryContents, shouldExcludeFile } from '../src/file-util';

describe('file-util.ts', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory before each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dir-'));
  });

  afterEach(() => {
    // Remove temporary directory
    fs.rmSync(tempDir, { recursive: true });
  });

  describe('shouldExcludeFile', () => {
    it('should exclude file when pattern matches', () => {
      const baseDirectory = tempDir;
      const filePath = path.join(tempDir, 'file.txt');
      const excludePatterns = ['*.txt'];

      expect(shouldExcludeFile(baseDirectory, filePath, excludePatterns)).toBe(true);
    });

    it('should not exclude file when pattern does not match', () => {
      const baseDirectory = tempDir;
      const filePath = path.join(tempDir, 'file.txt');
      const excludePatterns = ['*.js'];

      expect(shouldExcludeFile(baseDirectory, filePath, excludePatterns)).toBe(false);
    });

    it('should handle relative paths correctly', () => {
      const baseDirectory = tempDir;
      const filePath = path.join(tempDir, 'subdir', 'file.txt');
      const excludePatterns = ['subdir/*.txt'];

      expect(shouldExcludeFile(baseDirectory, filePath, excludePatterns)).toBe(true);
    });

    it('should handle exclusion pattern: *.md', () => {
      const baseDirectory = tempDir;
      const filePath1 = path.join(tempDir, 'README.md');
      const filePath2 = path.join(tempDir, 'nested', 'README.md');
      const excludePatterns = ['*.md'];

      expect(shouldExcludeFile(baseDirectory, filePath1, excludePatterns)).toBe(true);
      expect(shouldExcludeFile(baseDirectory, filePath2, excludePatterns)).toBe(true);
    });

    it('should handle exclusion pattern: **/*.md', () => {
      const baseDirectory = tempDir;
      const filePath1 = path.join(tempDir, 'README.md');
      const filePath2 = path.join(tempDir, 'nested', 'README.md');
      const excludePatterns = ['**/*.md'];

      expect(shouldExcludeFile(baseDirectory, filePath1, excludePatterns)).toBe(true);
      expect(shouldExcludeFile(baseDirectory, filePath2, excludePatterns)).toBe(true);
    });

    it('should handle exclusion pattern: tests/**', () => {
      const baseDirectory = tempDir;
      const filePath1 = path.join(tempDir, 'tests/config.test.ts');
      const filePath2 = path.join(tempDir, 'tests2/config.test.ts');
      const filePath3 = path.join(tempDir, 'tests2/tests/config.test.ts');
      const excludePatterns = ['tests/**'];

      expect(shouldExcludeFile(baseDirectory, filePath1, excludePatterns)).toBe(true);
      expect(shouldExcludeFile(baseDirectory, filePath2, excludePatterns)).toBe(false);
      expect(shouldExcludeFile(baseDirectory, filePath3, excludePatterns)).toBe(false);
    });

    it('should handle exclusion pattern: **/tests/**', () => {
      const baseDirectory = tempDir;
      const filePath1 = path.join(tempDir, 'tests/config.test.ts');
      const filePath2 = path.join(tempDir, 'tests2/config.test.ts');
      const filePath3 = path.join(tempDir, 'tests2/tests/config.test.ts');
      const excludePatterns = ['**/tests/**'];

      expect(shouldExcludeFile(baseDirectory, filePath1, excludePatterns)).toBe(true);
      expect(shouldExcludeFile(baseDirectory, filePath2, excludePatterns)).toBe(false);
      expect(shouldExcludeFile(baseDirectory, filePath3, excludePatterns)).toBe(true);
    });
  });

  describe('copyModuleContents', () => {
    beforeEach(() => {
      // Create src and dest directories for every test in this suite
      fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'dest'), { recursive: true });
    });

    it('should copy directory contents excluding files that match patterns', () => {
      const srcDirectory = path.join(tempDir, 'src');
      const destDirectory = path.join(tempDir, 'dest');
      const excludePatterns = ['*.txt'];

      // Create files in src directory
      fs.writeFileSync(path.join(srcDirectory, 'file.txt'), 'Hello World!');
      fs.writeFileSync(path.join(srcDirectory, 'file.js'), 'console.log("Hello World!");');

      // Now perform the copy operation
      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      // Check that the file was copied
      expect(fs.existsSync(path.join(destDirectory, 'file.txt'))).toBe(false);
      expect(fs.existsSync(path.join(destDirectory, 'file.js'))).toBe(true);
    });

    it('should handle recursive directory copying', () => {
      const srcDirectory = path.join(tempDir, 'src');
      const destDirectory = path.join(tempDir, 'dest');
      const excludePatterns: string[] = [];

      // Create source structure
      fs.mkdirSync(path.join(srcDirectory, 'subdir'), { recursive: true });
      fs.writeFileSync(path.join(srcDirectory, 'file.txt'), 'Hello World!');
      fs.writeFileSync(path.join(srcDirectory, 'subdir', 'file.js'), 'console.log("Hello World!");');

      // Perform the copy operation
      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      // Validate the destination contents
      expect(fs.existsSync(path.join(destDirectory, 'file.txt'))).toBe(true);
      expect(fs.existsSync(path.join(destDirectory, 'subdir', 'file.js'))).toBe(true);
    });

    it('should copy files excluding multiple patterns', () => {
      const srcDirectory = path.join(tempDir, 'src');
      const destDirectory = path.join(tempDir, 'dest');
      const excludePatterns = ['*.txt', '*.js'];

      fs.writeFileSync(path.join(srcDirectory, 'file.txt'), 'Hello World!');
      fs.writeFileSync(path.join(srcDirectory, 'file.js'), 'console.log("Hello World!");');
      fs.writeFileSync(path.join(srcDirectory, 'file.md'), 'This is a markdown file.');

      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      expect(fs.existsSync(path.join(destDirectory, 'file.txt'))).toBe(false);
      expect(fs.existsSync(path.join(destDirectory, 'file.js'))).toBe(false);
      expect(fs.existsSync(path.join(destDirectory, 'file.md'))).toBe(true);
    });

    it('should handle copying from an empty directory', () => {
      const srcDirectory = path.join(tempDir, 'src');
      const destDirectory = path.join(tempDir, 'dest');
      const excludePatterns = ['*.txt'];

      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      // Validate that the destination directory is still empty
      expect(fs.readdirSync(destDirectory).length).toBe(0);
    });

    it('should throw an error if the source directory does not exist', () => {
      const nonExistentSrcDirectory = path.join(tempDir, 'non-existent-src');
      const destDirectory = path.join(tempDir, 'dest');
      const excludePatterns = ['*.txt'];

      expect(() => {
        copyModuleContents(nonExistentSrcDirectory, destDirectory, excludePatterns);
      }).toThrow(); // Assuming your implementation throws an error for non-existent directories
    });

    it('should copy files that do not match any exclusion patterns', () => {
      const srcDirectory = path.join(tempDir, 'src');
      const destDirectory = path.join(tempDir, 'dest');
      const excludePatterns = ['*.js'];

      fs.writeFileSync(path.join(srcDirectory, 'file.txt'), 'Hello World!');
      fs.writeFileSync(path.join(srcDirectory, 'file.js'), 'console.log("Hello World!");');

      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      expect(fs.existsSync(path.join(destDirectory, 'file.txt'))).toBe(true);
      expect(fs.existsSync(path.join(destDirectory, 'file.js'))).toBe(false);
    });

    it('should overwrite files in the destination if they have the same name and do not match exclusion patterns', () => {
      const srcDirectory = path.join(tempDir, 'src');
      const destDirectory = path.join(tempDir, 'dest');
      const excludePatterns: string[] = [];

      fs.writeFileSync(path.join(srcDirectory, 'file.txt'), 'Hello World from source!');
      fs.writeFileSync(path.join(destDirectory, 'file.txt'), 'Hello World from destination!');

      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      const destContent = fs.readFileSync(path.join(destDirectory, 'file.txt'), 'utf-8');
      expect(destContent).toBe('Hello World from source!');
    });
  });

  describe('removeDirectoryContents', () => {
    it('should remove directory contents except for specified exceptions', () => {
      const directory = path.join(tempDir, 'dir');
      const exceptions = ['file.txt'];

      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'file.txt'), 'Hello World!');
      fs.writeFileSync(path.join(directory, 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory, exceptions);

      expect(fs.existsSync(path.join(directory, 'file.txt'))).toBe(true);
      expect(fs.existsSync(path.join(directory, 'file.js'))).toBe(false);
    });

    it('should handle recursive directory removal', () => {
      const directory = path.join(tempDir, 'dir');
      const exceptions: string[] = [];

      fs.mkdirSync(directory);
      fs.mkdirSync(path.join(directory, 'subdir'));
      fs.writeFileSync(path.join(directory, 'file.txt'), 'Hello World!');
      fs.writeFileSync(path.join(directory, 'subdir', 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory, exceptions);

      expect(fs.existsSync(path.join(directory, 'file.txt'))).toBe(false);
      expect(fs.existsSync(path.join(directory, 'subdir', 'file.js'))).toBe(false);
    });

    it('should handle exceptions correctly', () => {
      const directory = path.join(tempDir, 'dir');
      const exceptions = ['file.txt', 'subdir'];

      fs.mkdirSync(directory);
      fs.mkdirSync(path.join(directory, 'subdir'));
      fs.writeFileSync(path.join(directory, 'file.txt'), 'Hello World!');
      fs.writeFileSync(path.join(directory, 'file.js'), 'console.log("Hello World!");');
      fs.writeFileSync(path.join(directory, 'subdir', 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory, exceptions);

      expect(fs.existsSync(path.join(directory, 'file.txt'))).toBe(true);
      expect(fs.existsSync(path.join(directory, 'file.js'))).toBe(false);
      expect(fs.existsSync(path.join(directory, 'subdir', 'file.js'))).toBe(true);
    });

    it('should handle an empty directory', () => {
      const directory = path.join(tempDir, 'dir');
      const exceptions: string[] = [];

      fs.mkdirSync(directory); // Create an empty directory
      removeDirectoryContents(directory, exceptions);

      // Validate that the directory is still empty
      expect(fs.readdirSync(directory).length).toBe(0);
    });

    it('should not remove if only exceptions are present', () => {
      const directory = path.join(tempDir, 'dir');
      const exceptions = ['file.txt'];

      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'file.txt'), 'Hello World!');

      removeDirectoryContents(directory, exceptions);

      expect(fs.existsSync(path.join(directory, 'file.txt'))).toBe(true);
      expect(fs.readdirSync(directory).length).toBe(1); // Only the exception should exist
    });

    it('should handle nested exceptions correctly', () => {
      const directory = path.join(tempDir, 'dir');
      const exceptions = ['subdir'];

      fs.mkdirSync(directory);
      fs.mkdirSync(path.join(directory, 'subdir'));
      fs.writeFileSync(path.join(directory, 'file.txt'), 'Hello World!');
      fs.writeFileSync(path.join(directory, 'subdir', 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory, exceptions);

      expect(fs.existsSync(path.join(directory, 'subdir'))).toBe(true);
      expect(fs.existsSync(path.join(directory, 'file.txt'))).toBe(false);
      expect(fs.existsSync(path.join(directory, 'subdir', 'file.js'))).toBe(true);
    });

    it('should not throw an error if the directory does not exist', () => {
      const nonExistentDirectory = path.join(tempDir, 'non-existent-dir');
      const exceptions = ['file.txt'];

      expect(() => {
        removeDirectoryContents(nonExistentDirectory, exceptions);
      }).not.toThrow(); // Ensure no error is thrown
    });

    it('should handle exceptions that do not exist in the directory', () => {
      const directory = path.join(tempDir, 'dir');
      const exceptions = ['file.txt'];

      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory, exceptions);

      expect(fs.existsSync(path.join(directory, 'file.js'))).toBe(false);
    });

    it('should remove directory contents when no exceptions specified', () => {
      const directory = path.join(tempDir, 'dir');

      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'file.txt'), 'Hello World!');
      fs.writeFileSync(path.join(directory, 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory);

      expect(fs.existsSync(path.join(directory, 'file.txt'))).toBe(false);
      expect(fs.existsSync(path.join(directory, 'file.js'))).toBe(false);
    });
  });
});
