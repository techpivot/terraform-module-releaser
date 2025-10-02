import { resolveTagToCommitSHA } from '@/utils/git';
import { ALLOWED_MODULE_REF_MODES, MODULE_REF_MODE_SHA, MODULE_REF_MODE_TAG, isModuleRefMode } from '@/utils/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';

// Mock node:child_process
vi.mock('node:child_process');
// Mock which to return a git path
vi.mock('which', () => ({
  default: {
    sync: vi.fn(() => '/usr/bin/git'),
  },
}));

describe('utils/git', () => {
  describe('isModuleRefMode', () => {
    it('should return true for valid module ref modes', () => {
      expect(isModuleRefMode('tag')).toBe(true);
      expect(isModuleRefMode('sha')).toBe(true);
    });

    it('should return false for invalid module ref modes', () => {
      expect(isModuleRefMode('invalid')).toBe(false);
      expect(isModuleRefMode('TAG')).toBe(false);
      expect(isModuleRefMode('SHA')).toBe(false);
      expect(isModuleRefMode('')).toBe(false);
      expect(isModuleRefMode(null)).toBe(false);
      expect(isModuleRefMode(undefined)).toBe(false);
      expect(isModuleRefMode(123)).toBe(false);
      expect(isModuleRefMode({})).toBe(false);
    });

    it('should work with constants', () => {
      expect(isModuleRefMode(MODULE_REF_MODE_TAG)).toBe(true);
      expect(isModuleRefMode(MODULE_REF_MODE_SHA)).toBe(true);
    });
  });

  describe('constants', () => {
    it('should have correct module ref mode constants', () => {
      expect(MODULE_REF_MODE_TAG).toBe('tag');
      expect(MODULE_REF_MODE_SHA).toBe('sha');
      expect(ALLOWED_MODULE_REF_MODES).toEqual(['tag', 'sha']);
    });
  });

  describe('resolveTagToCommitSHA', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should resolve a tag to its commit SHA', () => {
      const mockSHA = 'ee4e1294eb806447b36eaa5e000947449eab4fc4';
      vi.mocked(execFileSync).mockReturnValue(`${mockSHA}\n`);

      const result = resolveTagToCommitSHA('aws/vpc-endpoint/v1.1.3');

      expect(result).toBe(mockSHA);
      expect(execFileSync).toHaveBeenCalledWith(
        '/usr/bin/git',
        ['rev-parse', 'aws/vpc-endpoint/v1.1.3^{}'],
        expect.objectContaining({
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
      );
    });

    it('should handle tags without newlines', () => {
      const mockSHA = 'abc123def456';
      vi.mocked(execFileSync).mockReturnValue(mockSHA);

      const result = resolveTagToCommitSHA('module/v1.0.0');

      expect(result).toBe(mockSHA);
    });

    it('should trim whitespace from git output', () => {
      const mockSHA = 'abc123def456';
      vi.mocked(execFileSync).mockReturnValue(`  ${mockSHA}  \n`);

      const result = resolveTagToCommitSHA('module/v1.0.0');

      expect(result).toBe(mockSHA);
    });

    it('should throw error when tag does not exist', () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        const error = new Error("fatal: Not a valid object name: 'nonexistent-tag^{}'") as Error & { status: number };
        error.status = 128;
        throw error;
      });

      expect(() => resolveTagToCommitSHA('nonexistent-tag')).toThrow(
        "Failed to resolve tag 'nonexistent-tag' to commit SHA",
      );
    });

    it('should throw error with original error message', () => {
      const originalError = new Error('git command failed');
      vi.mocked(execFileSync).mockImplementation(() => {
        throw originalError;
      });

      expect(() => resolveTagToCommitSHA('some/tag')).toThrow(/Failed to resolve tag 'some\/tag' to commit SHA/);
      expect(() => resolveTagToCommitSHA('some/tag')).toThrow(/git command failed/);
    });
  });
});
