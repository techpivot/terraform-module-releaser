import { context } from '@/context';
import { GITHUB_ACTIONS_BOT_USERNAME } from '@/utils/constants';

/**
 * Retrieves the GitHub Actions bot email address dynamically by querying the GitHub API.
 * This function handles both GitHub.com and GitHub Enterprise Server environments.
 * 
 * The email format follows GitHub's standard: {user_id}+{username}@users.noreply.github.com
 * 
 * @returns {Promise<string>} The GitHub Actions bot email address
 * @throws {Error} If the API request fails or the user information cannot be retrieved
 */
export async function getGitHubActionsBotEmail(): Promise<string> {
    const response = await context.octokit.rest.users.getByUsername({
      username: GITHUB_ACTIONS_BOT_USERNAME,
    });
    
    return `${response.data.id}+${GITHUB_ACTIONS_BOT_USERNAME}@users.noreply.github.com`;
}
