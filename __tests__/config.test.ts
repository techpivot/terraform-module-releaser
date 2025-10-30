import { clearConfigForTesting, config, getConfig } from '@/config';
import {
  arrayInputs,
  booleanInputs,
  clearEnvironmentInput,
  getConfigKey,
  optionalInputs,
  requiredInputs,
  setupTestInputs,
  stringInputs,
} from '@/tests/helpers/inputs';
import { VALID_TAG_DIRECTORY_SEPARATORS } from '@/utils/constants';
import { endGroup, getBooleanInput, getInput, info, startGroup } from '@actions/core';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe('config', () => {
  beforeAll(() => {
    // We globally mock context to facilitate majority of testing; however,
    // this test case needs to explicitly test core functionality so we reset the
    // mock implementation for this test.
    vi.unmock('@/config');
  });

  beforeEach(() => {
    // The config is cached. To ensure each test starts with a clean slate, we implicity clear it.
    // We don't do this globally in setup as it's not necessary for all tests.
    clearConfigForTesting();
  });

  describe('input validation', () => {
    for (const input of requiredInputs) {
      it(`should throw error when required input "${input}" is missing`, () => {
        clearEnvironmentInput(input);
        expect(() => getConfig()).toThrow(
          new Error(`Failed to process input '${input}': Input required and not supplied: ${input}`),
        );
        expect(getInput).toHaveBeenCalled();
      });
    }

    for (const input of optionalInputs) {
      it(`should handle optional input "${input}" when not present`, () => {
        clearEnvironmentInput(input);
        // Simply verify it doesn't throw without the specific error object
        expect(() => getConfig()).not.toThrow();

        // Get the config and check the actual value
        const config = getConfig();
        // Get the config key using the new getConfigKey function
        const configKey = getConfigKey(input);

        // Type-safe access using the mapping
        if (arrayInputs.includes(input)) {
          // Now configKey is properly typed as keyof Config
          expect(config[configKey]).toEqual([]);
        }
        if (stringInputs.includes(input)) {
          expect(config[configKey]).toEqual('');
        }

        expect(getInput).toHaveBeenCalled();
      });
    }

    for (const input of booleanInputs) {
      it(`should throw error when input "${input}" has an invalid boolean value`, () => {
        setupTestInputs({ [input]: 'invalid-boolean' });
        expect(() => getConfig()).toThrow(
          new Error(
            `Failed to process input '${input}': Input does not meet YAML 1.2 "Core Schema" specification: ${input}\nSupport boolean input list: \`true | True | TRUE | false | False | FALSE\``,
          ),
        );
        expect(getBooleanInput).toHaveBeenCalled();
      });
    }

    it('should throw error when moduleChangeExcludePatterns includes *.tf', () => {
      setupTestInputs({ 'module-change-exclude-patterns': '*.tf,tests/**' });
      expect(() => getConfig()).toThrow(
        new TypeError('Exclude patterns cannot contain "*.tf" as it is required for module detection'),
      );
    });

    it('should throw error when moduleAssetExcludePatterns includes *.tf', () => {
      setupTestInputs({ 'module-asset-exclude-patterns': '*.tf,tests/**' });
      expect(() => getConfig()).toThrow(
        new TypeError('Asset exclude patterns cannot contain "*.tf" as these files are required'),
      );
    });

    it('should handle boolean conversions for various formats', () => {
      const booleanCases = ['true', 'True', 'TRUE', 'false', 'False', 'FALSE'];

      for (const booleanValue of booleanCases) {
        // Ensure we reset the configuration since this is looping inside the test
        clearConfigForTesting();
        vi.unstubAllEnvs();

        // Create the input object with the current boolValue for all booleanInputs
        const booleanInputValuesTest = booleanInputs.reduce((acc: Record<string, string>, key) => {
          acc[key] = booleanValue; // Set each boolean input to the current boolValue
          return acc;
        }, {});

        setupTestInputs(booleanInputValuesTest);

        // Check the boolean conversion for each key in booleanInputs
        const config = getConfig();
        for (const booleanInput of booleanInputs) {
          // Get config key from the mapping, which is already typed as keyof Config
          const configKey = getConfigKey(booleanInput);
          expect(config[configKey]).toBe(booleanValue.toLowerCase() === 'true');
        }
      }
    });

    it('should handle array input parsing and deduplication', () => {
      const arrayTestCases = [
        { input: 'item1,item2,item3', expected: ['item1', 'item2', 'item3'] },
        { input: ' item4 , item5 , item6 ', expected: ['item4', 'item5', 'item6'] },
        { input: 'item7,item7,item8', expected: ['item7', 'item8'] },
        { input: 'item10,,item11,,,item12', expected: ['item10', 'item11', 'item12'] },
      ];

      for (const testCase of arrayTestCases) {
        // Ensure we reset the configuration since this is looping inside the test
        clearConfigForTesting();
        vi.unstubAllEnvs();

        // Create test inputs for all array inputs
        const arrayInputValuesTest = arrayInputs.reduce((acc: Record<string, string>, key) => {
          acc[key] = testCase.input;
          return acc;
        }, {});

        setupTestInputs(arrayInputValuesTest);

        // Check array parsing for each array input
        const config = getConfig();
        for (const arrayInput of arrayInputs) {
          const configKey = getConfigKey(arrayInput);
          expect(config[configKey]).toEqual(testCase.expected);
        }
      }
    });

    it('should throw error for required array inputs when empty string is provided', () => {
      const requiredArrayInputs = arrayInputs.filter((input) => requiredInputs.includes(input));

      for (const input of requiredArrayInputs) {
        clearConfigForTesting();
        vi.unstubAllEnvs();

        // Set the required array input to empty string
        setupTestInputs({ [input]: '' });

        expect(() => getConfig()).toThrow(
          new Error(`Failed to process input '${input}': Input required and not supplied: ${input}`),
        );
      }
    });

    it('should return empty array for optional array inputs when empty string is provided', () => {
      const optionalArrayInputs = arrayInputs.filter((input) => optionalInputs.includes(input));

      for (const input of optionalArrayInputs) {
        clearConfigForTesting();
        vi.unstubAllEnvs();

        // Set the optional array input to empty string
        setupTestInputs({ [input]: '' });

        const config = getConfig();
        const configKey = getConfigKey(input);
        expect(config[configKey]).toEqual([]);
      }
    });

    it('should throw error for non-numeric wiki-sidebar-changelog-max', () => {
      setupTestInputs({ 'wiki-sidebar-changelog-max': 'invalid' });
      expect(() => getConfig()).toThrow(
        new TypeError('Wiki Sidebar Change Log Max must be an integer greater than or equal to one'),
      );
    });

    it('should throw error for 0 wiki-sidebar-changelog-max', () => {
      setupTestInputs({ 'wiki-sidebar-changelog-max': '0' });
      expect(() => getConfig()).toThrow(
        new TypeError('Wiki Sidebar Change Log Max must be an integer greater than or equal to one'),
      );
    });

    it('should throw error for invalid tag directory separator length', () => {
      setupTestInputs({ 'tag-directory-separator': 'ab' });
      expect(() => getConfig()).toThrow(new TypeError('Tag directory separator must be exactly one character'));
    });

    it('should throw error for invalid tag directory separator character', () => {
      setupTestInputs({ 'tag-directory-separator': '@' });
      expect(() => getConfig()).toThrow(
        new TypeError(`Tag directory separator must be one of: ${VALID_TAG_DIRECTORY_SEPARATORS.join(', ')}. Got: '@'`),
      );
    });

    it('should allow valid tag directory separators', () => {
      for (const separator of VALID_TAG_DIRECTORY_SEPARATORS) {
        clearConfigForTesting();
        vi.unstubAllEnvs();
        setupTestInputs({ 'tag-directory-separator': separator });
        const config = getConfig();
        expect(config.tagDirectorySeparator).toBe(separator);
      }
    });

    it('should throw error for invalid default first tag format', () => {
      setupTestInputs({ 'default-first-tag': 'invalid-tag' });
      expect(() => getConfig()).toThrow(
        new TypeError(
          "Default first tag must be in format v#.#.# or #.#.# (e.g., v1.0.0 or 1.0.0). Got: 'invalid-tag'",
        ),
      );

      clearConfigForTesting();
      setupTestInputs({ 'default-first-tag': 'v1.0' });
      expect(() => getConfig()).toThrow(
        new TypeError("Default first tag must be in format v#.#.# or #.#.# (e.g., v1.0.0 or 1.0.0). Got: 'v1.0'"),
      );
    });

    it('should throw error for invalid module-ref-mode', () => {
      setupTestInputs({ 'module-ref-mode': 'invalid' });
      expect(() => getConfig()).toThrow(new TypeError("Invalid module_ref_mode 'invalid'. Must be one of: tag, sha"));

      clearConfigForTesting();
      vi.unstubAllEnvs();
      setupTestInputs({ 'module-ref-mode': 'TAG' });
      expect(() => getConfig()).toThrow(new TypeError("Invalid module_ref_mode 'TAG'. Must be one of: tag, sha"));
    });

    it('should allow valid module-ref-mode values', () => {
      setupTestInputs({ 'module-ref-mode': 'tag' });
      let config = getConfig();
      expect(config.moduleRefMode).toBe('tag');

      clearConfigForTesting();
      vi.unstubAllEnvs();
      setupTestInputs({ 'module-ref-mode': 'sha' });
      config = getConfig();
      expect(config.moduleRefMode).toBe('sha');
    });
  });

  describe('initialization', () => {
    it('should maintain singleton instance across multiple imports', () => {
      const firstInstance = getConfig();
      const secondInstance = getConfig();
      expect(firstInstance).toBe(secondInstance);
      expect(startGroup).toHaveBeenCalledTimes(1);
      expect(endGroup).toHaveBeenCalledTimes(1);
    });

    it('should initialize with valid default inputs', () => {
      const config = getConfig();

      expect(config.majorKeywords).toEqual(['major change', 'breaking change']);
      expect(config.minorKeywords).toEqual(['feat', 'feature']);
      expect(config.patchKeywords).toEqual(['fix', 'chore', 'docs']);
      expect(config.defaultFirstTag).toBe('v1.0.0');
      expect(config.terraformDocsVersion).toBe('v0.20.0');
      expect(config.deleteLegacyTags).toBe(true);
      expect(config.disableWiki).toBe(false);
      expect(config.wikiSidebarChangelogMax).toBe(5);
      expect(config.disableBranding).toBe(false);
      expect(config.githubToken).toBe('ghp_test_token_2c6912E7710c838347Ae178B4');
      expect(config.modulePathIgnore).toEqual([]);
      expect(config.moduleChangeExcludePatterns).toEqual(['.gitignore', '*.md', '*.tftest.hcl', 'tests/**']);
      expect(config.moduleAssetExcludePatterns).toEqual(['.gitignore', '*.md', '*.tftest.hcl', 'tests/**']);
      expect(config.useSSHSourceFormat).toBe(false);
      expect(config.tagDirectorySeparator).toBe('/');
      expect(config.useVersionPrefix).toBe(true);
      expect(config.moduleRefMode).toBe('tag');
      expect(config.stripTerraformProviderPrefix).toBe(false);

      expect(startGroup).toHaveBeenCalledWith('Initializing Config');
      expect(startGroup).toHaveBeenCalledTimes(1);
      expect(endGroup).toHaveBeenCalledTimes(1);
      expect(vi.mocked(info).mock.calls).toEqual([
        ['Major Keywords: major change, breaking change'],
        ['Minor Keywords: feat, feature'],
        ['Patch Keywords: fix, chore, docs'],
        ['Default First Tag: v1.0.0'],
        ['Terraform Docs Version: v0.20.0'],
        ['Delete Legacy Tags: true'],
        ['Disable Wiki: false'],
        ['Wiki Sidebar Changelog Max: 5'],
        ['Module Paths to Ignore: '],
        ['Module Change Exclude Patterns: .gitignore, *.md, *.tftest.hcl, tests/**'],
        ['Module Asset Exclude Patterns: .gitignore, *.md, *.tftest.hcl, tests/**'],
        ['Use SSH Source Format: false'],
        ['Tag Directory Separator: /'],
        ['Use Version Prefix: true'],
        ['Module Ref Mode: tag'],
        ['Strip Terraform Provider Prefix: false'],
      ]);
    });
  });

  describe('config proxy', () => {
    it('should proxy config properties', () => {
      const proxyMajorKeywords = config.majorKeywords;
      const getterMajorKeywords = getConfig().majorKeywords;
      expect(proxyMajorKeywords).toEqual(getterMajorKeywords);
      expect(startGroup).toHaveBeenCalledWith('Initializing Config');
      expect(info).toHaveBeenCalled();

      // Reset mock call counts
      vi.mocked(startGroup).mockClear();
      vi.mocked(info).mockClear();

      // Second access should not trigger initialization
      const proxyMinorKeywords = config.minorKeywords;
      const getterMinorKeywords = getConfig().minorKeywords;
      expect(proxyMinorKeywords).toEqual(getterMinorKeywords);
      expect(startGroup).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
    });
  });
});
