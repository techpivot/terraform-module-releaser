import { trimSlashes } from '@/utils/string';
import { describe, expect, it } from 'vitest';

describe('string', () => {
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
});
