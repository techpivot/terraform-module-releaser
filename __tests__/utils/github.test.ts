import { context } from '@/mocks/context';
import { getGitHubActionsBotEmail } from '@/utils/github';
import { beforeAll, describe, expect, it } from 'vitest';

describe('utils/github', () => {
  describe('getGitHubActionsBotEmail - real API queries', () => {
    beforeAll(async () => {
      if (!process.env.GITHUB_TOKEN) {
        throw new Error('GITHUB_TOKEN environment variable must be set for these tests');
      }
      await context.useRealOctokit();
    });

    it('should return the correct email format for GitHub.com public API', async () => {
      // This test uses the real GitHub API and expects the standard GitHub.com user ID
      // for the github-actions[bot] user, which is 41898282

      const result = await getGitHubActionsBotEmail();

      // Assert
      expect(result).toBe('41898282+github-actions[bot]@users.noreply.github.com');
    });
  });
});
