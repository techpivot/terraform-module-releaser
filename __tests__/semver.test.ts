import { describe, expect, it } from 'vitest';
import { determineReleaseType, getNextTagVersion } from '../src/semver';
import { configMock } from './__mocks__/config.mock';

describe('semver', () => {
  describe('determineReleaseType', () => {
    it('should return major when commit message contains major keyword', () => {
      configMock.set({
        majorKeywords: ['major change', 'breaking change'],
      });
      const message = 'BREAKING CHANGE: completely restructured API';
      expect(determineReleaseType(message)).toBe('major');
    });

    it('should return minor when commit message contains minor keyword', () => {
      const message = 'feat: added new feature';
      expect(determineReleaseType(message)).toBe('minor');
    });

    it('should return patch by default for regular commit messages', () => {
      const message = 'fix: fixed a small bug';
      expect(determineReleaseType(message)).toBe('patch');
    });

    it('should be case insensitive when checking keywords', () => {
      configMock.set({
        majorKeywords: ['BReaKING CHANGE', '!', 'major CHANGE'],
      });
      const message = 'bReAkInG cHaNgE: major update';
      expect(determineReleaseType(message)).toBe('major');
    });

    it('should handle empty commit messages', () => {
      expect(determineReleaseType('')).toBe('patch');
    });

    it('should consider previous release type when determining new release type', () => {
      // If previous release was major, next should be major regardless of message
      expect(determineReleaseType('fix: small update', 'major')).toBe('major');

      // If previous release was minor, next should be at least minor
      expect(determineReleaseType('fix: small update', 'minor')).toBe('minor');

      // If previous was patch, message determines new type
      expect(determineReleaseType('fix: small update', 'patch')).toBe('patch');
    });

    it('should handle null previous release type', () => {
      expect(determineReleaseType('fix: small update', null)).toBe('patch');
    });

    it('should trim whitespace from commit messages', () => {
      const message = '   BREAKING CHANGE: major update   ';
      expect(determineReleaseType(message)).toBe('major');
    });
  });

  describe('getNextTagVersion', () => {
    it('should return default first tag when latest tag is null', () => {
      const defaultTag = 'v3.5.1';
      configMock.set({
        defaultFirstTag: defaultTag,
      });
      expect(getNextTagVersion(null, 'patch')).toBe(defaultTag);
    });

    it('should increment major version correctly', () => {
      expect(getNextTagVersion('v1.2.3', 'major')).toBe('v2.0.0');
    });

    it('should increment minor version correctly', () => {
      expect(getNextTagVersion('v1.2.3', 'minor')).toBe('v1.3.0');
    });

    it('should increment patch version correctly', () => {
      expect(getNextTagVersion('v1.2.3', 'patch')).toBe('v1.2.4');
    });

    it('should handle version tags without v prefix', () => {
      expect(getNextTagVersion('1.2.3', 'major')).toBe('v2.0.0');
      expect(getNextTagVersion('1.2.3', 'minor')).toBe('v1.3.0');
      expect(getNextTagVersion('1.2.3', 'patch')).toBe('v1.2.4');
    });

    it('should reset minor and patch versions when incrementing major', () => {
      expect(getNextTagVersion('v1.2.3', 'major')).toBe('v2.0.0');
    });

    it('should reset patch version when incrementing minor', () => {
      expect(getNextTagVersion('v1.2.3', 'minor')).toBe('v1.3.0');
    });

    it('should handle version numbers with single digits', () => {
      expect(getNextTagVersion('v1.0.0', 'patch')).toBe('v1.0.1');
    });

    it('should handle version numbers with multiple digits', () => {
      expect(getNextTagVersion('v10.20.30', 'patch')).toBe('v10.20.31');
    });
  });
});
