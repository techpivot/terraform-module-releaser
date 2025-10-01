import {
  createTerraformModuleChangelog,
  generateChangelogFiles,
  getPullRequestChangelog,
  getTerraformModuleFullReleaseChangelog,
} from '@/changelog';
import { context } from '@/mocks/context';
import type { TerraformModule } from '@/terraform-module';
import { createMockTerraformModule } from '@/tests/helpers/terraform-module';
import { existsSync, promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('changelog', () => {
  const mockDate = new Date('2024-11-05');

  beforeEach(() => {
    vi.setSystemTime(mockDate);

    // Reset context mock before each test
    context.set({
      prNumber: 123,
      prTitle: 'Test PR Title',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getPullRequestChangelog()', () => {
    it('should generate changelog for multiple modules with PR info', () => {
      const terraformModules: TerraformModule[] = [
        createMockTerraformModule({
          directory: 'modules/module1',
          commitMessages: ['Test PR Title', 'feat: Add new feature', 'fix: Fix bug\nWith multiple lines'],
        }),
        createMockTerraformModule({ directory: 'modules/module2', commitMessages: ['Another commit'] }),
      ];

      const expectedChangelog = [
        '## `modules/module1/v1.0.0` (2024-11-05)',
        '',
        '- :twisted_rightwards_arrows:**[PR #123](https://github.com/techpivot/terraform-module-releaser/pull/123)** - Test PR Title',
        '- feat: Add new feature',
        '- fix: Fix bug<br>With multiple lines',
        '',
        '## `modules/module2/v1.0.0` (2024-11-05)',
        '',
        '- :twisted_rightwards_arrows:**[PR #123](https://github.com/techpivot/terraform-module-releaser/pull/123)** - Test PR Title',
        '- Another commit',
      ].join('\n');

      expect(getPullRequestChangelog(terraformModules)).toBe(expectedChangelog);
    });

    it('should handle empty commit messages array', () => {
      const terraformModules: TerraformModule[] = [
        createMockTerraformModule({
          directory: 'modules/module2',
          commitMessages: [], // Empty commit messages
        }),
      ];

      const expectedChangelog = [
        '## `modules/module2/v1.0.0` (2024-11-05)',
        '',
        '- :twisted_rightwards_arrows:**[PR #123](https://github.com/techpivot/terraform-module-releaser/pull/123)** - Test PR Title',
      ].join('\n');

      expect(getPullRequestChangelog(terraformModules)).toBe(expectedChangelog);
    });

    it('should handle empty modules array', () => {
      expect(getPullRequestChangelog([])).toBe('');
    });

    it('should remove duplicate PR title from commit messages', () => {
      const terraformModules: TerraformModule[] = [
        createMockTerraformModule({
          directory: 'modules/module1',
          commitMessages: ['Test PR Title', 'Another commit'],
        }),
      ];

      const expectedChangelog = [
        '## `modules/module1/v1.0.0` (2024-11-05)',
        '',
        '- :twisted_rightwards_arrows:**[PR #123](https://github.com/techpivot/terraform-module-releaser/pull/123)** - Test PR Title',
        '- Another commit',
      ].join('\n');

      expect(getPullRequestChangelog(terraformModules)).toBe(expectedChangelog);
    });
  });

  describe('createTerraformModuleChangelog()', () => {
    it('should generate changelog for a single module with PR link', () => {
      const terraformModule = createMockTerraformModule({
        directory: 'modules/module1',
        commitMessages: ['Test PR Title', 'feat: Add new feature', 'fix: Fix bug\nWith multiple lines'],
      });

      const expectedChangelog = [
        '## `v1.0.0` (2024-11-05)',
        '',
        '- :twisted_rightwards_arrows:**[PR #123](https://github.com/techpivot/terraform-module-releaser/pull/123)** - Test PR Title',
        '- feat: Add new feature',
        '- fix: Fix bug<br>With multiple lines',
      ].join('\n');

      expect(createTerraformModuleChangelog(terraformModule)).toBe(expectedChangelog);
    });

    it('should handle multiline commit messages', () => {
      const terraformModule = createMockTerraformModule({
        directory: 'modules/module1',
        commitMessages: ['feat: Multiple\nline\ncommit', 'fix: Another\nMultiline'],
      });

      const expectedChangelog = [
        '## `v1.0.0` (2024-11-05)',
        '',
        '- :twisted_rightwards_arrows:**[PR #123](https://github.com/techpivot/terraform-module-releaser/pull/123)** - Test PR Title',
        '- feat: Multiple<br>line<br>commit',
        '- fix: Another<br>Multiline',
      ].join('\n');

      expect(createTerraformModuleChangelog(terraformModule)).toBe(expectedChangelog);
    });

    it('should handle trimming commit messages', () => {
      const terraformModule = createMockTerraformModule({
        directory: 'modules/module1',
        commitMessages: ['\nfeat: message with new lines\n'],
      });

      const expectedChangelog = [
        '## `v1.0.0` (2024-11-05)',
        '',
        '- :twisted_rightwards_arrows:**[PR #123](https://github.com/techpivot/terraform-module-releaser/pull/123)** - Test PR Title',
        '- feat: message with new lines',
      ].join('\n');

      expect(createTerraformModuleChangelog(terraformModule)).toBe(expectedChangelog);
    });

    it('should return empty string when module does not need release', () => {
      // Create a module with no commits (doesn't need release)
      const terraformModule = createMockTerraformModule({
        directory: 'modules/module1',
        commitMessages: [], // No commit messages
        tags: ['modules/module1/v1.0.0'], // Has existing tags
      });

      expect(createTerraformModuleChangelog(terraformModule)).toBe('');
    });

    it('should return empty string when module needs release but getReleaseTagVersion returns null', () => {
      // Create a module that needs release but mocked to return null for getReleaseTagVersion
      const terraformModule = createMockTerraformModule({
        directory: 'modules/module1',
        commitMessages: ['feat: some change'], // Has commits (needs release)
      });

      // Mock getReleaseTagVersion to return null (edge case scenario)
      vi.spyOn(terraformModule, 'getReleaseTagVersion').mockReturnValue(null);

      expect(createTerraformModuleChangelog(terraformModule)).toBe('');
    });
  });

  describe('getTerraformModuleFullReleaseChangelog()', () => {
    it('should concatenate release bodies', () => {
      const terraformModule = createMockTerraformModule({
        directory: 'modules/aws/vpc',
        releases: [
          {
            id: 1,
            title: 'modules/aws/vpc/v1.0.0',
            body: 'Release 1 content',
            tagName: 'modules/aws/vpc/v1.0.0',
          },
          {
            id: 2,
            title: 'modules/aws/vpc/v1.1.0',
            body: 'Release 2 content',
            tagName: 'modules/aws/vpc/v1.1.0',
          },
        ],
      });

      // TerraformModule sorts releases by version in descending order (newest first)
      const expectedChangelog = ['Release 2 content', '', 'Release 1 content'].join('\n');

      expect(getTerraformModuleFullReleaseChangelog(terraformModule)).toBe(expectedChangelog);
    });

    it('should handle empty releases array', () => {
      const terraformModule = createMockTerraformModule({ directory: 'modules/aws/vpc' });

      expect(getTerraformModuleFullReleaseChangelog(terraformModule)).toBe('');
    });

    it('should handle single release', () => {
      const terraformModule = createMockTerraformModule({
        directory: 'modules/aws/vpc',
        releases: [
          {
            id: 1,
            title: 'modules/aws/vpc/v1.0.0',
            body: 'Single release content',
            tagName: 'modules/aws/vpc/v1.0.0',
          },
        ],
      });

      expect(getTerraformModuleFullReleaseChangelog(terraformModule)).toBe('Single release content');
    });
  });

  describe('generateChangelogFiles()', () => {
    const tmpDir = '/tmp/changelog-test';

    beforeEach(async () => {
      // Create temp directory for test files
      await fsp.mkdir(tmpDir, { recursive: true });
    });

    afterEach(async () => {
      // Cleanup test files
      if (existsSync(tmpDir)) {
        await fsp.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('should generate CHANGELOG.md files for modules needing release', async () => {
      const terraformModules: TerraformModule[] = [
        createMockTerraformModule({
          directory: 'test/module1',
          commitMessages: ['feat: Add new feature', 'fix: Fix bug'],
        }),
        createMockTerraformModule({
          directory: 'test/module2',
          commitMessages: ['feat: Another feature'],
        }),
      ];

      // Create module directories using actual absolute paths
      for (const module of terraformModules) {
        const fullPath = join(tmpDir, module.name);
        await fsp.mkdir(fullPath, { recursive: true });
        // Override the directory with absolute path for file operations
        Object.defineProperty(module, 'directory', { value: fullPath, writable: true });
      }

      const changelogFiles = await generateChangelogFiles(terraformModules);

      expect(changelogFiles).toHaveLength(2);
      expect(changelogFiles[0]).toContain('CHANGELOG.md');
      expect(changelogFiles[1]).toContain('CHANGELOG.md');

      // Verify file contents
      const changelog1 = await fsp.readFile(changelogFiles[0], 'utf8');
      expect(changelog1).toContain('# Changelog - test/module1');
      expect(changelog1).toContain('All notable changes to this module will be documented in this file.');
      expect(changelog1).toContain('## `v1.0.0` (2024-11-05)');
      expect(changelog1).toContain('feat: Add new feature');
      expect(changelog1).toContain('fix: Fix bug');

      const changelog2 = await fsp.readFile(changelogFiles[1], 'utf8');
      expect(changelog2).toContain('# Changelog - test/module2');
      expect(changelog2).toContain('feat: Another feature');
    });

    it('should include historical releases in changelog', async () => {
      const terraformModule = createMockTerraformModule({
        directory: 'test/module-with-history',
        commitMessages: ['feat: New feature'],
        tags: ['test/module-with-history/v1.0.0'], // Existing tag
        releases: [
          {
            id: 1,
            title: 'test/module-with-history/v1.0.0',
            body: '## `v1.0.0` (2024-01-01)\n\n- Initial release',
            tagName: 'test/module-with-history/v1.0.0',
          },
        ],
      });

      const fullPath = join(tmpDir, terraformModule.name);
      await fsp.mkdir(fullPath, { recursive: true });
      Object.defineProperty(terraformModule, 'directory', { value: fullPath, writable: true });

      const changelogFiles = await generateChangelogFiles([terraformModule]);

      expect(changelogFiles).toHaveLength(1);

      const changelog = await fsp.readFile(changelogFiles[0], 'utf8');
      expect(changelog).toContain('# Changelog - test/module-with-history');
      expect(changelog).toContain('## `v1.1.0` (2024-11-05)'); // New release
      expect(changelog).toContain('feat: New feature');
      expect(changelog).toContain('## `v1.0.0` (2024-01-01)'); // Historical release
      expect(changelog).toContain('Initial release');
    });

    it('should return empty array when no modules need release', async () => {
      const terraformModules: TerraformModule[] = [
        createMockTerraformModule({
          directory: 'test/no-release-module',
          commitMessages: [], // No commits - no release needed
          tags: ['test/no-release-module/v1.0.0'], // Already has a tag
        }),
      ];

      const changelogFiles = await generateChangelogFiles(terraformModules);

      expect(changelogFiles).toHaveLength(0);
    });

    it('should handle empty module array', async () => {
      const changelogFiles = await generateChangelogFiles([]);

      expect(changelogFiles).toHaveLength(0);
    });

    it('should skip modules where changelog generation returns empty', async () => {
      const terraformModule = createMockTerraformModule({
        directory: 'test/edge-case-module',
        commitMessages: ['feat: some change'],
      });

      // Mock getReleaseTagVersion to return null (edge case)
      vi.spyOn(terraformModule, 'getReleaseTagVersion').mockReturnValue(null);

      const fullPath = join(tmpDir, terraformModule.name);
      await fsp.mkdir(fullPath, { recursive: true });
      Object.defineProperty(terraformModule, 'directory', { value: fullPath, writable: true });

      const changelogFiles = await generateChangelogFiles([terraformModule]);

      expect(changelogFiles).toHaveLength(0);
    });
  });
});
