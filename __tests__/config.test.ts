import * as core from '@actions/core';
import { clearConfigForTesting, config, getConfig } from '../src/config';
import type { Config } from '../src/config';

const originalGetInput = core.getInput;

type InputMap = {
  [key: string]: string;
};

describe('config.ts', () => {
  const defaultInputs: InputMap = {
    'major-keywords': 'BREAKING CHANGE,!',
    'minor-keywords': 'feat,feature',
    'patch-keywords': 'fix,chore',
    'default-first-tag': 'v0.1.0',
    'terraform-docs-version': 'v0.16.0',
    'delete-legacy-tags': 'false',
    'disable-wiki': 'false',
    'wiki-sidebar-changelog-max': '10',
    'disable-branding': 'false',
    'module-change-exclude-patterns': '.gitignore,*.md',
    'module-asset-exclude-patterns': 'tests/**,examples/**',
    github_token: 'test-token',
  };

  const booleanInputs = ['delete-legacy-tags', 'disable-wiki', 'disable-branding'];
  const booleanConfigKeys = ['deleteLegacyTags', 'disableWiki', 'disableBranding'] as Array<keyof Config>;

  const mockInfo = jest.spyOn(core, 'info');
  const mockStartGroup = jest.spyOn(core, 'startGroup');
  const mockEndGroup = jest.spyOn(core, 'endGroup');
  const mockGetInput = jest.spyOn(core, 'getInput');
  const mockGetBooleanInput = jest.spyOn(core, 'getBooleanInput');

  // The beforeEach() hook runs before each it() (test case)
  beforeEach(() => {
    jest.resetAllMocks();
    clearConfigForTesting();

    // Mock getInput to use our defaults
    mockGetInput.mockImplementation((name) => {
      return defaultInputs[name];
    });

    // Mock getBooleanInput to Use the Original Implementation with Mocked Dependencies
    mockGetBooleanInput.mockImplementation((name) => {
      const trueValue = ['true', 'True', 'TRUE'];
      const falseValue = ['false', 'False', 'FALSE'];
      const val = core.getInput(name);
      if (trueValue.includes(val)) {
        return true;
      }
      if (falseValue.includes(val)) {
        return false;
      }
      throw new TypeError(
        `Input does not meet YAML 1.2 "Core Schema" specification: ${name}\nSupport boolean input list: \`true | True | TRUE | false | False | FALSE\``,
      );
    });
  });

  describe('required inputs validation', () => {
    const requiredInputs = Object.keys(defaultInputs);

    for (const input of requiredInputs) {
      it(`should throw error when ${input} is missing`, () => {
        // Spy on the original getInput function
        mockGetBooleanInput.mockImplementation((name) => {
          core.getInput(name, { required: true }); // proxy to below method
          return false; // emulate required return type (not being used in this test)
        });
        mockGetInput.mockImplementation((name) => {
          if (name === input) {
            // Proxy to call the original method for the required input where we know
            // it will throw an error since the variable is not defined.
            return originalGetInput(name, { required: true });
          }
          // Return the default value for other inputs
          return defaultInputs[name];
        });

        // Test the configuration initialization
        expect(() => getConfig()).toThrow(new Error(`Input required and not supplied: ${input}`));
      });
    }
  });

  describe('input validation', () => {
    for (const input of booleanInputs) {
      it(`should throw error when ${input} has an invalid boolean value`, () => {
        // Set invalid value for this input
        mockGetInput.mockImplementation((name) => (name === input ? 'invalid-boolean' : defaultInputs[name]));

        // Test the configuration initialization
        expect(() => getConfig()).toThrow(
          new TypeError(
            `Input does not meet YAML 1.2 "Core Schema" specification: ${input}\nSupport boolean input list: \`true | True | TRUE | false | False | FALSE\``,
          ),
        );
      });
    }

    it('should throw error when moduleChangeExcludePatterns includes *.tf', () => {
      mockGetInput.mockImplementation(
        (name) =>
          ({
            ...defaultInputs,
            'module-change-exclude-patterns': '*.tf,tests/**',
          })[name] ?? '',
      );

      // Test the configuration initialization
      expect(() => getConfig()).toThrow(
        new TypeError('Exclude patterns cannot contain "*.tf" as it is required for module detection'),
      );
    });

    it('should throw error when moduleAssetExcludePatterns includes *.tf', async () => {
      mockGetInput.mockImplementation(
        (name) =>
          ({
            ...defaultInputs,
            'module-asset-exclude-patterns': '*.tf,tests/**',
          })[name] ?? '',
      );

      // Test the configuration initialization
      expect(() => getConfig()).toThrow(
        new TypeError('Asset exclude patterns cannot contain "*.tf" as these files are required'),
      );
    });

    it('should handle boolean conversions for various formats', async () => {
      const booleanCases = ['true', 'True', 'TRUE', 'false', 'False', 'FALSE'];

      for (const boolValue of booleanCases) {
        // Ensure we reset the configuration since this is looping inside the test
        clearConfigForTesting();

        // Create the input object with the current boolValue for all booleanInputs
        const booleanInputValues = booleanInputs.reduce((acc, key) => {
          acc[key] = boolValue; // Set each boolean input to the current boolValue
          return acc;
        }, {} as InputMap);

        // Mock getInput to return the combined defaultInputs and booleanInputValues
        mockGetInput.mockImplementation(
          (name: keyof InputMap) =>
            ({
              ...defaultInputs,
              ...booleanInputValues,
            })[name] ?? '',
        );

        const config = getConfig();

        // Check the boolean conversion for each key in booleanInputs
        for (const inputKey of booleanConfigKeys) {
          expect(config[inputKey]).toBe(boolValue.toLowerCase() === 'true');
        }
      }
    });

    it('should throw error for non-numeric wiki-sidebar-changelog-max', async () => {
      mockGetInput.mockImplementation(
        (name) =>
          ({
            ...defaultInputs,
            'wiki-sidebar-changelog-max': 'invalid',
          })[name] ?? '',
      );

      expect(() => getConfig()).toThrow(
        new TypeError('Wiki Sidebar Change Log Max must be an integer greater than or equal to one'),
      );
    });

    it('should throw error for 0 wiki-sidebar-changelog-max', async () => {
      mockGetInput.mockImplementation(
        (name) =>
          ({
            ...defaultInputs,
            'wiki-sidebar-changelog-max': '0',
          })[name] ?? '',
      );

      expect(() => getConfig()).toThrow(
        new TypeError('Wiki Sidebar Change Log Max must be an integer greater than or equal to one'),
      );
    });
  });

  describe('initialization', () => {
    it('should initialize with valid inputs and log configuration', async () => {
      const config = getConfig();

      expect(config.majorKeywords).toEqual(['BREAKING CHANGE', '!']);
      expect(config.minorKeywords).toEqual(['feat', 'feature']);
      expect(config.patchKeywords).toEqual(['fix', 'chore']);
      expect(config.defaultFirstTag).toBe('v0.1.0');
      expect(config.terraformDocsVersion).toBe('v0.16.0');
      expect(config.deleteLegacyTags).toBe(false);
      expect(config.disableWiki).toBe(false);
      expect(config.wikiSidebarChangelogMax).toBe(10);
      expect(config.disableBranding).toBe(false);
      expect(config.githubToken).toBe('test-token');
      expect(config.moduleChangeExcludePatterns).toEqual(['.gitignore', '*.md']);
      expect(config.moduleAssetExcludePatterns).toEqual(['tests/**', 'examples/**']);
      expect(mockStartGroup).toHaveBeenCalledWith('Initializing Config');
      expect(mockStartGroup).toHaveBeenCalledTimes(1);
      expect(mockEndGroup).toHaveBeenCalledTimes(1);
      expect(mockInfo).toHaveBeenCalledTimes(10);
      expect(mockInfo.mock.calls).toEqual([
        ['Major Keywords: BREAKING CHANGE, !'],
        ['Minor Keywords: feat, feature'],
        ['Patch Keywords: fix, chore'],
        ['Default First Tag: v0.1.0'],
        ['Terraform Docs Version: v0.16.0'],
        ['Delete Legacy Tags: false'],
        ['Disable Wiki: false'],
        ['Wiki Sidebar Changelog Max: 10'],
        ['Module Change Exclude Patterns: .gitignore, *.md'],
        ['Module Asset Exclude Patterns: tests/**, examples/**'],
      ]);
      expect(mockInfo).toHaveBeenCalledTimes(10);
    });

    it('should maintain singleton instance across multiple imports', async () => {
      const firstInstance = getConfig();
      const secondInstance = getConfig();

      expect(firstInstance).toBe(secondInstance);
      expect(mockStartGroup).toHaveBeenCalledTimes(1);
      expect(mockEndGroup).toHaveBeenCalledTimes(1);
    });
  });

  describe('proxy getters', () => {
    it('should proxy the config', async () => {
      const assertUnused = (arg: string[]) => {};

      // First access should trigger initialization
      const _majorKeywords = config.majorKeywords;
      assertUnused(_majorKeywords);
      expect(mockStartGroup).toHaveBeenCalledWith('Initializing Config');
      expect(mockInfo).toHaveBeenCalled();

      // Reset mock call counts
      mockStartGroup.mockClear();
      mockInfo.mockClear();

      // Second access should not trigger initialization
      const _minorKeywords = config.minorKeywords;
      assertUnused(_minorKeywords);
      expect(mockStartGroup).not.toHaveBeenCalled();
      expect(mockInfo).not.toHaveBeenCalled();
    });
  });

  describe('input formatting', () => {
    it('should handle various whitespace and duplicates in comma-separated inputs', async () => {
      mockGetInput.mockImplementation(
        (name: keyof InputMap) =>
          ({
            ...defaultInputs,
            'major-keywords': ' BREAKING CHANGE ,  ! ',
            'minor-keywords': '\tfeat,\nfeature\r,feat',
          })[name] ?? '',
      );

      const config = getConfig();
      expect(config.majorKeywords).toEqual(['BREAKING CHANGE', '!']);
      expect(config.minorKeywords).toEqual(['feat', 'feature']);
    });

    it('should filter out empty items in arrays', async () => {
      mockGetInput.mockImplementation(
        (name: keyof InputMap) =>
          ({
            ...defaultInputs,
            'major-keywords': 'BREAKING CHANGE,,!,,,',
            'module-change-exclude-patterns': ',.gitignore,,*.md,,',
          })[name] ?? '',
      );

      const config = getConfig();
      expect(config.majorKeywords).toEqual(['BREAKING CHANGE', '!']);
      expect(config.moduleChangeExcludePatterns).toEqual(['.gitignore', '*.md']);
    });
  });
});
