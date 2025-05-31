import { removeTrailingCharacters, trimSlashes } from '@/utils/string';
import { describe, expect, it } from 'vitest';

describe('utils/string', () => {
  describe('trimSlashes', () => {
    it('should remove leading and trailing slashes while preserving internal ones', () => {
      const testCases = [
        { input: '/example/path/', expected: 'example/path' },
        { input: '///another/example///', expected: 'another/example' },
        { input: 'no/slashes', expected: 'no/slashes' },
        { input: '/', expected: '' },
        { input: '//', expected: '' },
        { input: '', expected: '' },
        { input: '/single/', expected: 'single' },
        { input: 'leading/', expected: 'leading' },
        { input: '/trailing', expected: 'trailing' },
        { input: '////multiple////slashes////', expected: 'multiple////slashes' },
      ];
      for (const { input, expected } of testCases) {
        expect(trimSlashes(input)).toBe(expected);
      }
    });

    it('should handle strings without any slashes', () => {
      expect(trimSlashes('hello')).toBe('hello');
    });

    it('should return empty string when given only slashes', () => {
      expect(trimSlashes('//////')).toBe('');
    });

    it('should preserve internal multiple slashes', () => {
      expect(trimSlashes('/path//with///internal////slashes/')).toBe('path//with///internal////slashes');
    });
  });

  describe('removeTrailingDots (deprecated)', () => {
    it('should remove all trailing dots from a string', () => {
      expect(removeTrailingCharacters('hello...', ['.'])).toBe('hello');
      expect(removeTrailingCharacters('module-name..', ['.'])).toBe('module-name');
      expect(removeTrailingCharacters('test.....', ['.'])).toBe('test');
    });

    it('should preserve internal dots', () => {
      expect(removeTrailingCharacters('hello.world', ['.'])).toBe('hello.world');
      expect(removeTrailingCharacters('module.name.test', ['.'])).toBe('module.name.test');
    });

    it('should handle edge cases', () => {
      expect(removeTrailingCharacters('', ['.'])).toBe('');
      expect(removeTrailingCharacters('...', ['.'])).toBe('');
      expect(removeTrailingCharacters('.', ['.'])).toBe('');
      expect(removeTrailingCharacters('hello', ['.'])).toBe('hello');
    });
  });

  describe('removeTrailingCharacters', () => {
    it('should remove trailing dots', () => {
      expect(removeTrailingCharacters('hello...', ['.'])).toBe('hello');
      expect(removeTrailingCharacters('module-name..', ['.'])).toBe('module-name');
      expect(removeTrailingCharacters('test.....', ['.'])).toBe('test');
    });

    it('should remove trailing hyphens and underscores', () => {
      expect(removeTrailingCharacters('module-name--', ['-'])).toBe('module-name');
      expect(removeTrailingCharacters('module_name__', ['_'])).toBe('module_name');
      expect(removeTrailingCharacters('module-name-_', ['-', '_'])).toBe('module-name');
    });

    it('should remove multiple trailing character types', () => {
      expect(removeTrailingCharacters('module-name-_.', ['.', '-', '_'])).toBe('module-name');
      expect(removeTrailingCharacters('test.--__..', ['.', '-', '_'])).toBe('test');
      expect(removeTrailingCharacters('example___...---', ['.', '-', '_'])).toBe('example');
    });

    it('should preserve internal characters', () => {
      expect(removeTrailingCharacters('hello.world', ['.'])).toBe('hello.world');
      expect(removeTrailingCharacters('module-name.test', ['.', '-'])).toBe('module-name.test');
      expect(removeTrailingCharacters('test_module_name', ['_'])).toBe('test_module_name');
    });

    it('should handle edge cases', () => {
      expect(removeTrailingCharacters('', ['.'])).toBe('');
      expect(removeTrailingCharacters('...', ['.'])).toBe('');
      expect(removeTrailingCharacters('---', ['-'])).toBe('');
      expect(removeTrailingCharacters('hello', ['.', '-', '_'])).toBe('hello');
      expect(removeTrailingCharacters('module', [])).toBe('module');
    });

    it('should handle complex terraform module names', () => {
      expect(removeTrailingCharacters('aws-vpc-module-_.', ['.', '-', '_'])).toBe('aws-vpc-module');
      expect(removeTrailingCharacters('tf-modules/vpc-endpoint--', ['-', '_'])).toBe('tf-modules/vpc-endpoint');
      expect(removeTrailingCharacters('modules/networking/vpc__', ['_'])).toBe('modules/networking/vpc');
    });
  });
});
