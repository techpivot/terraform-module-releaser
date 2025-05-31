import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '@/mocks/config';
import { context } from '@/mocks/context';
import {
  getAllTerraformModules,
  getTerraformChangedModules,
  getTerraformModulesToRemove,
  isChangedModule,
} from '@/terraform-module';
import type { CommitDetails, GitHubRelease, TerraformChangedModule, TerraformModule } from '@/types';
import { endGroup, info, startGroup } from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('terraform-module', () => {
  describe('isChangedModule()', () => {
    it('should identify changed terraform modules correctly', () => {
      const changedModule: TerraformChangedModule = {
        moduleName: 'test-module',
        directory: '/workspace/test-module',
        tags: ['v1.0.0'],
        releases: [],
        latestTag: 'test-module/v1.0.0',
        latestTagVersion: 'v1.0.0',
        isChanged: true,
        commitMessages: ['feat: new feature'],
        releaseType: 'minor',
        nextTag: 'test-module/v1.1.0',
        nextTagVersion: 'v1.1.0',
      };

      const unchangedModule: TerraformModule = {
        moduleName: 'test-module-2',
        directory: '/workspace/test-module-2',
        tags: ['v1.0.0'],
        releases: [],
        latestTag: 'test-module-2/v1.0.0',
        latestTagVersion: 'v1.0.0',
      };

      const notQuiteChangedModule = {
        ...unchangedModule,
        isChanged: false,
      };

      expect(isChangedModule(changedModule)).toBe(true);
      expect(isChangedModule(unchangedModule)).toBe(false);
      expect(isChangedModule(notQuiteChangedModule)).toBe(false);
    });
  });

  describe('getTerraformChangedModules()', () => {
    it('should filter and return only changed modules', () => {
      const modules: (TerraformModule | TerraformChangedModule)[] = [
        {
          moduleName: 'module1',
          directory: '/workspace/module1',
          tags: ['v1.0.0'],
          releases: [],
          latestTag: 'module1/v1.0.0',
          latestTagVersion: 'v1.0.0',
        },
        {
          moduleName: 'module2',
          directory: '/workspace/module2',
          tags: ['v0.1.0'],
          releases: [],
          latestTag: 'module2/v0.1.0',
          latestTagVersion: 'v0.1.0',
          isChanged: true,
          commitMessages: ['fix: minor bug'],
          releaseType: 'patch',
          nextTag: 'module2/v0.1.1',
          nextTagVersion: 'v0.1.1',
        },
      ];

      const changedModules = getTerraformChangedModules(modules);

      expect(changedModules).toHaveLength(1);
      expect(changedModules[0].moduleName).toBe('module2');
      expect(changedModules[0].isChanged).toBe(true);
    });
  });

  describe('getAllTerraformModules() - with temporary directory', () => {
    let tmpDir: string;
    let moduleDir: string;

    beforeEach(() => {
      // Create a temporary directory with a random suffix
      tmpDir = mkdtempSync(join(tmpdir(), 'terraform-test-'));

      // Create the module directory structure
      moduleDir = join(tmpDir, 'tf-modules', 'test-module');
      mkdirSync(moduleDir, { recursive: true });

      // Create a main.tf file in the module directory
      const mainTfContent = `
        resource "aws_s3_bucket" "test" {
          bucket = "test-bucket"
        }
      `;
      writeFileSync(join(moduleDir, 'variables.tf'), mainTfContent);

      context.set({
        workspaceDir: tmpDir,
      });
    });

    afterEach(() => {
      // Clean up the temporary directory and all its contents
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should handle single module with no changes', () => {
      const mockCommits: CommitDetails[] = [
        {
          message: 'docs: variables update',
          sha: 'xyz789',
          files: [`${moduleDir}/variables.tf`], // testing with absolute path which works also
        },
      ];
      const mockTags: string[] = ['tf-modules/test-module/v1.0.0'];
      const mockReleases: GitHubRelease[] = [];

      config.set({ moduleChangeExcludePatterns: ['*.md'] });

      const modules = getAllTerraformModules(mockCommits, mockTags, mockReleases);

      expect(modules).toHaveLength(1);
      expect(modules[0].moduleName).toBe('tf-modules/test-module');
      expect('isChanged' in modules[0]).toBe(true);

      // Just check that the important logs were called without checking all logs
      expect(vi.mocked(info)).toHaveBeenCalledWith('Parsing commit xyz789: docs: variables update (Changed Files = 1)');
      expect(vi.mocked(info)).toHaveBeenCalledWith(`Analyzing file: ${moduleDir}/variables.tf`);
      expect(vi.mocked(info)).toHaveBeenCalledWith('Finished analyzing directory tree, terraform modules, and commits');
      expect(vi.mocked(info)).toHaveBeenCalledWith('Found 1 terraform module.');
      expect(vi.mocked(info)).toHaveBeenCalledWith('Found 1 changed Terraform module.');
    });
  });

  describe('getAllTerraformModules', () => {
    const workspaceDir = process.cwd();

    // Type-safe mock data
    const mockCommits: CommitDetails[] = [
      {
        message: 'feat: new feature\n\nBREAKING CHANGE: major update',
        sha: 'abc123',
        files: ['tf-modules/vpc-endpoint/main.tf', 'tf-modules/vpc-endpoint/variables.tf'],
      },
    ];

    const mockTags: string[] = [
      'tf-modules/vpc-endpoint/v1.0.0',
      'tf-modules/vpc-endpoint/v1.1.0',
      'tf-modules/s3-bucket-object/v0.1.0',
      'tf-modules/test/v1.0.0',
    ];

    const mockReleases: GitHubRelease[] = [
      {
        id: 1,
        title: 'tf-modules/vpc-endpoint/v1.0.0',
        tagName: 'tf-modules/vpc-endpoint/v1.0.0',
        body: 'Initial release',
      },
    ];

    beforeEach(() => {
      context.set({
        workspaceDir,
      });
    });

    it('should identify terraform modules and track their changes', () => {
      const modules = getAllTerraformModules(mockCommits, mockTags, mockReleases);

      expect(modules.length).toBeGreaterThan(0);
      expect(startGroup).toHaveBeenCalledWith('Finding all Terraform modules with corresponding changes');
      expect(endGroup).toHaveBeenCalledTimes(1);
      // Use a general matcher for flexible module count as the codebase may have local modules
      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringMatching(/Found \d+ terraform modules./));

      // Find the specific modules we're looking for
      const s3Module = modules.find((m) => m.moduleName === 'tf-modules/s3-bucket-object');
      const vpcModule = modules.find((m) => m.moduleName === 'tf-modules/vpc-endpoint');

      expect(s3Module).toBeDefined();
      expect(vpcModule).toBeDefined();

      expect(s3Module).toMatchObject({
        moduleName: 'tf-modules/s3-bucket-object',
        directory: expect.stringContaining('tf-modules/s3-bucket-object'),
        latestTag: 'tf-modules/s3-bucket-object/v0.1.0',
        latestTagVersion: 'v0.1.0',
        tags: ['tf-modules/s3-bucket-object/v0.1.0'],
        releases: [],
      });

      expect(vpcModule).toMatchObject({
        moduleName: 'tf-modules/vpc-endpoint',
        directory: expect.stringContaining('tf-modules/vpc-endpoint'),
        latestTag: 'tf-modules/vpc-endpoint/v1.1.0',
        latestTagVersion: 'v1.1.0',
        tags: ['tf-modules/vpc-endpoint/v1.1.0', 'tf-modules/vpc-endpoint/v1.0.0'],
        releases: [
          {
            id: 1,
            title: 'tf-modules/vpc-endpoint/v1.0.0',
            tagName: 'tf-modules/vpc-endpoint/v1.0.0',
            body: 'Initial release',
          },
        ],
        isChanged: true,
        commitMessages: ['feat: new feature\n\nBREAKING CHANGE: major update'],
        releaseType: 'major',
        nextTag: 'tf-modules/vpc-endpoint/v2.0.0',
        nextTagVersion: 'v2.0.0',
      });
    });

    it('should handle modules with no changes', () => {
      const noChangeCommits: CommitDetails[] = [];
      const modules = getAllTerraformModules(noChangeCommits, mockTags, mockReleases);

      // Instead of checking the exact count, check that we have at least the 2 modules we expect
      const s3Module = modules.find((m) => m.moduleName === 'tf-modules/s3-bucket-object');
      const vpcModule = modules.find((m) => m.moduleName === 'tf-modules/vpc-endpoint');

      expect(s3Module).toBeDefined();
      expect(vpcModule).toBeDefined();

      // Check the s3 module specifically
      if (s3Module) {
        expect('isChanged' in s3Module).toBe(false);
        expect(s3Module.latestTag).toBeDefined();
        expect(s3Module.latestTagVersion).toBeDefined();
      }
      // Check the vpc module specifically
      if (vpcModule) {
        expect('isChanged' in vpcModule).toBe(false);
        expect(vpcModule.latestTag).toBeDefined();
        expect(vpcModule.latestTagVersion).toBeDefined();
      }
    });

    it('should handle excluded files based on patterns', () => {
      const commitsWithExcludedFiles: CommitDetails[] = [
        {
          message: 'docs: update readme',
          sha: 'xyz789',
          files: ['tf-modules/vpc-endpoint/README.md'],
        },
      ];
      config.set({ moduleChangeExcludePatterns: ['*.md'] });

      // Ensure vpc-endpoint has tags so it's not auto-marked as changed due to initial release logic
      // This is already covered by mockTags which includes vpc-endpoint tags
      const modules = getAllTerraformModules(commitsWithExcludedFiles, mockTags, mockReleases);

      const vpcModule = modules.find((m) => m.moduleName === 'tf-modules/vpc-endpoint');
      expect(vpcModule).toBeDefined();
      // Fix: Remove the non-null assertion and check if vpcModule exists first
      if (vpcModule) {
        expect('isChanged' in vpcModule).toBe(false);
      }

      // Check for specific log messages without checking the full array
      expect(vi.mocked(info)).toHaveBeenCalledWith('Parsing commit xyz789: docs: update readme (Changed Files = 1)');
      expect(vi.mocked(info)).toHaveBeenCalledWith('Analyzing file: tf-modules/vpc-endpoint/README.md');
      expect(vi.mocked(info)).toHaveBeenCalledWith(
        '  (skipping) ➜ Matches module-change-exclude-pattern for path `tf-modules/vpc-endpoint`',
      );
      expect(vi.mocked(info)).toHaveBeenCalledWith('Finished analyzing directory tree, terraform modules, and commits');
      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringMatching(/Found \d+ terraform modules./));
      expect(vi.mocked(info)).toHaveBeenCalledWith(
        `Marking module 'tf-modules/kms' for initial release (no existing tags found)`,
      );
      expect(vi.mocked(info)).toHaveBeenCalledWith('Found 1 changed Terraform module.');
    });

    it('should handle excluded files based on patterns and changed terraform-files', () => {
      const commitsWithExcludedFiles: CommitDetails[] = [
        {
          message: 'docs: update readme',
          sha: 'xyz789',
          files: ['tf-modules/vpc-endpoint/README.md', 'tf-modules/vpc-endpoint/main.tf'],
        },
      ];
      config.set({ moduleChangeExcludePatterns: ['*.md'] });
      const modules = getAllTerraformModules(commitsWithExcludedFiles, mockTags, mockReleases);
      expect(modules).toHaveLength(3);
      for (const module of modules) {
        if (module.moduleName === 'tf-modules/vpc-endpoint') {
          expect('isChanged' in module).toBe(true);
        }
      }
      expect(info).toHaveBeenCalledWith(
        '  (skipping) ➜ Matches module-change-exclude-pattern for path `tf-modules/vpc-endpoint`',
      );
    });

    it('should properly sort releases in descending order for modules', () => {
      const mockCommits: CommitDetails[] = [
        {
          message: 'feat: update module',
          sha: 'abc123',
          files: ['tf-modules/vpc-endpoint/main.tf'],
        },
      ];

      const mockTags: string[] = [
        'tf-modules/vpc-endpoint/v1.0.0',
        'tf-modules/vpc-endpoint/v1.1.0',
        'tf-modules/vpc-endpoint/v2.0.0',
      ];

      // Deliberately provide releases in incorrect version order
      const mockReleases: GitHubRelease[] = [
        {
          id: 1,
          title: 'tf-modules/vpc-endpoint/v1.0.0',
          tagName: 'tf-modules/vpc-endpoint/v1.0.0',
          body: 'Initial release',
        },
        {
          id: 3,
          title: 'tf-modules/vpc-endpoint/v2.0.0',
          tagName: 'tf-modules/vpc-endpoint/v2.0.0',
          body: 'Major release',
        },
        {
          id: 2,
          title: 'tf-modules/vpc-endpoint/v1.1.0',
          tagName: 'tf-modules/vpc-endpoint/v1.1.0',
          body: 'Feature update',
        },
      ];

      const modules = getAllTerraformModules(mockCommits, mockTags, mockReleases);

      // Find the vpc-endpoint module
      const vpcModule = modules.find((module) => module.moduleName === 'tf-modules/vpc-endpoint');
      expect(vpcModule).toBeDefined();
      expect(vpcModule?.releases).toHaveLength(3);

      // Verify releases are properly sorted in descending order
      expect(vpcModule?.releases[0].title).toBe('tf-modules/vpc-endpoint/v2.0.0');
      expect(vpcModule?.releases[1].title).toBe('tf-modules/vpc-endpoint/v1.1.0');
      expect(vpcModule?.releases[2].title).toBe('tf-modules/vpc-endpoint/v1.0.0');
    });

    it('should skip files not associated with any terraform module', () => {
      const commits: CommitDetails[] = [
        {
          message: 'root level file change',
          sha: 'root23452',
          files: ['main.tf'],
        },
      ];
      getAllTerraformModules(commits, mockTags, mockReleases);
      expect(info).toHaveBeenCalledWith('Analyzing file: main.tf');
    });

    it('should handle nested terraform modules', () => {
      config.set({ moduleChangeExcludePatterns: [] });
      const nestedModuleCommit: CommitDetails[] = [
        {
          message: 'feat: update nested module',
          sha: 'nested123',
          files: ['tf-modules/s3-bucket-object/tests/README.md'],
        },
      ];

      const modules = getAllTerraformModules(nestedModuleCommit, mockTags, mockReleases);

      for (const module of modules) {
        if (module.moduleName === 'tf-modules/s3-bucket-object') {
          expect('isChanged' in module).toBe(true);
          break;
        }
      }
    });

    it('should handle modulePathIgnore patterns when processing changed files', () => {
      // Set up a modulePathIgnore pattern
      config.set({
        modulePathIgnore: ['**/examples/**'],
        moduleChangeExcludePatterns: [],
      });

      const commitsWithIgnoredPath: CommitDetails[] = [
        {
          message: 'feat: update example',
          sha: 'example123',
          files: ['tf-modules/kms/examples/complete/main.tf'],
        },
      ];

      // Add a tag for the kms module to prevent it from being auto-marked as changed for initial release
      const tagsWithKms = [...mockTags, 'tf-modules/kms/v1.0.0'];

      const modules = getAllTerraformModules(commitsWithIgnoredPath, tagsWithKms, mockReleases);

      // The module shouldn't be marked as changed even though there are changes in the examples directory
      const kmsModule = modules.find((m) => m.moduleName === 'tf-modules/kms');
      expect(kmsModule).toBeDefined();
      if (kmsModule) {
        expect('isChanged' in kmsModule).toBe(false);
      }

      // Verify the ignore message was logged
      expect(info).toHaveBeenCalledWith(
        '  (skipping) ➜ Matches module-path-ignore pattern for path `tf-modules/kms/examples/complete`',
      );
    });

    it('should respect modulePathIgnore for multiple patterns', () => {
      // Set multiple ignore patterns
      config.set({
        modulePathIgnore: ['**/examples/**', '**/test/**', '**/docs/**'],
        moduleChangeExcludePatterns: [],
      });

      const commitsWithMultipleIgnoredPaths: CommitDetails[] = [
        {
          message: 'docs: update documentation',
          sha: 'multiple123',
          files: [
            'tf-modules/kms/examples/complete/main.tf', // exists
            'tf-modules/kms/examples/test.tf', // non-existent
            'tf-modules/vpc-endpoint/docs/README.md',
            'tf-modules/vpc-endpoint/main.tf', // This file should still trigger a change
          ],
        },
      ];

      const modules = getAllTerraformModules(commitsWithMultipleIgnoredPaths, mockTags, mockReleases);

      expect(modules.length).toBe(3);

      // The module should be marked as changed due to main.tf, despite the other ignored files
      const vpcModule = modules.find((m) => m.moduleName === 'tf-modules/vpc-endpoint');
      expect(vpcModule).toBeDefined();
      if (vpcModule) {
        expect('isChanged' in vpcModule).toBe(true);
      }

      // Verify the ignore messages were logged for each ignored path
      expect(info).toHaveBeenCalledWith(
        '  (skipping) ➜ Matches module-path-ignore pattern for path `tf-modules/kms/examples/complete`',
      );
    });

    describe('getAllTerraformModules', () => {
      it('should sort module releases correctly by semantic version', () => {
        const moduleName = 'tf-modules/vpc-endpoint';
        const commits: CommitDetails[] = [];
        const tags = [
          `${moduleName}/v1.0.0`,
          `${moduleName}/v2.0.0`,
          `${moduleName}/v2.1.0`,
          `${moduleName}/v2.2.0`,
          `${moduleName}/v2.2.1`,
          `${moduleName}/v2.2.2`,
        ];

        const releases: GitHubRelease[] = [
          {
            id: 1,
            title: `${moduleName}/v1.0.0`,
            tagName: `${moduleName}/v1.0.0`,
            body: 'Initial release',
          },
          {
            id: 4,
            title: `${moduleName}/v2.2.0`,
            tagName: `${moduleName}/v2.2.0`,
            body: 'Another minor release',
          },
          {
            id: 2,
            title: `${moduleName}/v2.0.0`,
            tagName: `${moduleName}/v2.0.0`,
            body: 'Major release',
          },
          {
            id: 6,
            title: `${moduleName}/v2.2.2`,
            tagName: `${moduleName}/v2.2.2`,
            body: 'Another patch release',
          },
          {
            id: 3,
            title: `${moduleName}/v2.1.0`,
            tagName: `${moduleName}/v2.1.0`,
            body: 'Minor release',
          },
          {
            id: 5,
            title: `${moduleName}/v2.2.1`,
            tagName: `${moduleName}/v2.2.1`,
            body: 'Patch release',
          },
        ];

        const modules = getAllTerraformModules(commits, tags, releases);
        const testModule = modules.find((m) => m.moduleName === moduleName);

        expect(testModule).toBeDefined();
        expect(testModule?.releases.map((r) => r.title)).toEqual([
          `${moduleName}/v2.2.2`,
          `${moduleName}/v2.2.1`,
          `${moduleName}/v2.2.0`,
          `${moduleName}/v2.1.0`,
          `${moduleName}/v2.0.0`,
          `${moduleName}/v1.0.0`,
        ]);
      });
    });
  });

  describe('getTerraformModulesToRemove()', () => {
    it('should identify modules to remove', () => {
      const existingModules: TerraformModule[] = [
        {
          moduleName: 'module1',
          directory: '/workspace/module1',
          tags: ['module1/v1.0.0', 'module1/v1.1.0'],
          releases: [],
          latestTag: 'module1/v1.1.0',
          latestTagVersion: 'v1.1.0',
        },
      ];
      const mockTags = ['module1/v1.0.0', 'module1/v1.1.0', 'module2/v1.0.0', 'module3/v1.0.0'];

      const modulesToRemove = getTerraformModulesToRemove(mockTags, existingModules);

      expect(modulesToRemove).toHaveLength(2);
      expect(modulesToRemove).toContain('module2');
      expect(modulesToRemove).toContain('module3');
      expect(startGroup).toHaveBeenCalledWith('Finding all Terraform modules that should be removed');
    });

    it('should handle empty tags list', () => {
      const modulesToRemove = getTerraformModulesToRemove([], []);
      expect(modulesToRemove).toHaveLength(0);
    });

    it('should handle case with no modules to remove', () => {
      const existingModules: TerraformModule[] = [
        {
          moduleName: 'module1',
          directory: '/workspace/module1',
          tags: ['v1.0.0'],
          releases: [],
          latestTag: 'module1/v1.0.0',
          latestTagVersion: 'v1.0.0',
        },
        {
          moduleName: 'module2',
          directory: '/workspace/module2',
          tags: ['v0.1.0'],
          releases: [],
          latestTag: 'module2/v0.1.0',
          latestTagVersion: 'v0.1.0',
        },
      ];

      const tagsWithNoExtras = ['module1/v1.0.0', 'module2/v0.1.0'];

      const modulesToRemove = getTerraformModulesToRemove(tagsWithNoExtras, existingModules);
      expect(modulesToRemove).toHaveLength(0);
    });
  });
});
