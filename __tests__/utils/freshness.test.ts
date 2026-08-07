import { context } from '@/mocks/context';
import { stubOctokitReturnData } from '@/tests/helpers/octokit';
import { isCheckoutCurrent, pathExistsOnBaseRef } from '@/utils/freshness';
import { info, warning } from '@actions/core';
import { RequestError } from '@octokit/request-error';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('utils/freshness', () => {
  beforeEach(() => {
    context.useMockOctokit();
    context.set({ baseRef: 'main', mergeCommitSha: 'merge-commit-sha' });
  });

  describe('isCheckoutCurrent()', () => {
    it('returns true when the base branch tip is exactly this pull request’s merge commit', async () => {
      stubOctokitReturnData('repos.compareCommitsWithBasehead', {
        data: { status: 'identical', ahead_by: 0, behind_by: 0 },
      });

      await expect(isCheckoutCurrent()).resolves.toBe(true);
      expect(context.octokit.rest.repos.compareCommitsWithBasehead).toHaveBeenCalledWith(
        expect.objectContaining({ basehead: 'merge-commit-sha...main' }),
      );
    });

    it('returns false when the base branch has advanced past the merge commit', async () => {
      stubOctokitReturnData('repos.compareCommitsWithBasehead', {
        data: { status: 'ahead', ahead_by: 12, behind_by: 0 },
      });

      await expect(isCheckoutCurrent()).resolves.toBe(false);
      expect(info).toHaveBeenCalledWith(expect.stringContaining('has advanced 12 commit(s)'));
    });

    it.each(['behind', 'diverged'] as const)('returns false for a %s comparison', async (status) => {
      stubOctokitReturnData('repos.compareCommitsWithBasehead', { data: { status, ahead_by: 1, behind_by: 1 } });

      await expect(isCheckoutCurrent()).resolves.toBe(false);
    });

    it('fails open (true) and warns when the pull request has no merge commit', async () => {
      context.set({ mergeCommitSha: null });

      await expect(isCheckoutCurrent()).resolves.toBe(true);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('Unable to determine'));
      expect(context.octokit.rest.repos.compareCommitsWithBasehead).not.toHaveBeenCalled();
    });

    it('fails open (true) and warns when the comparison API errors', async () => {
      vi.mocked(context.octokit.rest.repos.compareCommitsWithBasehead).mockRejectedValueOnce(
        new RequestError('boom', 500, {
          request: { method: 'GET', url: '', headers: {} },
          response: { status: 500, url: '', headers: {}, data: {} },
        }),
      );

      await expect(isCheckoutCurrent()).resolves.toBe(true);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });

    it('fails open (true) on a non-Error rejection', async () => {
      vi.mocked(context.octokit.rest.repos.compareCommitsWithBasehead).mockRejectedValueOnce('compare boom');

      await expect(isCheckoutCurrent()).resolves.toBe(true);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('compare boom'));
    });
  });

  describe('pathExistsOnBaseRef()', () => {
    it('returns true when the path resolves on the base ref', async () => {
      await expect(pathExistsOnBaseRef('modules/vpc')).resolves.toBe(true);
      expect(context.octokit.rest.repos.getContent).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'modules/vpc', ref: 'main' }),
      );
    });

    it('returns false on a definitive 404', async () => {
      vi.mocked(context.octokit.rest.repos.getContent).mockRejectedValueOnce(
        new RequestError('Not Found', 404, {
          request: { method: 'GET', url: '', headers: {} },
          response: { status: 404, url: '', headers: {}, data: {} },
        }),
      );

      await expect(pathExistsOnBaseRef('modules/gone')).resolves.toBe(false);
      expect(warning).not.toHaveBeenCalled();
    });

    it('fails open (true) and warns on a non-404 error', async () => {
      vi.mocked(context.octokit.rest.repos.getContent).mockRejectedValueOnce(
        new RequestError('rate limited', 403, {
          request: { method: 'GET', url: '', headers: {} },
          response: { status: 403, url: '', headers: {}, data: {} },
        }),
      );

      await expect(pathExistsOnBaseRef('modules/vpc')).resolves.toBe(true);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('rate limited'));
    });

    it('fails open (true) on a non-Error rejection', async () => {
      vi.mocked(context.octokit.rest.repos.getContent).mockRejectedValueOnce('content boom');

      await expect(pathExistsOnBaseRef('modules/vpc')).resolves.toBe(true);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('content boom'));
    });
  });
});
