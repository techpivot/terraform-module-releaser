import {
  createTerraformModuleChangelog,
  getPullRequestChangelog,
  getTerraformModuleFullReleaseChangelog,
} from '@/changelog';
import { context } from '@/mocks/context';
import type { TerraformModule } from '@/terraform-module';
import { createMockTerraformModule } from '@/tests/helpers/terraform-module';
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

    it('should skip modules that do not need release', () => {
      const terraformModules: TerraformModule[] = [
        createMockTerraformModule({
          directory: 'modules/module1',
          commitMessages: ['feat: Add new feature'],
        }),
        createMockTerraformModule({
          directory: 'modules/module2',
          commitMessages: [], // No commits = no release needed
          tags: ['modules/module2/v1.0.0'], // Already has a tag
        }),
      ];

      // Only module1 should appear in changelog
      const expectedChangelog = [
        '## `modules/module1/v1.0.0` (2024-11-05)',
        '',
        '- :twisted_rightwards_arrows:**[PR #123](https://github.com/techpivot/terraform-module-releaser/pull/123)** - Test PR Title',
        '- feat: Add new feature',
      ].join('\n');

      expect(getPullRequestChangelog(terraformModules)).toBe(expectedChangelog);
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
});
