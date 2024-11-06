import { getModuleChangelog, getModuleReleaseChangelog, getPullRequestChangelog } from '@/changelog';
import { context } from '@/mocks/context';
import type { TerraformChangedModule, TerraformModule } from '@/terraform-module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('changelog', () => {
  const mockDate = new Date('2024-11-05');

  beforeEach(() => {
    vi.useFakeTimers();
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
      const terraformChangedModules: TerraformChangedModule[] = [
        {
          moduleName: 'module1',
          directory: 'modules/module1',
          tags: [],
          releases: [],
          isChanged: true,
          latestTag: null,
          latestTagVersion: null,
          releaseType: 'patch',
          nextTag: 'module1/v1.0.0',
          nextTagVersion: '1.0.0',
          commitMessages: ['Test PR Title', 'feat: Add new feature', 'fix: Fix bug\nWith multiple lines'],
        },
        {
          moduleName: 'module2',
          directory: 'modules/module2',
          tags: [],
          releases: [],
          isChanged: true,
          latestTag: null,
          latestTagVersion: null,
          releaseType: 'patch',
          nextTag: 'module2/v2.0.0',
          nextTagVersion: '2.0.0',
          commitMessages: ['Another commit'],
        },
      ];

      const expectedChangelog = [
        '## `module1/v1.0.0` (2024-11-05)',
        '',
        '- PR #123 - Test PR Title',
        '- feat: Add new feature',
        '- fix: Fix bug<br>With multiple lines',
        '',
        '## `module2/v2.0.0` (2024-11-05)',
        '',
        '- PR #123 - Test PR Title',
        '- Another commit',
      ].join('\n');

      expect(getPullRequestChangelog(terraformChangedModules)).toBe(expectedChangelog);
    });

    it('should handle empty commit messages array', () => {
      const terraformChangedModules: TerraformChangedModule[] = [
        {
          moduleName: 'module1',
          directory: 'modules/module2',
          tags: [],
          releases: [],
          isChanged: true,
          latestTag: null,
          latestTagVersion: null,
          releaseType: 'patch',
          nextTag: 'module2/v2.0.0',
          nextTagVersion: '2.0.0',
          commitMessages: [],
        },
      ];

      const expectedChangelog = ['## `module2/v2.0.0` (2024-11-05)', '', '- PR #123 - Test PR Title'].join('\n');

      expect(getPullRequestChangelog(terraformChangedModules)).toBe(expectedChangelog);
    });

    it('should handle empty modules array', () => {
      expect(getPullRequestChangelog([])).toBe('');
    });

    it('should remove duplicate PR title from commit messages', () => {
      const terraformChangedModules: TerraformChangedModule[] = [
        {
          moduleName: 'module1',
          directory: 'modules/module1',
          tags: [],
          releases: [],
          isChanged: true,
          latestTag: null,
          latestTagVersion: null,
          releaseType: 'patch',
          nextTag: 'module1/v1.0.0',
          nextTagVersion: '1.0.0',
          commitMessages: ['Test PR Title', 'Another commit'],
        },
      ];

      const expectedChangelog = [
        '## `module1/v1.0.0` (2024-11-05)',
        '',
        '- PR #123 - Test PR Title',
        '- Another commit',
      ].join('\n');

      expect(getPullRequestChangelog(terraformChangedModules)).toBe(expectedChangelog);
    });
  });

  describe('getModuleChangelog()', () => {
    const baseTerraformChangedModule: TerraformChangedModule = {
      moduleName: 'module1',
      directory: 'modules/module1',
      tags: [],
      releases: [],
      isChanged: true,
      latestTag: null,
      latestTagVersion: null,
      releaseType: 'patch',
      nextTag: 'module1/v1.0.0',
      nextTagVersion: '1.0.0',
      commitMessages: [],
    };

    it('should generate changelog for a single module with PR link', () => {
      const terraformChangedModule = Object.assign(baseTerraformChangedModule, {
        commitMessages: ['Test PR Title', 'feat: Add new feature', 'fix: Fix bug\nWith multiple lines'],
      });

      const expectedChangelog = [
        '## `1.0.0` (2024-11-05)',
        '',
        '- [PR #123](https://github.com/techpivot/terraform-module-releaser/pull/123) - Test PR Title',
        '- feat: Add new feature',
        '- fix: Fix bug<br>With multiple lines',
      ].join('\n');

      expect(getModuleChangelog(terraformChangedModule)).toBe(expectedChangelog);
    });

    it('should handle multiline commit messages', () => {
      const terraformChangedModule = Object.assign(baseTerraformChangedModule, {
        commitMessages: ['feat: Multiple\nline\ncommit', 'fix: Another\nMultiline'],
      });

      const expectedChangelog = [
        '## `1.0.0` (2024-11-05)',
        '',
        '- [PR #123](https://github.com/techpivot/terraform-module-releaser/pull/123) - Test PR Title',
        '- feat: Multiple<br>line<br>commit',
        '- fix: Another<br>Multiline',
      ].join('\n');

      expect(getModuleChangelog(terraformChangedModule)).toBe(expectedChangelog);
    });
  });

  describe('getModuleReleaseChangelog()', () => {
    const baseTerraformModule: TerraformModule = {
      moduleName: 'aws/vpc',
      directory: 'modules/aws/vpc',
      tags: [],
      releases: [],
      latestTag: null,
      latestTagVersion: null,
    };

    it('should concatenate release bodies', () => {
      const terraformModule = Object.assign(baseTerraformModule, {
        releases: [{ body: 'Release 1 content' }, { body: 'Release 2 content' }],
      });

      const expectedChangelog = ['Release 1 content', '', 'Release 2 content'].join('\n');

      expect(getModuleReleaseChangelog(terraformModule)).toBe(expectedChangelog);
    });

    it('should handle empty releases array', () => {
      const terraformModule = Object.assign(baseTerraformModule, {
        releases: [],
      });

      expect(getModuleReleaseChangelog(terraformModule)).toBe('');
    });

    it('should handle single release', () => {
      const terraformModule = Object.assign(baseTerraformModule, {
        releases: [{ body: 'Single release content' }],
      });

      expect(getModuleReleaseChangelog(terraformModule)).toBe('Single release content');
    });
  });
});
