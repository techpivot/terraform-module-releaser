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

      expect(vi.mocked(info).mock.calls).toEqual([
        ['Parsing commit xyz789: docs: variables update (Changed Files = 1)'],
        [`Analyzing file: ${moduleDir}/variables.tf`],
        ['Finished analyzing directory tree, terraform modules, and commits'],
        ['Found 1 terraform module.'],
        ['Found 1 changed Terraform module.'],
      ]);
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

      expect(modules).toHaveLength(2); // Length of our mock modules
      expect(startGroup).toHaveBeenCalledWith('Finding all Terraform modules with corresponding changes');
      expect(endGroup).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledWith(expect.stringMatching(/Found 2 terraform modules/));

      expect(modules).toStrictEqual([
        {
          moduleName: 'tf-modules/s3-bucket-object',
          directory: `${workspaceDir}/tf-modules/s3-bucket-object`,
          latestTag: 'tf-modules/s3-bucket-object/v0.1.0',
          latestTagVersion: 'v0.1.0',
          tags: ['tf-modules/s3-bucket-object/v0.1.0'],
          releases: [],
        },
        {
          moduleName: 'tf-modules/vpc-endpoint',
          directory: `${workspaceDir}/tf-modules/vpc-endpoint`,
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
        },
      ]);
    });

    it('should handle modules with no changes', () => {
      const noChangeCommits: CommitDetails[] = [];
      const modules = getAllTerraformModules(noChangeCommits, mockTags, mockReleases);
      expect(modules).toHaveLength(2);
      for (const module of modules) {
        expect('isChanged' in module).toBe(false);
        expect(module.latestTag).toBeDefined();
        expect(module.latestTagVersion).toBeDefined();
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
      const modules = getAllTerraformModules(commitsWithExcludedFiles, mockTags, mockReleases);
      expect(modules).toHaveLength(2);
      for (const module of modules) {
        if (module.moduleName === 'tf-modules/vpc-endpoint') {
          expect('isChanged' in module).toBe(false);
          break;
        }
      }
      expect(info).toHaveBeenCalledWith(
        expect.stringContaining(
          'Excluding module "tf-modules/vpc-endpoint" match from "tf-modules/vpc-endpoint/README.md" due to exclude pattern match.',
        ),
      );
      expect(vi.mocked(info).mock.calls).toEqual([
        ['Parsing commit xyz789: docs: update readme (Changed Files = 1)'],
        ['Analyzing file: tf-modules/vpc-endpoint/README.md'],
        [
          'Excluding module "tf-modules/vpc-endpoint" match from "tf-modules/vpc-endpoint/README.md" due to exclude pattern match.',
        ],
        ['Finished analyzing directory tree, terraform modules, and commits'],
        ['Found 2 terraform modules.'],
        ['Found 0 changed Terraform modules.'],
      ]);
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
      expect(modules).toHaveLength(2);
      for (const module of modules) {
        if (module.moduleName === 'tf-modules/vpc-endpoint') {
          expect('isChanged' in module).toBe(true);
        }
      }
      expect(info).toHaveBeenCalledWith(
        expect.stringContaining(
          'Excluding module "tf-modules/vpc-endpoint" match from "tf-modules/vpc-endpoint/README.md" due to exclude pattern match.',
        ),
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
