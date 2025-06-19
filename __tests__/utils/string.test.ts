import { removeLeadingCharacters, removeTrailingCharacters } from '@/utils/string';
import { describe, expect, it } from 'vitest';

describe('utils/string', () => {
  describe('removeLeadingCharacters', () => {
    it('should remove leading dots', () => {
      expect(removeLeadingCharacters('...hello', ['.'])).toBe('hello');
      expect(removeLeadingCharacters('..module-name', ['.'])).toBe('module-name');
      expect(removeLeadingCharacters('.....test', ['.'])).toBe('test');
    });

    it('should remove leading hyphens and underscores', () => {
      expect(removeLeadingCharacters('--module-name', ['-'])).toBe('module-name');
      expect(removeLeadingCharacters('__module_name', ['_'])).toBe('module_name');
      expect(removeLeadingCharacters('-_module-name', ['-', '_'])).toBe('module-name');
    });

    it('should remove multiple leading character types', () => {
      expect(removeLeadingCharacters('._-module-name', ['.', '-', '_'])).toBe('module-name');
      expect(removeLeadingCharacters('.--__test', ['.', '-', '_'])).toBe('test');
      expect(removeLeadingCharacters('___...---example', ['.', '-', '_'])).toBe('example');
    });

    it('should preserve internal characters', () => {
      expect(removeLeadingCharacters('.hello.world', ['.'])).toBe('hello.world');
      expect(removeLeadingCharacters('.-module-name.test', ['.', '-'])).toBe('module-name.test');
      expect(removeLeadingCharacters('_test_module_name', ['_'])).toBe('test_module_name');
    });

    it('should handle edge cases', () => {
      expect(removeLeadingCharacters('', ['.'])).toBe('');
      expect(removeLeadingCharacters('...', ['.'])).toBe('');
      expect(removeLeadingCharacters('---', ['-'])).toBe('');
      expect(removeLeadingCharacters('hello', ['.', '-', '_'])).toBe('hello');
      expect(removeLeadingCharacters('module', [])).toBe('module');
    });

    it('should handle complex terraform module names', () => {
      expect(removeLeadingCharacters('._-aws-vpc-module', ['.', '-', '_'])).toBe('aws-vpc-module');
      expect(removeLeadingCharacters('--tf-modules/vpc-endpoint', ['-', '_'])).toBe('tf-modules/vpc-endpoint');
      expect(removeLeadingCharacters('__modules/networking/vpc', ['_'])).toBe('modules/networking/vpc');
    });

    it('should handle forward slashes in leading characters', () => {
      expect(removeLeadingCharacters('/./module-name', ['/', '.'])).toBe('module-name');
      expect(removeLeadingCharacters('/./_-example', ['/', '.', '_', '-'])).toBe('example');
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

    it('should handle forward slashes in trailing characters', () => {
      expect(removeTrailingCharacters('module-name/.', ['/', '.'])).toBe('module-name');
      expect(removeTrailingCharacters('example-_./', ['/', '.', '_', '-'])).toBe('example');
    });
  });
});
