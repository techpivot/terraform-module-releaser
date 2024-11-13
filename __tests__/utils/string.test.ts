import { removeTrailingDots, trimSlashes } from '@/utils/string';
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

  describe('removeTrailingDots', () => {
    it('should remove all trailing dots from a string', () => {
      expect(removeTrailingDots('hello...')).toBe('hello');
      expect(removeTrailingDots('module-name..')).toBe('module-name');
      expect(removeTrailingDots('test.....')).toBe('test');
    });

    it('should preserve internal dots', () => {
      expect(removeTrailingDots('hello.world')).toBe('hello.world');
      expect(removeTrailingDots('module.name.test')).toBe('module.name.test');
    });

    it('should handle edge cases', () => {
      expect(removeTrailingDots('')).toBe('');
      expect(removeTrailingDots('...')).toBe('');
      expect(removeTrailingDots('.')).toBe('');
      expect(removeTrailingDots('hello')).toBe('hello');
    });
  });
});
