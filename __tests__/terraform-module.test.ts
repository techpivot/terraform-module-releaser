import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '@/mocks/config';
import { context } from '@/mocks/context';
import { TerraformModule } from '@/terraform-module';
import { createMockTerraformModule } from '@/tests/helpers/terraform-module';
import type { CommitDetails, GitHubRelease } from '@/types';
import { RELEASE_REASON, RELEASE_TYPE } from '@/utils/constants';
import { endGroup, info, startGroup } from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('TerraformModule', () => {
  let tmpDir: string;
  let moduleDir: string;

  beforeEach(() => {
    // Create a temporary directory with a random suffix
    tmpDir = mkdtempSync(join(tmpdir(), 'terraform-test-'));
    moduleDir = join(tmpDir, 'tf-modules', 'test-module');
    mkdirSync(moduleDir, { recursive: true });

    // Create a main.tf file in the module directory
    writeFileSync(join(moduleDir, 'main.tf'), 'resource "aws_s3_bucket" "test" { bucket = "test-bucket" }');

    context.set({
      workspaceDir: tmpDir,
    });

    config.set({
      majorKeywords: ['BREAKING CHANGE', 'major change'],
      minorKeywords: ['feat:', 'feature:'],
      defaultFirstTag: 'v0.1.0',
      moduleChangeExcludePatterns: [],
      modulePathIgnore: [],
    });
  });

  afterEach(() => {
    // Clean up the temporary directory and all its contents
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should create a TerraformModule instance with correct properties', () => {
      const module = new TerraformModule(moduleDir);

      expect(module.name).toBe('tf-modules/test-module');
      expect(module.directory).toBe(moduleDir);
      expect(module.commits).toEqual([]);
      expect(module.tags).toEqual([]);
      expect(module.releases).toEqual([]);
    });

    it('should generate correct module name from directory path', () => {
      const specialDir = join(tmpDir, 'complex_module-name.with/chars');
      mkdirSync(specialDir, { recursive: true });

      const module = new TerraformModule(specialDir);
      expect(module.name).toBe('complex_module-name-with/chars');
    });

    it('should handle nested directory paths', () => {
      const nestedDir = join(tmpDir, 'infrastructure', 'modules', 'vpc', 'endpoints');
      mkdirSync(nestedDir, { recursive: true });

      const module = new TerraformModule(nestedDir);
      expect(module.name).toBe('infrastructure/modules/vpc/endpoints');
      expect(module.directory).toBe(nestedDir);
    });

    it('should handle root level modules', () => {
      const rootDir = join(tmpDir, 'simple-module');
      mkdirSync(rootDir, { recursive: true });

      const module = new TerraformModule(rootDir);
      expect(module.name).toBe('simple-module');
      expect(module.directory).toBe(rootDir);
    });

    it('should handle module directory outside workspace directory', () => {
      context.set({
        workspaceDir: '/invalid/root/external',
      });

      const moduleDir = join(tmpDir, 'aws/s3-bucket');

      // Create module with directory outside workspace
      const module = new TerraformModule(moduleDir);

      // Should fall back to using the directory directly instead of relative path
      // because relative() would return '../../../external-module-xxx/aws/bucket'
      expect(module.name).toBe(TerraformModule.getTerraformModuleNameFromRelativePath(moduleDir));
      expect(module.directory).toBe(moduleDir);
    });
  });

  describe('commit management', () => {
    let module: TerraformModule;

    beforeEach(() => {
      module = new TerraformModule(moduleDir);
    });

    it('should add commits and prevent duplicates', () => {
      const commit1: CommitDetails = {
        sha: 'abc123',
        message: 'feat: add feature',
        files: ['main.tf'],
      };
      const commit2: CommitDetails = {
        sha: 'def456',
        message: 'fix: bug fix',
        files: ['variables.tf'],
      };
      const duplicateCommit: CommitDetails = {
        sha: 'abc123',
        message: 'different message', // Same SHA, different message
        files: ['other.tf'],
      };

      module.addCommit(commit1);
      module.addCommit(commit2);
      module.addCommit(duplicateCommit); // Should not be added

      expect(module.commits).toHaveLength(2);
      expect(module.commits[0].sha).toBe('abc123');
      expect(module.commits[0].message).toBe('feat: add feature'); // Original message preserved
      expect(module.commits[1].sha).toBe('def456');
    });

    it('should return commit messages correctly', () => {
      const commits: CommitDetails[] = [
        { sha: 'abc123', message: 'feat: add feature', files: ['main.tf'] },
        { sha: 'def456', message: 'fix: bug fix', files: ['variables.tf'] },
      ];

      for (const commit of commits) {
        module.addCommit(commit);
      }

      expect(module.commitMessages).toEqual(['feat: add feature', 'fix: bug fix']);
    });

    it('should handle commits with same SHA but different content', () => {
      const commit1: CommitDetails = {
        sha: 'abc123',
        message: 'feat: add new feature',
        files: ['main.tf'],
      };

      const commit2: CommitDetails = {
        sha: 'abc123',
        message: 'feat: updated feature',
        files: ['variables.tf'],
      };

      module.addCommit(commit1);
      module.addCommit(commit2);

      expect(module.commits).toHaveLength(1);
      expect(module.commits[0]).toEqual(commit1); // First one wins
    });

    it('should clear all commits when clearCommits is called', () => {
      const commits: CommitDetails[] = [
        { sha: 'abc123', message: 'feat: add feature', files: ['main.tf'] },
        { sha: 'def456', message: 'fix: bug fix', files: ['variables.tf'] },
        { sha: 'ghi789', message: 'docs: update readme', files: ['README.md'] },
      ];

      // Add multiple commits
      for (const commit of commits) {
        module.addCommit(commit);
      }

      expect(module.commits).toHaveLength(3);
      expect(module.commitMessages).toEqual(['feat: add feature', 'fix: bug fix', 'docs: update readme']);

      // Clear all commits
      module.clearCommits();

      expect(module.commits).toHaveLength(0);
      expect(module.commitMessages).toHaveLength(0);
    });

    it('should not fail when clearing commits on an empty module', () => {
      expect(module.commits).toHaveLength(0);

      // Should not throw any error
      expect(() => module.clearCommits()).not.toThrow();

      expect(module.commits).toHaveLength(0);
    });
  });

  describe('tag management', () => {
    let module: TerraformModule;

    beforeEach(() => {
      module = new TerraformModule(moduleDir);
    });

    it('should set and sort tags by semantic version descending', () => {
      const tags = [
        'tf-modules/test-module/v1.0.0',
        'tf-modules/test-module/v2.1.0',
        'tf-modules/test-module/v1.2.0',
        'tf-modules/test-module/v2.0.0',
        'tf-modules/test-module/v1.1.0',
      ];

      module.setTags(tags);

      expect(module.tags).toEqual([
        'tf-modules/test-module/v2.1.0',
        'tf-modules/test-module/v2.0.0',
        'tf-modules/test-module/v1.2.0',
        'tf-modules/test-module/v1.1.0',
        'tf-modules/test-module/v1.0.0',
      ]);
    });

    it('should get latest tag correctly', () => {
      const tags = ['tf-modules/test-module/v1.0.0', 'tf-modules/test-module/v2.0.0', 'tf-modules/test-module/v1.5.0'];

      module.setTags(tags);

      expect(module.getLatestTag()).toBe('tf-modules/test-module/v2.0.0');
    });

    it('should return null for latest tag when no tags exist', () => {
      expect(module.getLatestTag()).toBeNull();
    });

    it('should get latest tag version correctly', () => {
      const tags = ['tf-modules/test-module/v1.0.0', 'tf-modules/test-module/v2.0.0'];

      module.setTags(tags);

      expect(module.getLatestTagVersion()).toBe('v2.0.0');
    });

    it('should return null for latest tag version when no tags exist', () => {
      expect(module.getLatestTagVersion()).toBeNull();
    });

    it('should handle complex version sorting', () => {
      const tags = [
        'tf-modules/test-module/v1.2.10',
        'tf-modules/test-module/v1.2.2',
        'tf-modules/test-module/v1.10.0',
        'tf-modules/test-module/v2.0.0',
        'tf-modules/test-module/v1.2.11',
      ];

      module.setTags(tags);

      expect(module.tags).toEqual([
        'tf-modules/test-module/v2.0.0',
        'tf-modules/test-module/v1.10.0',
        'tf-modules/test-module/v1.2.11',
        'tf-modules/test-module/v1.2.10',
        'tf-modules/test-module/v1.2.2',
      ]);
    });

    it('should handle single tag', () => {
      module.setTags(['tf-modules/test-module/v1.0.0']);

      expect(module.getLatestTag()).toBe('tf-modules/test-module/v1.0.0');
      expect(module.getLatestTagVersion()).toBe('v1.0.0');
    });

    it('should throw error for tag with no slash (invalid format)', () => {
      const tags = ['v1.2.3'];
      expect(() => module.setTags(tags)).toThrow(
        "Invalid tag format: 'v1.2.3'. Expected format: 'tf-modules/test-module/v#.#.#' or 'tf-modules/test-module/#.#.#' for module.",
      );
    });

    it('should throw error for tag with incorrect module name', () => {
      const tags = ['foo/bar/v9.8.7'];
      expect(() => module.setTags(tags)).toThrow(
        "Invalid tag format: 'foo/bar/v9.8.7'. Expected format: 'tf-modules/test-module/v#.#.#' or 'tf-modules/test-module/#.#.#' for module.",
      );
    });

    it('should accept valid tags with v prefix', () => {
      const tags = ['tf-modules/test-module/v1.2.3', 'tf-modules/test-module/v2.0.1'];
      module.setTags(tags);

      expect(module.tags).toHaveLength(2);
      expect(module.tags[0]).toBe('tf-modules/test-module/v2.0.1'); // Sorted descending
      expect(module.tags[1]).toBe('tf-modules/test-module/v1.2.3');
    });

    it('should accept valid tags without v prefix', () => {
      const tags = ['tf-modules/test-module/1.2.3', 'tf-modules/test-module/2.0.1'];
      module.setTags(tags);

      expect(module.tags).toHaveLength(2);
      expect(module.tags[0]).toBe('tf-modules/test-module/2.0.1'); // Sorted descending
      expect(module.tags[1]).toBe('tf-modules/test-module/1.2.3');
    });

    // Add tests for extractVersionFromTag
    describe('extractVersionFromTag()', () => {
      let module: TerraformModule;

      beforeEach(() => {
        module = new TerraformModule(moduleDir);
      });

      it('should handle tags with slashes correctly', () => {
        // Testing through public interface that uses it internally
        module.setTags(['tf-modules/test-module/v1.2.3', 'tf-modules/test-module/v2.0.0']);
        expect(module.tags[0]).toBe('tf-modules/test-module/v2.0.0');
        expect(module.tags[1]).toBe('tf-modules/test-module/v1.2.3');
      });

      it('should handle version string without slashes correctly', () => {
        // Create a module where we can test the version extraction logic
        // Since extractVersionFromTag now validates the full tag format,
        // we need to test it with valid tags that match the module name
        const moduleB = new TerraformModule(join(moduleDir, 'subdir'));
        // @ts-expect-error - Accessing private for testing
        const extractVersionFn = moduleB.extractVersionFromTag.bind(moduleB);

        // Test with valid full tags that match the module name
        expect(extractVersionFn('tf-modules/test-module/subdir/v1.2.3')).toBe('1.2.3');
        expect(extractVersionFn('tf-modules/test-module/subdir/1.2.3')).toBe('1.2.3');
      });
    });

    it('should throw internal error when version lookup fails during tag sorting', () => {
      const tags = ['tf-modules/test-module/v1.0.0', 'tf-modules/test-module/v2.0.0'];

      // Create a spy on tagVersionMap to simulate missing version
      const mapSpy = vi.spyOn(Map.prototype, 'get').mockImplementationOnce(() => undefined);

      expect(() => module.setTags(tags)).toThrow('Internal error: version not found in map');

      // Clean up
      mapSpy.mockRestore();
    });

    it('should throw error for invalid version format during release tag versioning', () => {
      // Set up a tag with valid format first
      module.setTags(['tf-modules/test-module/v1.0.0']);

      // Force the internal latestTagVersion to be invalid
      vi.spyOn(module, 'getLatestTagVersion').mockReturnValue('invalid-format');

      // Add a commit to trigger release tag version calculation
      module.addCommit({
        sha: 'abc123',
        message: 'fix: bug fix',
        files: ['main.tf'],
      });

      expect(() => module.getReleaseTagVersion()).toThrow(
        "Invalid version format: 'invalid-format'. Expected v#.#.# or #.#.# format.",
      );
    });
  });

  describe('release management', () => {
    let module: TerraformModule;

    beforeEach(() => {
      module = new TerraformModule(moduleDir);
    });

    it('should set and sort releases by semantic version descending', () => {
      const releases: GitHubRelease[] = [
        {
          id: 1,
          title: 'tf-modules/test-module/v1.0.0',
          tagName: 'tf-modules/test-module/v1.0.0',
          body: 'Initial release',
        },
        {
          id: 3,
          title: 'tf-modules/test-module/v2.0.0',
          tagName: 'tf-modules/test-module/v2.0.0',
          body: 'Major release',
        },
        {
          id: 2,
          title: 'tf-modules/test-module/v1.1.0',
          tagName: 'tf-modules/test-module/v1.1.0',
          body: 'Minor release',
        },
      ];

      module.setReleases(releases);

      expect(module.releases).toHaveLength(3);
      expect(module.releases[0].title).toBe('tf-modules/test-module/v2.0.0');
      expect(module.releases[1].title).toBe('tf-modules/test-module/v1.1.0');
      expect(module.releases[2].title).toBe('tf-modules/test-module/v1.0.0');
    });

    it('should handle complex version sorting for releases', () => {
      const releases: GitHubRelease[] = [
        {
          id: 1,
          title: 'tf-modules/test-module/v1.2.10',
          tagName: 'tf-modules/test-module/v1.2.10',
          body: 'Patch release 10',
        },
        {
          id: 2,
          title: 'tf-modules/test-module/v1.2.2',
          tagName: 'tf-modules/test-module/v1.2.2',
          body: 'Patch release 2',
        },
        {
          id: 3,
          title: 'tf-modules/test-module/v1.10.0',
          tagName: 'tf-modules/test-module/v1.10.0',
          body: 'Minor release 10',
        },
        {
          id: 4,
          title: 'tf-modules/test-module/v2.0.0',
          tagName: 'tf-modules/test-module/v2.0.0',
          body: 'Major release',
        },
        {
          id: 5,
          title: 'tf-modules/test-module/v1.2.11',
          tagName: 'tf-modules/test-module/v1.2.11',
          body: 'Patch release 11',
        },
        {
          id: 6,
          title: 'tf-modules/test-module/v10.0.0',
          tagName: 'tf-modules/test-module/v10.0.0',
          body: 'Major release 10',
        },
      ];

      module.setReleases(releases);

      // Should be sorted by semantic version (newest first)
      expect(module.releases).toHaveLength(6);
      expect(module.releases.map((r) => r.title)).toEqual([
        'tf-modules/test-module/v10.0.0', // Major 10
        'tf-modules/test-module/v2.0.0', // Major 2
        'tf-modules/test-module/v1.10.0', // Minor 10
        'tf-modules/test-module/v1.2.11', // Patch 11
        'tf-modules/test-module/v1.2.10', // Patch 10
        'tf-modules/test-module/v1.2.2', // Patch 2
      ]);
    });

    it('should throw error for releases with invalid tag formats', () => {
      const releases: GitHubRelease[] = [
        {
          id: 1,
          title: 'tf-modules/test-module/v1.0.0',
          tagName: 'tf-modules/test-module/v1.0.0',
          body: 'Standard version',
        },
        {
          id: 2,
          title: 'tf-modules/test-module/v1.0', // Missing patch version - invalid
          tagName: 'tf-modules/test-module/v1.0',
          body: 'Missing patch',
        },
      ];

      expect(() => module.setReleases(releases)).toThrow(
        "Invalid tag format: 'tf-modules/test-module/v1.0'. Expected format: 'tf-modules/test-module/v#.#.#' or 'tf-modules/test-module/#.#.#' for module.",
      );
    });

    it('should throw error for releases with non-numeric version components', () => {
      const releases: GitHubRelease[] = [
        {
          id: 1,
          title: 'tf-modules/test-module/v1.0.0',
          tagName: 'tf-modules/test-module/v1.0.0',
          body: 'Standard version',
        },
        {
          id: 2,
          title: 'tf-modules/test-module/vbeta.1.0', // Non-numeric major - invalid
          tagName: 'tf-modules/test-module/vbeta.1.0',
          body: 'Beta version',
        },
      ];

      expect(() => module.setReleases(releases)).toThrow(
        "Invalid tag format: 'tf-modules/test-module/vbeta.1.0'. Expected format: 'tf-modules/test-module/v#.#.#' or 'tf-modules/test-module/#.#.#' for module.",
      );
    });

    it('should handle identical version numbers in releases', () => {
      const releases: GitHubRelease[] = [
        {
          id: 1,
          title: 'tf-modules/test-module/v1.0.0',
          tagName: 'tf-modules/test-module/v1.0.0',
          body: 'First release',
        },
        {
          id: 2,
          title: 'tf-modules/test-module/v1.0.0',
          tagName: 'tf-modules/test-module/v1.0.0',
          body: 'Duplicate release',
        },
        {
          id: 3,
          title: 'tf-modules/test-module/v2.0.0',
          tagName: 'tf-modules/test-module/v2.0.0',
          body: 'Higher version',
        },
      ];

      module.setReleases(releases);

      // Should maintain stable sort for identical versions
      expect(module.releases).toHaveLength(3);
      expect(module.releases[0].title).toBe('tf-modules/test-module/v2.0.0');
      // The two v1.0.0 releases should maintain their relative order (stable sort)
      expect(module.releases[1].body).toBe('First release');
      expect(module.releases[2].body).toBe('Duplicate release');
    });

    it('should handle empty releases array', () => {
      const releases: GitHubRelease[] = [];

      module.setReleases(releases);

      expect(module.releases).toHaveLength(0);
      expect(module.releases).toEqual([]);
    });

    it('should handle single release', () => {
      const releases: GitHubRelease[] = [
        {
          id: 1,
          title: 'tf-modules/test-module/v1.0.0',
          tagName: 'tf-modules/test-module/v1.0.0',
          body: 'Single release',
        },
      ];

      module.setReleases(releases);

      expect(module.releases).toHaveLength(1);
      expect(module.releases[0].title).toBe('tf-modules/test-module/v1.0.0');
    });
  });

  describe('release determination', () => {
    let module: TerraformModule;

    beforeEach(() => {
      module = new TerraformModule(moduleDir);
    });

    describe('needsRelease()', () => {
      it('should return true for initial release (no tags)', () => {
        expect(module.needsRelease()).toBe(true);
      });

      it('should return true when module has direct changes', () => {
        // Set tags so it's not initial release
        module.setTags(['tf-modules/test-module/v1.0.0']);

        // Add a commit (direct change)
        module.addCommit({
          sha: 'abc123',
          message: 'feat: add feature',
          files: ['main.tf'],
        });

        expect(module.needsRelease()).toBe(true);
      });

      it('should return false when module has no changes and existing tags', () => {
        // Set tags so it's not initial release
        module.setTags(['tf-modules/test-module/v1.0.0']);

        // No commits added (no direct changes)
        // No dependency triggers

        expect(module.needsRelease()).toBe(false);
      });
    });

    describe('getReleaseType()', () => {
      it('should return patch for initial release', () => {
        expect(module.getReleaseType()).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return major when commit contains major keywords', () => {
        module.setTags(['tf-modules/test-module/v1.0.0']); // Not initial
        module.addCommit({
          sha: 'abc123',
          message: 'BREAKING CHANGE: major update',
          files: ['main.tf'],
        });

        expect(module.getReleaseType()).toBe(RELEASE_TYPE.MAJOR);
      });

      it('should return minor when commit contains minor keywords', () => {
        module.setTags(['tf-modules/test-module/v1.0.0']); // Not initial
        module.addCommit({
          sha: 'abc123',
          message: 'feat: add new feature',
          files: ['main.tf'],
        });

        expect(module.getReleaseType()).toBe(RELEASE_TYPE.MINOR);
      });

      it('should return patch for regular commits', () => {
        module.setTags(['tf-modules/test-module/v1.0.0']); // Not initial
        module.addCommit({
          sha: 'abc123',
          message: 'fix: bug fix',
          files: ['main.tf'],
        });

        expect(module.getReleaseType()).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return highest release type from multiple commits', () => {
        module.setTags(['tf-modules/test-module/v1.0.0']); // Not initial
        module.addCommit({
          sha: 'abc123',
          message: 'fix: bug fix', // patch
          files: ['main.tf'],
        });
        module.addCommit({
          sha: 'def456',
          message: 'feat: new feature', // minor
          files: ['variables.tf'],
        });
        module.addCommit({
          sha: 'ghi789',
          message: 'docs: update readme', // patch
          files: ['README.md'],
        });

        expect(module.getReleaseType()).toBe(RELEASE_TYPE.MINOR);
      });

      it('should return null when no release is needed', () => {
        module.setTags(['tf-modules/test-module/v1.0.0']); // Not initial
        // No commits, no dependency triggers

        expect(module.getReleaseType()).toBeNull();
      });

      it('should be case insensitive for keywords', () => {
        module.setTags(['tf-modules/test-module/v1.0.0']); // Not initial
        module.addCommit({
          sha: 'abc123',
          message: 'breaking change: major update',
          files: ['main.tf'],
        });

        expect(module.getReleaseType()).toBe(RELEASE_TYPE.MAJOR);
      });

      it('should handle mixed case features', () => {
        module.setTags(['tf-modules/test-module/v1.0.0']); // Not initial
        module.addCommit({
          sha: 'abc123',
          message: 'FEAT: add new feature',
          files: ['main.tf'],
        });

        expect(module.getReleaseType()).toBe(RELEASE_TYPE.MINOR);
      });
    });

    describe('getReleaseReasons()', () => {
      it('should return initial reason for new module', () => {
        expect(module.getReleaseReasons()).toEqual([RELEASE_REASON.INITIAL]);
      });

      it('should return direct changes reason when commits exist', () => {
        module.setTags(['tf-modules/test-module/v1.0.0']); // Not initial
        module.addCommit({
          sha: 'abc123',
          message: 'feat: add feature',
          files: ['main.tf'],
        });

        expect(module.getReleaseReasons()).toEqual([RELEASE_REASON.DIRECT_CHANGES]);
      });

      it('should return empty array when no release is needed', () => {
        module.setTags(['tf-modules/test-module/v1.0.0']); // Not initial
        // No commits, no dependency triggers

        expect(module.getReleaseReasons()).toEqual([]);
      });

      it('should return multiple reasons when applicable', () => {
        // Module with both initial and direct changes
        module.addCommit({
          sha: 'abc123',
          message: 'feat: add feature',
          files: ['main.tf'],
        });

        const reasons = module.getReleaseReasons();
        expect(reasons).toContain(RELEASE_REASON.INITIAL);
        expect(reasons).toContain(RELEASE_REASON.DIRECT_CHANGES);
        expect(reasons).toHaveLength(2);
      });
    });

    describe('getReleaseTagVersion()', () => {
      it('should return default first tag for initial release', () => {
        expect(module.getReleaseTagVersion()).toBe('v0.1.0');
      });

      it('should increment major version correctly', () => {
        module.setTags(['tf-modules/test-module/v1.2.3']);
        module.addCommit({
          sha: 'abc123',
          message: 'BREAKING CHANGE: major update',
          files: ['main.tf'],
        });

        expect(module.getReleaseTagVersion()).toBe('v2.0.0');
      });

      it('should increment minor version correctly', () => {
        module.setTags(['tf-modules/test-module/v1.2.3']);
        module.addCommit({
          sha: 'abc123',
          message: 'feat: new feature',
          files: ['main.tf'],
        });

        expect(module.getReleaseTagVersion()).toBe('v1.3.0');
      });

      it('should increment patch version correctly', () => {
        module.setTags(['tf-modules/test-module/v1.2.3']);
        module.addCommit({
          sha: 'abc123',
          message: 'fix: bug fix',
          files: ['main.tf'],
        });

        expect(module.getReleaseTagVersion()).toBe('v1.2.4');
      });

      it('should return null when no release is needed', () => {
        module.setTags(['tf-modules/test-module/v1.0.0']); // Not initial
        // No commits, no dependency triggers

        expect(module.getReleaseTagVersion()).toBeNull();
      });

      it('should throw error for malformed version tags', () => {
        // Set up a tag with valid format first
        module.setTags(['tf-modules/test-module/v1.0.0']);

        // Mock the internal behavior to test error cases
        const testModule = new TerraformModule(moduleDir);
        testModule.setTags(['tf-modules/test-module/v1.0.0']);

        vi.spyOn(testModule, 'getLatestTagVersion').mockReturnValue('invalid-format');
        // @ts-expect-error - Accessing private for testing
        vi.spyOn(testModule, 'hasDirectChanges').mockReturnValue(true);

        // Add a commit to trigger release tag version calculation
        testModule.addCommit({
          sha: 'def456',
          message: 'fix: bug fix',
          files: ['test.tf'],
        });

        expect(() => testModule.getReleaseTagVersion()).toThrow(
          "Invalid version format: 'invalid-format'. Expected v#.#.# or #.#.# format.",
        );
      });
    });

    describe('getReleaseTag()', () => {
      it('should return full release tag for initial release', () => {
        expect(module.getReleaseTag()).toBe('tf-modules/test-module/v0.1.0');
      });

      it('should return full release tag with incremented version', () => {
        module.setTags(['tf-modules/test-module/v1.0.0']);
        module.addCommit({
          sha: 'abc123',
          message: 'feat: new feature',
          files: ['main.tf'],
        });

        expect(module.getReleaseTag()).toBe('tf-modules/test-module/v1.1.0');
      });

      it('should return null when no release is needed', () => {
        module.setTags(['tf-modules/test-module/v1.0.0']); // Not initial
        // No commits, no dependency triggers

        expect(module.getReleaseTag()).toBeNull();
      });
    });
  });

  describe('toString()', () => {
    let module: TerraformModule;

    beforeEach(() => {
      module = new TerraformModule(moduleDir);
    });

    it('should format module without changes correctly', () => {
      module.setTags(['tf-modules/test-module/v1.0.0']);

      const output = module.toString();

      expect(output).toContain('📦 [tf-modules/test-module]');
      expect(output).toContain(`Directory: ${moduleDir}`);
      expect(output).toContain('Tags:');
      expect(output).toContain('- tf-modules/test-module/v1.0.0');
      expect(output).not.toContain('Release Type:');
    });

    it('should format module with changes correctly', () => {
      module.setTags(['tf-modules/test-module/v1.0.0']);
      module.addCommit({
        sha: 'abc1234567',
        message: 'feat: add new feature\nDetailed description',
        files: ['main.tf'],
      });

      const output = module.toString();

      expect(output).toContain('📦 [tf-modules/test-module]');
      expect(output).toContain('Commits:');
      expect(output).toContain('- [abc1234] feat: add new feature'); // Short SHA + first line
      expect(output).toContain('Release Type: minor');
      expect(output).toContain('Release Reasons: direct-changes');
    });

    it('should format module with releases correctly', () => {
      const releases: GitHubRelease[] = [
        {
          id: 123,
          title: 'tf-modules/test-module/v1.0.0',
          tagName: 'tf-modules/test-module/v1.0.0',
          body: 'Initial release',
        },
      ];
      module.setReleases(releases);

      const output = module.toString();

      expect(output).toContain('Releases:');
      expect(output).toContain('- [#123] tf-modules/test-module/v1.0.0  (tag: tf-modules/test-module/v1.0.0)');
    });

    it('should handle multi-line commit messages', () => {
      module.addCommit({
        sha: 'abc1234567',
        message: 'feat: add feature\n\nThis is a detailed description\nwith multiple lines',
        files: ['main.tf'],
      });

      const output = module.toString();

      expect(output).toContain('[abc1234] feat: add feature'); // Only first line shown
      expect(output).not.toContain('This is a detailed description');
      expect(output).not.toContain('with multiple lines');
    });
  });

  describe('static utilities', () => {
    describe('getTerraformModuleNameFromRelativePath()', () => {
      it('should generate valid module names from paths', () => {
        expect(TerraformModule.getTerraformModuleNameFromRelativePath('tf-modules/simple-module')).toBe(
          'tf-modules/simple-module',
        );

        expect(TerraformModule.getTerraformModuleNameFromRelativePath('complex_module-name.with/chars')).toBe(
          'complex_module-name-with/chars',
        );

        expect(TerraformModule.getTerraformModuleNameFromRelativePath('/leading/slash/')).toBe('leading/slash');

        expect(TerraformModule.getTerraformModuleNameFromRelativePath('module...with...dots')).toBe('module-with-dots');
      });

      it('should handle leading and trailing slashes', () => {
        expect(TerraformModule.getTerraformModuleNameFromRelativePath('/test-module/')).toBe('test-module');
      });

      it('should handle multiple consecutive slashes', () => {
        expect(TerraformModule.getTerraformModuleNameFromRelativePath('tf-modules//vpc//endpoint')).toBe(
          'tf-modules/vpc/endpoint',
        );
      });

      it('should handle whitespace', () => {
        expect(TerraformModule.getTerraformModuleNameFromRelativePath('  test module  ')).toBe('test-module');
      });

      it('should convert to lowercase', () => {
        expect(TerraformModule.getTerraformModuleNameFromRelativePath('Test-Module')).toBe('test-module');
      });

      it('should clean up invalid characters', () => {
        expect(TerraformModule.getTerraformModuleNameFromRelativePath('test@module!#$')).toBe('test-module');
      });

      it('should remove trailing special characters', () => {
        expect(TerraformModule.getTerraformModuleNameFromRelativePath('test-module-.')).toBe('test-module');
      });
    });

    describe('isModuleAssociatedWithTag()', () => {
      it('should correctly identify associated tags with v prefix', () => {
        expect(TerraformModule.isModuleAssociatedWithTag('my-module', 'my-module/v1.0.0')).toBe(true);
        expect(TerraformModule.isModuleAssociatedWithTag('my-module', 'other-module/v1.0.0')).toBe(false);
        expect(TerraformModule.isModuleAssociatedWithTag('my-module', 'my-module-extended/v1.0.0')).toBe(false);
        expect(TerraformModule.isModuleAssociatedWithTag('my-module', 'my-module/v2.1.0')).toBe(true);
      });

      it('should correctly identify associated tags without v prefix', () => {
        expect(TerraformModule.isModuleAssociatedWithTag('my-module', 'my-module/1.0.0')).toBe(true);
        expect(TerraformModule.isModuleAssociatedWithTag('my-module', 'other-module/1.0.0')).toBe(false);
        expect(TerraformModule.isModuleAssociatedWithTag('my-module', 'my-module-extended/1.0.0')).toBe(false);
        expect(TerraformModule.isModuleAssociatedWithTag('my-module', 'my-module/2.1.0')).toBe(true);
      });

      it('should return false for invalid tag format', () => {
        expect(TerraformModule.isModuleAssociatedWithTag('my-module', 'my-module/invalid')).toBe(false);
        expect(TerraformModule.isModuleAssociatedWithTag('my-module', 'invalid-format')).toBe(false);
        expect(TerraformModule.isModuleAssociatedWithTag('my-module', 'my-module/v1.0')).toBe(false); // Missing patch
        expect(TerraformModule.isModuleAssociatedWithTag('my-module', 'my-module/v1')).toBe(false); // Missing minor and patch
        expect(TerraformModule.isModuleAssociatedWithTag('my-module', 'my-module/vbeta.1.0')).toBe(false); // Non-numeric
      });

      it('should handle complex module names', () => {
        expect(
          TerraformModule.isModuleAssociatedWithTag('tf-modules/vpc-endpoint', 'tf-modules/vpc-endpoint/v1.0.0'),
        ).toBe(true);
        expect(
          TerraformModule.isModuleAssociatedWithTag('tf-modules/vpc-endpoint', 'tf-modules/vpc-endpoint/1.0.0'),
        ).toBe(true);
        expect(TerraformModule.isModuleAssociatedWithTag('tf-modules/vpc-endpoint', 'tf-modules/vpc/v1.0.0')).toBe(
          false,
        );
      });

      it('should be case sensitive', () => {
        expect(TerraformModule.isModuleAssociatedWithTag('my-module', 'My-Module/v1.0.0')).toBe(false);
        expect(TerraformModule.isModuleAssociatedWithTag('my-module', 'my-module/V1.0.0')).toBe(false);
      });
    });

    describe('getTagsForModule()', () => {
      it('should filter tags for specific module', () => {
        const allTags = ['module-a/v1.0.0', 'module-a/v1.1.0', 'module-b/v1.0.0', 'module-c/v2.0.0'];

        expect(TerraformModule.getTagsForModule('module-a', allTags)).toEqual(['module-a/v1.0.0', 'module-a/v1.1.0']);

        expect(TerraformModule.getTagsForModule('module-b', allTags)).toEqual(['module-b/v1.0.0']);

        expect(TerraformModule.getTagsForModule('non-existent', allTags)).toEqual([]);
      });
    });

    describe('getReleasesForModule()', () => {
      it('should filter releases for specific module', () => {
        const allReleases: GitHubRelease[] = [
          {
            id: 1,
            title: 'module-a/v1.0.0',
            tagName: 'module-a/v1.0.0',
            body: 'Release 1',
          },
          {
            id: 2,
            title: 'module-b/v1.0.0',
            tagName: 'module-b/v1.0.0',
            body: 'Release 2',
          },
          {
            id: 3,
            title: 'module-a/v1.1.0',
            tagName: 'module-a/v1.1.0',
            body: 'Release 3',
          },
        ];

        const moduleAReleases = TerraformModule.getReleasesForModule('module-a', allReleases);
        expect(moduleAReleases).toHaveLength(2);
        expect(moduleAReleases.map((r) => r.tagName)).toEqual(['module-a/v1.0.0', 'module-a/v1.1.0']);

        const moduleBReleases = TerraformModule.getReleasesForModule('module-b', allReleases);
        expect(moduleBReleases).toHaveLength(1);
        expect(moduleBReleases[0].tagName).toBe('module-b/v1.0.0');
      });
    });

    describe('getModulesNeedingRelease()', () => {
      it('should filter modules that need release', () => {
        const module1 = new TerraformModule(join(tmpDir, 'module1'));
        const module2 = new TerraformModule(join(tmpDir, 'module2'));
        const module3 = new TerraformModule(join(tmpDir, 'module3'));

        // module1: initial release (no tags)
        // module2: has changes
        module2.setTags(['module2/v1.0.0']);
        module2.addCommit({
          sha: 'abc123',
          message: 'feat: new feature',
          files: ['main.tf'],
        });

        // module3: no changes, has tags
        module3.setTags(['module3/v1.0.0']);

        const modules = [module1, module2, module3];
        const needingRelease = TerraformModule.getModulesNeedingRelease(modules);

        expect(needingRelease).toHaveLength(2);
        expect(needingRelease).toContain(module1); // Initial release
        expect(needingRelease).toContain(module2); // Has changes
        expect(needingRelease).not.toContain(module3); // No changes
      });
    });

    describe('getTagsToDelete()', () => {
      beforeEach(() => {
        vi.mocked(startGroup).mockClear();
        vi.mocked(info).mockClear();
        vi.mocked(endGroup).mockClear();
      });

      it('should return an empty array if no tags need to be removed', () => {
        const allTags = ['module-a/v1.0.0', 'module-b/v1.1.0'];
        const existingModules = [
          createMockTerraformModule({ directory: join(tmpDir, 'module-a') }),
          createMockTerraformModule({ directory: join(tmpDir, 'module-b') }),
        ];

        const tagsToDelete = TerraformModule.getTagsToDelete(allTags, existingModules);

        expect(tagsToDelete).toEqual([]);
        expect(startGroup).toHaveBeenCalledWith('Finding all Terraform tags that should be deleted');
        expect(info).toHaveBeenCalledWith('Terraform tags to delete:');
        expect(info).toHaveBeenCalledWith('[]');
        expect(endGroup).toHaveBeenCalled();
      });

      it('should return tags for modules that no longer exist', () => {
        const allTags = [
          'module-a/v1.0.0',
          'module-b/v1.1.0',
          'module-c/v2.0.0', // This module no longer exists
          'module-d/v1.0.0', // This module no longer exists
        ];
        const existingModules = [
          createMockTerraformModule({ directory: join(tmpDir, 'module-a') }),
          createMockTerraformModule({ directory: join(tmpDir, 'module-b') }),
        ];

        const tagsToDelete = TerraformModule.getTagsToDelete(allTags, existingModules);

        expect(tagsToDelete).toEqual(['module-c/v2.0.0', 'module-d/v1.0.0']);
        expect(info).toHaveBeenCalledWith(JSON.stringify(['module-c/v2.0.0', 'module-d/v1.0.0'], null, 2));
      });

      it('should handle tags with different version formats', () => {
        const allTags = [
          'module-x/v1.0.0',
          'module-y/v1.2.3-beta', // Module Y doesn't exist
          'module-z/v1', // Module Z doesn't exist
        ];
        const existingModules = [createMockTerraformModule({ directory: join(tmpDir, 'module-x') })];

        const tagsToDelete = TerraformModule.getTagsToDelete(allTags, existingModules);

        expect(tagsToDelete).toEqual(['module-y/v1.2.3-beta', 'module-z/v1']);
      });

      it('should return an empty array if allTags is empty', () => {
        const allTags: string[] = [];
        const existingModules = [new TerraformModule(join(tmpDir, 'module-a'))];

        const tagsToDelete = TerraformModule.getTagsToDelete(allTags, existingModules);

        expect(tagsToDelete).toEqual([]);
        expect(info).toHaveBeenCalledWith('[]');
      });

      it('should return all tags if terraformModules is empty', () => {
        const allTags = ['module-a/v1.0.0', 'module-b/v1.1.0'];
        const terraformModules: TerraformModule[] = [];

        const tagsToDelete = TerraformModule.getTagsToDelete(allTags, terraformModules);

        expect(tagsToDelete).toEqual(['module-a/v1.0.0', 'module-b/v1.1.0']);
        expect(info).toHaveBeenCalledWith(JSON.stringify(['module-a/v1.0.0', 'module-b/v1.1.0'], null, 2));
      });

      it('should correctly identify tags for modules that have changed their base name format', () => {
        const allTags = [
          'old-module-name/v1.0.0', // Old name, should be removed
          'new-module-name/v1.0.0', // New name, should be kept
        ];
        const existingModules = [createMockTerraformModule({ directory: join(tmpDir, 'new-module-name') })];

        const tagsToDelete = TerraformModule.getTagsToDelete(allTags, existingModules);

        expect(tagsToDelete).toEqual(['old-module-name/v1.0.0']);
      });

      it('should handle tags that do not conform to the expected module/vX.Y.Z pattern', () => {
        const allTags = [
          'module-a/v1.0.0',
          'non-standard-tag', // Should be removed as it won't match any module name
          'another-module', // Should be removed
        ];
        const existingModules = [new TerraformModule(join(tmpDir, 'module-a'))];

        const tagsToDelete = TerraformModule.getTagsToDelete(allTags, existingModules);

        expect(tagsToDelete).toEqual(['another-module', 'non-standard-tag']);
      });

      it('should sort the returned tags alphabetically', () => {
        const allTags = ['zebra-module/v1.0.0', 'apple-module/v1.0.0', 'banana-module/v1.0.0'];
        const terraformModules: TerraformModule[] = []; // No modules, so all tags are removed

        const tagsToDelete = TerraformModule.getTagsToDelete(allTags, terraformModules);

        expect(tagsToDelete).toEqual(['apple-module/v1.0.0', 'banana-module/v1.0.0', 'zebra-module/v1.0.0']);
      });
    });

    describe('getReleasesToDelete()', () => {
      beforeEach(() => {
        vi.mocked(startGroup).mockClear();
        vi.mocked(info).mockClear();
        vi.mocked(endGroup).mockClear();
      });

      it('should return an empty array if no releases need to be removed', () => {
        const allReleases: GitHubRelease[] = [
          {
            id: 1,
            title: 'module-a/v1.0.0',
            tagName: 'module-a/v1.0.0',
            body: 'Release 1',
          },
          {
            id: 2,
            title: 'module-b/v1.1.0',
            tagName: 'module-b/v1.1.0',
            body: 'Release 2',
          },
        ];
        const existingModules = [
          createMockTerraformModule({ directory: join(tmpDir, 'module-a') }),
          createMockTerraformModule({ directory: join(tmpDir, 'module-b') }),
        ];

        const releasesToDelete = TerraformModule.getReleasesToDelete(allReleases, existingModules);

        expect(releasesToDelete).toEqual([]);
        expect(startGroup).toHaveBeenCalledWith('Finding all Terraform releases that should be deleted');
        expect(info).toHaveBeenCalledWith('Terraform releases to delete:');
        expect(info).toHaveBeenCalledWith('[]');
        expect(endGroup).toHaveBeenCalled();
      });

      it('should return releases for modules that no longer exist', () => {
        const allReleases: GitHubRelease[] = [
          {
            id: 1,
            title: 'module-a/v1.0.0',
            tagName: 'module-a/v1.0.0',
            body: 'Release 1',
          },
          {
            id: 2,
            title: 'module-b/v1.1.0',
            tagName: 'module-b/v1.1.0',
            body: 'Release 2',
          },
          {
            id: 3,
            title: 'module-c/v2.0.0',
            tagName: 'module-c/v2.0.0',
            body: 'Release 3', // This module no longer exists
          },
          {
            id: 4,
            title: 'module-d/v1.0.0',
            tagName: 'module-d/v1.0.0',
            body: 'Release 4', // This module no longer exists
          },
        ];
        const existingModules = [
          createMockTerraformModule({ directory: join(tmpDir, 'module-a') }),
          createMockTerraformModule({ directory: join(tmpDir, 'module-b') }),
        ];

        const releasesToDelete = TerraformModule.getReleasesToDelete(allReleases, existingModules);

        expect(releasesToDelete).toHaveLength(2);
        expect(releasesToDelete[0].tagName).toBe('module-c/v2.0.0');
        expect(releasesToDelete[1].tagName).toBe('module-d/v1.0.0');
        expect(info).toHaveBeenCalledWith(JSON.stringify(['module-c/v2.0.0', 'module-d/v1.0.0'], null, 2));
      });

      it('should handle releases with different version formats', () => {
        const allReleases: GitHubRelease[] = [
          {
            id: 1,
            title: 'module-x/v1.0.0',
            tagName: 'module-x/v1.0.0',
            body: 'Release 1',
          },
          {
            id: 2,
            title: 'module-y/v1.2.3-beta',
            tagName: 'module-y/v1.2.3-beta',
            body: 'Release 2', // Module Y doesn't exist
          },
          {
            id: 3,
            title: 'module-z/v1',
            tagName: 'module-z/v1',
            body: 'Release 3', // Module Z doesn't exist
          },
        ];
        const existingModules = [createMockTerraformModule({ directory: join(tmpDir, 'module-x') })];

        const releasesToDelete = TerraformModule.getReleasesToDelete(allReleases, existingModules);

        expect(releasesToDelete).toHaveLength(2);
        expect(releasesToDelete[0].tagName).toBe('module-y/v1.2.3-beta');
        expect(releasesToDelete[1].tagName).toBe('module-z/v1');
      });

      it('should return an empty array if allReleases is empty', () => {
        const allReleases: GitHubRelease[] = [];
        const existingModules = [createMockTerraformModule({ directory: join(tmpDir, 'module-a') })];

        const releasesToDelete = TerraformModule.getReleasesToDelete(allReleases, existingModules);

        expect(releasesToDelete).toEqual([]);
        expect(info).toHaveBeenCalledWith('[]');
      });

      it('should return all releases if terraformModules is empty', () => {
        const allReleases: GitHubRelease[] = [
          {
            id: 1,
            title: 'module-a/v1.0.0',
            tagName: 'module-a/v1.0.0',
            body: 'Release 1',
          },
          {
            id: 2,
            title: 'module-b/v1.1.0',
            tagName: 'module-b/v1.1.0',
            body: 'Release 2',
          },
        ];
        const terraformModules: TerraformModule[] = [];

        const releasesToDelete = TerraformModule.getReleasesToDelete(allReleases, terraformModules);

        expect(releasesToDelete).toHaveLength(2);
        expect(releasesToDelete[0].tagName).toBe('module-a/v1.0.0');
        expect(releasesToDelete[1].tagName).toBe('module-b/v1.1.0');
        expect(info).toHaveBeenCalledWith(JSON.stringify(['module-a/v1.0.0', 'module-b/v1.1.0'], null, 2));
      });

      it('should correctly identify releases for modules that have changed their base name format', () => {
        const allReleases: GitHubRelease[] = [
          {
            id: 1,
            title: 'old-module-name/v1.0.0',
            tagName: 'old-module-name/v1.0.0',
            body: 'Old release', // Old name, should be removed
          },
          {
            id: 2,
            title: 'new-module-name/v1.0.0',
            tagName: 'new-module-name/v1.0.0',
            body: 'New release', // New name, should be kept
          },
        ];
        const existingModules = [createMockTerraformModule({ directory: join(tmpDir, 'new-module-name') })];

        const releasesToDelete = TerraformModule.getReleasesToDelete(allReleases, existingModules);

        expect(releasesToDelete).toHaveLength(1);
        expect(releasesToDelete[0].tagName).toBe('old-module-name/v1.0.0');
      });

      it('should handle releases that do not conform to the expected module/vX.Y.Z pattern', () => {
        const allReleases: GitHubRelease[] = [
          {
            id: 1,
            title: 'module-a/v1.0.0',
            tagName: 'module-a/v1.0.0',
            body: 'Valid release',
          },
          {
            id: 2,
            title: 'non-standard-release',
            tagName: 'non-standard-tag',
            body: 'Invalid release', // Should be removed as it won't match any module name
          },
          {
            id: 3,
            title: 'another-module',
            tagName: 'another-module',
            body: 'Another invalid release', // Should be removed
          },
        ];
        const existingModules = [createMockTerraformModule({ directory: join(tmpDir, 'module-a') })];

        const releasesToDelete = TerraformModule.getReleasesToDelete(allReleases, existingModules);

        expect(releasesToDelete).toHaveLength(2);
        expect(releasesToDelete[0].tagName).toBe('another-module');
        expect(releasesToDelete[1].tagName).toBe('non-standard-tag');
      });

      it('should sort the returned releases alphabetically by tag name', () => {
        const allReleases: GitHubRelease[] = [
          {
            id: 1,
            title: 'zebra-module/v1.0.0',
            tagName: 'zebra-module/v1.0.0',
            body: 'Zebra release',
          },
          {
            id: 2,
            title: 'apple-module/v1.0.0',
            tagName: 'apple-module/v1.0.0',
            body: 'Apple release',
          },
          {
            id: 3,
            title: 'banana-module/v1.0.0',
            tagName: 'banana-module/v1.0.0',
            body: 'Banana release',
          },
        ];
        const terraformModules: TerraformModule[] = []; // No modules, so all releases are removed

        const releasesToDelete = TerraformModule.getReleasesToDelete(allReleases, terraformModules);

        expect(releasesToDelete).toHaveLength(3);
        expect(releasesToDelete[0].tagName).toBe('apple-module/v1.0.0');
        expect(releasesToDelete[1].tagName).toBe('banana-module/v1.0.0');
        expect(releasesToDelete[2].tagName).toBe('zebra-module/v1.0.0');
      });

      it('should handle multiple releases for the same module that no longer exists', () => {
        const allReleases: GitHubRelease[] = [
          {
            id: 1,
            title: 'existing-module/v1.0.0',
            tagName: 'existing-module/v1.0.0',
            body: 'Existing release 1',
          },
          {
            id: 2,
            title: 'existing-module/v1.1.0',
            tagName: 'existing-module/v1.1.0',
            body: 'Existing release 2',
          },
          {
            id: 3,
            title: 'removed-module/v1.0.0',
            tagName: 'removed-module/v1.0.0',
            body: 'Removed release 1',
          },
          {
            id: 4,
            title: 'removed-module/v1.1.0',
            tagName: 'removed-module/v1.1.0',
            body: 'Removed release 2',
          },
          {
            id: 5,
            title: 'removed-module/v2.0.0',
            tagName: 'removed-module/v2.0.0',
            body: 'Removed release 3',
          },
        ];

        const existingModules = [createMockTerraformModule({ directory: join(tmpDir, 'existing-module') })];

        const releasesToDelete = TerraformModule.getReleasesToDelete(allReleases, existingModules);

        expect(releasesToDelete).toHaveLength(3);
        expect(releasesToDelete.map((r) => r.tagName)).toEqual([
          'removed-module/v1.0.0',
          'removed-module/v1.1.0',
          'removed-module/v2.0.0',
        ]);
      });

      it('should not remove releases for modules that exist in terraformModules', () => {
        const allReleases: GitHubRelease[] = [
          {
            id: 1,
            title: 'module-a/v1.0.0',
            tagName: 'module-a/v1.0.0',
            body: 'Module A release',
          },
          {
            id: 2,
            title: 'module-b/v2.0.0',
            tagName: 'module-b/v2.0.0',
            body: 'Module B release',
          },
          {
            id: 3,
            title: 'module-c/v1.5.0',
            tagName: 'module-c/v1.5.0',
            body: 'Module C release',
          },
        ];

        const existingModules = [
          createMockTerraformModule({ directory: join(tmpDir, 'module-a') }),
          createMockTerraformModule({ directory: join(tmpDir, 'module-b') }),
          createMockTerraformModule({ directory: join(tmpDir, 'module-c') }),
        ];

        const releasesToDelete = TerraformModule.getReleasesToDelete(allReleases, existingModules);

        expect(releasesToDelete).toHaveLength(0);
      });

      it('should preserve releases for existing modules while removing releases for non-existing modules', () => {
        const allReleases: GitHubRelease[] = [
          {
            id: 1,
            title: 'existing-module/v1.0.0',
            tagName: 'existing-module/v1.0.0',
            body: 'Existing module release',
          },
          {
            id: 2,
            title: 'another-existing/v2.0.0',
            tagName: 'another-existing/v2.0.0',
            body: 'Another existing module release',
          },
          {
            id: 3,
            title: 'removed-module/v1.0.0',
            tagName: 'removed-module/v1.0.0',
            body: 'Removed module release',
          },
          {
            id: 4,
            title: 'deleted-module/v3.0.0',
            tagName: 'deleted-module/v3.0.0',
            body: 'Deleted module release',
          },
        ];

        const existingModules = [
          createMockTerraformModule({ directory: join(tmpDir, 'existing-module') }),
          createMockTerraformModule({ directory: join(tmpDir, 'another-existing') }),
        ];

        const releasesToDelete = TerraformModule.getReleasesToDelete(allReleases, existingModules);

        expect(releasesToDelete).toHaveLength(2);
        expect(releasesToDelete.map((r) => r.tagName)).toEqual(['deleted-module/v3.0.0', 'removed-module/v1.0.0']);
      });

      it('should handle mixed case where some releases belong to existing modules and others do not', () => {
        const allReleases: GitHubRelease[] = [
          {
            id: 1,
            title: 'web-module/v1.0.0',
            tagName: 'web-module/v1.0.0',
            body: 'Web module v1.0.0',
          },
          {
            id: 2,
            title: 'web-module/v1.1.0',
            tagName: 'web-module/v1.1.0',
            body: 'Web module v1.1.0',
          },
          {
            id: 3,
            title: 'api-module/v2.0.0',
            tagName: 'api-module/v2.0.0',
            body: 'API module v2.0.0',
          },
          {
            id: 4,
            title: 'legacy-module/v1.0.0',
            tagName: 'legacy-module/v1.0.0',
            body: 'Legacy module v1.0.0',
          },
          {
            id: 5,
            title: 'legacy-module/v1.2.0',
            tagName: 'legacy-module/v1.2.0',
            body: 'Legacy module v1.2.0',
          },
        ];

        const existingModules = [
          createMockTerraformModule({ directory: join(tmpDir, 'web-module') }),
          createMockTerraformModule({ directory: join(tmpDir, 'api-module') }),
        ];

        const releasesToDelete = TerraformModule.getReleasesToDelete(allReleases, existingModules);

        expect(releasesToDelete).toHaveLength(2);
        expect(releasesToDelete.map((r) => r.tagName)).toEqual(['legacy-module/v1.0.0', 'legacy-module/v1.2.0']);
      });
    });

    // Test private helper methods via the public interface
    describe('extractVersionFromTag()', () => {
      let module: TerraformModule;

      beforeEach(() => {
        module = new TerraformModule(moduleDir);
      });

      it('should handle tags with slashes correctly', () => {
        // We can test this via the public methods that use it internally
        module.setTags(['tf-modules/test-module/v1.2.3', 'tf-modules/test-module/v2.0.0']);

        // The sorting is done using extractVersionFromTag internally
        expect(module.tags[0]).toBe('tf-modules/test-module/v2.0.0'); // Higher version first
        expect(module.tags[1]).toBe('tf-modules/test-module/v1.2.3');
      });

      it('should handle version string without slashes correctly', () => {
        const moduleA = new TerraformModule(moduleDir);
        const moduleB = new TerraformModule(join(moduleDir, 'subdir'));

        // Use the public setTags method but mock the internal compareSemanticVersions to check the extracted versions
        // @ts-expect-error - Accessing private for testing
        const compareSpy = vi.spyOn(moduleA, 'compareSemanticVersions');

        // When setting tags with multiple items, extractVersionFromTag is used and compareSemanticVersions is called for sorting
        moduleA.setTags(['tf-modules/test-module/v1.2.3', 'tf-modules/test-module/v2.0.0']);

        // Verify it was called with the expected extracted versions
        expect(compareSpy).toHaveBeenCalled();

        // Test that the method properly validates tag format and throws for invalid tags
        // @ts-expect-error - Accessing private for testing
        const extractVersionFn = moduleB.extractVersionFromTag.bind(moduleB);

        // Test that raw version strings (no module name) are properly rejected
        expect(() => extractVersionFn('v1.2.3')).toThrow('Invalid tag format');
        expect(() => extractVersionFn('1.2.3')).toThrow('Invalid tag format');
      });
    });
  });

  describe('error handling', () => {
    let module: TerraformModule;

    beforeEach(() => {
      module = new TerraformModule(moduleDir);
    });

    it('should throw error when version lookup fails during release sorting', () => {
      const releases: GitHubRelease[] = [
        {
          id: 1,
          title: 'tf-modules/test-module/v1.0.0',
          tagName: 'tf-modules/test-module/v1.0.0',
          body: 'Release 1',
        },
        {
          id: 2,
          title: 'tf-modules/test-module/v2.0.0',
          tagName: 'tf-modules/test-module/v2.0.0',
          body: 'Release 2',
        },
      ];

      // Create a mock Map to simulate version lookup failure
      const mockMap = new Map();
      mockMap.set = vi.fn().mockImplementation(() => mockMap);
      mockMap.get = vi.fn().mockReturnValueOnce('1.0.0').mockReturnValueOnce(undefined);

      const mapSpy = vi.spyOn(global, 'Map').mockImplementation(() => mockMap);

      expect(() => module.setReleases(releases)).toThrow('Internal error: version not found in map');

      mapSpy.mockRestore();
    });

    it('should throw error for invalid version format in getReleaseTagVersion', () => {
      // Create a module with initial state
      const testModule = createMockTerraformModule({
        directory: moduleDir,
        tags: ['tf-modules/test-module/v1.0.0'],
      });

      // Mock internal methods to force version validation
      vi.spyOn(testModule, 'getLatestTagVersion').mockReturnValue('bad-version');

      // @ts-expect-error - Accessing private for testing
      vi.spyOn(testModule, 'hasDirectChanges').mockReturnValue(true);

      // Add a commit to ensure getReleaseTagVersion processes the version
      testModule.addCommit({
        sha: 'def456',
        message: 'fix: test commit',
        files: ['test.tf'],
      });

      // Verify it throws the expected error
      expect(() => testModule.getReleaseTagVersion()).toThrow(
        "Invalid version format: 'bad-version'. Expected v#.#.# or #.#.# format.",
      );
    });
  });
});
