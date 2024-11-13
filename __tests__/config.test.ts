import { clearConfigForTesting, config, getConfig } from '@/config';
import { booleanConfigKeys, booleanInputs, requiredInputs, stubInputEnv } from '@/tests/helpers/inputs';
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
    clearConfigForTesting();
    // Note: We don't stubInputEnv here as there are cases where we want to test default inputs and
    // in this case we would have to do a full reset of the config.
  });

  describe('input validation', () => {
    for (const input of requiredInputs) {
      it(`should throw error when required input "${input}" is missing`, () => {
        stubInputEnv({ [input]: null });
        expect(() => getConfig()).toThrow(new Error(`Input required and not supplied: ${input}`));
        expect(getInput).toHaveBeenCalled();
      });
    }

    for (const input of booleanInputs) {
      it(`should throw error when input "${input}" has an invalid boolean value`, () => {
        stubInputEnv({ [input]: 'invalid-boolean' });
        expect(() => getConfig()).toThrow(
          new TypeError(
            `Input does not meet YAML 1.2 "Core Schema" specification: ${input}\nSupport boolean input list: \`true | True | TRUE | false | False | FALSE\``,
          ),
        );
        expect(getBooleanInput).toHaveBeenCalled();
      });
    }

    it('should throw error when moduleChangeExcludePatterns includes *.tf', () => {
      stubInputEnv({ 'module-change-exclude-patterns': '*.tf,tests/**' });
      expect(() => getConfig()).toThrow(
        new TypeError('Exclude patterns cannot contain "*.tf" as it is required for module detection'),
      );
    });

    it('should throw error when moduleAssetExcludePatterns includes *.tf', () => {
      stubInputEnv({ 'module-asset-exclude-patterns': '*.tf,tests/**' });
      expect(() => getConfig()).toThrow(
        new TypeError('Asset exclude patterns cannot contain "*.tf" as these files are required'),
      );
    });

    it('should handle boolean conversions for various formats', async () => {
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

        stubInputEnv(booleanInputValuesTest);

        // Check the boolean conversion for each key in booleanInputs
        const config = getConfig();
        for (const inputKey of booleanConfigKeys) {
          expect(config[inputKey]).toBe(booleanValue.toLowerCase() === 'true');
        }
      }
    });

    it('should throw error for non-numeric wiki-sidebar-changelog-max', () => {
      stubInputEnv({ 'wiki-sidebar-changelog-max': 'invalid' });
      expect(() => getConfig()).toThrow(
        new TypeError('Wiki Sidebar Change Log Max must be an integer greater than or equal to one'),
      );
    });

    it('should throw error for 0 wiki-sidebar-changelog-max', () => {
      stubInputEnv({ 'wiki-sidebar-changelog-max': '0' });
      expect(() => getConfig()).toThrow(
        new TypeError('Wiki Sidebar Change Log Max must be an integer greater than or equal to one'),
      );
    });
  });

  describe('initialization', () => {
    it('should maintain singleton instance across multiple imports', () => {
      stubInputEnv();
      const firstInstance = getConfig();
      const secondInstance = getConfig();
      expect(firstInstance).toBe(secondInstance);
      expect(startGroup).toHaveBeenCalledTimes(1);
      expect(endGroup).toHaveBeenCalledTimes(1);
    });

    it('should initialize with valid inputs and log configuration', () => {
      stubInputEnv();
      const config = getConfig();

      expect(config.majorKeywords).toEqual(['MAJOR CHANGE', 'BREAKING CHANGE', '!']);
      expect(config.minorKeywords).toEqual(['feat', 'feature']);
      expect(config.patchKeywords).toEqual(['fix', 'chore']);
      expect(config.defaultFirstTag).toBe('v0.1.0');
      expect(config.terraformDocsVersion).toBe('v0.19.0');
      expect(config.deleteLegacyTags).toBe(false);
      expect(config.disableWiki).toBe(false);
      expect(config.wikiSidebarChangelogMax).toBe(10);
      expect(config.disableBranding).toBe(false);
      expect(config.githubToken).toBe('ghp_test_token_2c6912E7710c838347Ae178B4');
      expect(config.moduleChangeExcludePatterns).toEqual(['.gitignore', '*.md']);
      expect(config.moduleAssetExcludePatterns).toEqual(['tests/**', 'examples/**']);
      expect(startGroup).toHaveBeenCalledWith('Initializing Config');
      expect(startGroup).toHaveBeenCalledTimes(1);
      expect(endGroup).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledTimes(10);
      expect(vi.mocked(info).mock.calls).toEqual([
        ['Major Keywords: MAJOR CHANGE, BREAKING CHANGE, !'],
        ['Minor Keywords: feat, feature'],
        ['Patch Keywords: fix, chore'],
        ['Default First Tag: v0.1.0'],
        ['Terraform Docs Version: v0.19.0'],
        ['Delete Legacy Tags: false'],
        ['Disable Wiki: false'],
        ['Wiki Sidebar Changelog Max: 10'],
        ['Module Change Exclude Patterns: .gitignore, *.md'],
        ['Module Asset Exclude Patterns: tests/**, examples/**'],
      ]);
      expect(info).toHaveBeenCalledTimes(10);
    });
  });

  describe('config proxy', () => {
    it('should proxy config properties', () => {
      stubInputEnv();
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

  describe('input formatting', () => {
    it('should handle various whitespace and duplicates in comma-separated inputs', () => {
      stubInputEnv({
        'major-keywords': ' BREAKING CHANGE ,  ! ',
        'minor-keywords': '\tfeat,\nfeature\r,feat',
      });
      const config = getConfig();
      expect(config.majorKeywords).toEqual(['BREAKING CHANGE', '!']);
      expect(config.minorKeywords).toEqual(['feat', 'feature']);
    });

    it('should filter out empty items in arrays', async () => {
      stubInputEnv({
        'major-keywords': 'BREAKING CHANGE,,!,,,',
        'module-change-exclude-patterns': ',.gitignore,,*.md,,',
      });
      const config = getConfig();
      expect(config.majorKeywords).toEqual(['BREAKING CHANGE', '!']);
      expect(config.moduleChangeExcludePatterns).toEqual(['.gitignore', '*.md']);
    });
  });
});
