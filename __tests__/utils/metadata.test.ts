import { ACTION_INPUTS, createConfigFromInputs } from '@/utils/metadata';
import type { ActionInputMetadata } from '@/types';
import { getBooleanInput, getInput } from '@actions/core';
import { describe, expect, it, vi } from 'vitest';

describe('utils/metadata', () => {
  describe('ACTION_INPUTS', () => {
    it('should contain all expected input configurations', () => {
      const expectedInputs = [
        'major-keywords',
        'minor-keywords', 
        'patch-keywords',
        'default-first-tag',
        'terraform-docs-version',
        'delete-legacy-tags',
        'disable-wiki',
        'wiki-sidebar-changelog-max',
        'disable-branding',
        'module-path-ignore',
        'module-change-exclude-patterns',
        'module-asset-exclude-patterns',
        'use-ssh-source-format',
        'github_token',
        'tag-directory-separator',
        'use-version-prefix',
      ];

      expect(Object.keys(ACTION_INPUTS)).toEqual(expect.arrayContaining(expectedInputs));
      expect(Object.keys(ACTION_INPUTS)).toHaveLength(expectedInputs.length);
    });

    it('should have correct metadata structure for required string inputs', () => {
      const stringInputs = ['default-first-tag', 'terraform-docs-version', 'github_token', 'tag-directory-separator'];
      
      for (const inputName of stringInputs) {
        const metadata = ACTION_INPUTS[inputName];
        expect(metadata).toEqual({
          configKey: expect.any(String),
          required: true,
          type: 'string',
        });
      }
    });

    it('should have correct metadata structure for required boolean inputs', () => {
      const booleanInputs = [
        'delete-legacy-tags',
        'disable-wiki', 
        'disable-branding',
        'use-ssh-source-format',
        'use-version-prefix',
      ];
      
      for (const inputName of booleanInputs) {
        const metadata = ACTION_INPUTS[inputName];
        expect(metadata).toEqual({
          configKey: expect.any(String),
          required: true,
          type: 'boolean',
        });
      }
    });

    it('should have correct metadata structure for required array inputs', () => {
      const arrayInputs = ['major-keywords', 'minor-keywords', 'patch-keywords'];
      
      for (const inputName of arrayInputs) {
        const metadata = ACTION_INPUTS[inputName];
        expect(metadata).toEqual({
          configKey: expect.any(String),
          required: true,
          type: 'array',
        });
      }
    });

    it('should have correct metadata structure for required number inputs', () => {
      const numberInputs = ['wiki-sidebar-changelog-max'];
      
      for (const inputName of numberInputs) {
        const metadata = ACTION_INPUTS[inputName];
        expect(metadata).toEqual({
          configKey: expect.any(String),
          required: true,
          type: 'number',
        });
      }
    });

    it('should have correct metadata structure for optional array inputs', () => {
      const optionalArrayInputs = [
        'module-path-ignore',
        'module-change-exclude-patterns',
        'module-asset-exclude-patterns',
      ];
      
      for (const inputName of optionalArrayInputs) {
        const metadata = ACTION_INPUTS[inputName];
        expect(metadata).toEqual({
          configKey: expect.any(String),
          required: false,
          type: 'array',
        });
      }
    });

    it('should have proper configKey mappings', () => {
      const expectedMappings: Record<string, string> = {
        'major-keywords': 'majorKeywords',
        'minor-keywords': 'minorKeywords',
        'patch-keywords': 'patchKeywords',
        'default-first-tag': 'defaultFirstTag',
        'terraform-docs-version': 'terraformDocsVersion',
        'delete-legacy-tags': 'deleteLegacyTags',
        'disable-wiki': 'disableWiki',
        'wiki-sidebar-changelog-max': 'wikiSidebarChangelogMax',
        'disable-branding': 'disableBranding',
        'module-path-ignore': 'modulePathIgnore',
        'module-change-exclude-patterns': 'moduleChangeExcludePatterns',
        'module-asset-exclude-patterns': 'moduleAssetExcludePatterns',
        'use-ssh-source-format': 'useSSHSourceFormat',
        'github_token': 'githubToken',
        'tag-directory-separator': 'tagDirectorySeparator',
        'use-version-prefix': 'useVersionPrefix',
      };

      for (const [inputName, expectedConfigKey] of Object.entries(expectedMappings)) {
        expect(ACTION_INPUTS[inputName].configKey).toBe(expectedConfigKey);
      }
    });

    it('should maintain type safety with ActionInputMetadata interface', () => {
      // This test ensures the factory functions create valid ActionInputMetadata objects
      for (const metadata of Object.values(ACTION_INPUTS)) {
        expect(metadata).toEqual(
          expect.objectContaining({
            configKey: expect.any(String),
            required: expect.any(Boolean),
            type: expect.stringMatching(/^(string|boolean|array|number)$/),
          })
        );
        
        // Ensure type is properly typed
        const validTypes: ActionInputMetadata['type'][] = ['string', 'boolean', 'array', 'number'];
        expect(validTypes).toContain(metadata.type);
      }
    });
  });

  describe('createConfigFromInputs', () => {
    it('should throw a custom error if getInput fails', () => {
      const errorMessage = 'Input retrieval failed';
      vi.mocked(getInput).mockImplementation(() => {
        throw new Error(errorMessage);
      });

      expect(() => createConfigFromInputs()).toThrow(`Failed to process input 'major-keywords': ${errorMessage}`);
    });

    it('should handle non-Error objects thrown during input processing', () => {
      const errorObject = 'A plain string error';
      vi.mocked(getInput).mockImplementation(() => {
        throw errorObject;
      });

      expect(() => createConfigFromInputs()).toThrow(`Failed to process input 'major-keywords': ${String(errorObject)}`);
    });

    it('should process all input types correctly', () => {
      // Mock the GitHub Actions core functions
      vi.mocked(getInput).mockImplementation((name) => {
        const mockValues: Record<string, string> = {
          'major-keywords': 'breaking,major',
          'minor-keywords': 'feat,feature',
          'patch-keywords': 'fix,chore',
          'default-first-tag': 'v1.0.0',
          'terraform-docs-version': 'v0.20.0',
          'wiki-sidebar-changelog-max': '5',
          'module-path-ignore': '',
          'module-change-exclude-patterns': '*.md,tests/**',
          'module-asset-exclude-patterns': '*.md,tests/**',
          'github_token': 'fake-token',
          'tag-directory-separator': '/',
          'use-ssh-source-format': 'false',
        };
        return mockValues[name] || '';
      });

      vi.mocked(getBooleanInput).mockImplementation((name) => {
        const mockBooleans: Record<string, boolean> = {
          'delete-legacy-tags': true,
          'disable-wiki': false,
          'disable-branding': false,
          'use-ssh-source-format': false,
          'use-version-prefix': true,
        };
        return mockBooleans[name] || false;
      });

      const config = createConfigFromInputs();

      // Verify all config properties are set
      expect(config).toEqual({
        majorKeywords: ['breaking', 'major'],
        minorKeywords: ['feat', 'feature'],
        patchKeywords: ['fix', 'chore'],
        defaultFirstTag: 'v1.0.0',
        terraformDocsVersion: 'v0.20.0',
        deleteLegacyTags: true,
        disableWiki: false,
        wikiSidebarChangelogMax: 5,
        disableBranding: false,
        modulePathIgnore: [],
        moduleChangeExcludePatterns: ['*.md', 'tests/**'],
        moduleAssetExcludePatterns: ['*.md', 'tests/**'],
        useSSHSourceFormat: false,
        githubToken: 'fake-token',
        tagDirectorySeparator: '/',
        useVersionPrefix: true,
      });
    });
  });
});
