/**
 * GitHub Username Resolution and Release Notes Generator
 *
 * This module generates release notes by first fetching commits locally using git,
 * then enriching them with GitHub usernames and pull request information via the
 * GitHub API, and finally generating human-readable changelogs using GitHub Models API.
 *
 * USAGE:
 * ------
 * 1. Set up environment variables (see below)
 * 2. Run via npm script: `npm run changelog:test -- "1.2.3"`
 * 3. Or import and use: `import { generateChangelog } from './.github/scripts/changelog.js'`
 *
 * TESTING LOCALLY:
 * ----------------
 * Create a GitHub personal access token. The token needs to have models:read permissions.
 * See Managing your personal access tokens: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
 * Save your token as an environment variable:
 *
 * # Set environment variables
 * export GITHUB_TOKEN="your_github_token_here"
 *
 * # Run the test script
 * npm run changelog:test -- "1.2.3"
 *
 * # Or test with different versions
 * npm run changelog:test -- "2.0.0"
 *
 * Required Environment Variables:
 * ------------------------------
 * GITHUB_TOKEN: Personal Access Token (PAT) for GitHub API and Models
 *   - Required for username resolution, pull request lookup, and AI model access
 *   - Generate at: https://github.com/settings/tokens
 *   - Minimum required scopes:
 *     * `models:read` - For accessing GitHub Models API (AI generation)
 *     * `read:user` - For user email lookup
 *     * `repo` - For accessing repository commits and pull requests
 *   - For testing: Use a classic token with `models:read`, `repo`, and `read:user` scopes
 *
 * HOW IT WORKS:
 * -------------
 * 1. Fetches commits locally using git between the latest release tag and HEAD
 *    - This allows the script to run on any branch or pull request
 *    - No GitHub API rate limits for basic commit retrieval
 * 2. For each commit, resolves GitHub usernames from commit email addresses via GitHub API
 * 3. Looks up associated pull request information for each commit via GitHub API
 *    - Handles both merge-squash and rebase-commit scenarios
 * 4. Filters out merge commits and applies conventional commit parsing
 * 5. Sends processed commit data to GitHub Models API for human-readable changelog generation
 * 6. Returns formatted markdown changelog content
 *
 * TROUBLESHOOTING:
 * ----------------
 * - If username resolution fails: Check GITHUB_TOKEN scopes and rate limits
 * - If PR lookup fails: Ensure GITHUB_TOKEN has `repo` scope for the repository
 * - If AI generation fails: Verify GITHUB_TOKEN has `models:read` scope
 * - If no commits found: Ensure git tags exist and fetch-depth is sufficient
 * - For rate limiting: The script includes automatic retry logic with delays
 */
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import OpenAI from 'openai';

const ENDPOINT = 'https://models.github.ai/inference';
const MODEL = 'openai/gpt-4.1';
const PROMPT = `
You're the head of developer relations at a SaaS company. Write a concise, professional, and engaging changelog that prioritizes user-impacting changes and tells a story about the release.

Content Priority (High to Low):
1. User-facing features and fixes - anything that changes user experience
2. API/interface changes - breaking changes, new endpoints, deprecations  
3. Performance improvements - measurable speed/memory improvements
4. Developer experience - tooling, documentation, setup improvements
5. Internal dependencies - only include if security-related or enables new features
6. Build/CI changes - generally omit unless they affect end users

Section Structure:
Always use H3 headers (###) for the section titles below, but only include a section if it contains relevant entries. Do not render empty sections. Organize logically under these categories:
- 🚨 Breaking Changes (always first if present)
- ✨ New Features 
- 🐛 Bug Fixes
- ⚡ Performance (for performance-specific improvements)
- 🛠 Improvements (enhancements to existing features)
- 📚 Documentation (significant doc updates only)
- 🔧 Developer Experience (tooling, dev workflow improvements)

Formatting Rules:
For each entry, use this format:
- **Bold 3-5 Word Summary** {contextual emoji}: Clear description in 1-2 sentences explaining the impact/benefit. @author (#PR)
  - Sub-bullets only for complex changes requiring clarification

Content Guidelines:
- Focus on impact over implementation - explain what users can now do, not how it was built
- Use active voice - "Added dark mode" not "Dark mode was added"
- Ignore trivial changes: dependency bumps (unless security), merge commits, whitespace, minor typos
- Group related commits - combine multiple commits for the same feature
- For Conventional Commits: Transform technical prefixes into user-friendly language
  - feat: → focus on the new capability
  - fix: → describe what now works correctly  
  - perf: → quantify the improvement when possible
  - docs: → only include if significantly helpful to users

Technical Details:
- Extract first line of commit messages before any dash (-) or line break
- Include author as @username if available in the author field
- Use pullRequest.number for PR references (e.g., #123) when available
- If no pull request associated with commit, omit PR reference entirely
- Skip sections with no meaningful content
- Use contextual emojis that relate to the specific change, not just the section
- Never use H4 headings

Tone & Style:
- Professional yet approachable
- Celebrate improvements with enthusiasm
- Focus on user benefits over technical details
- Keep it scannable - users should quickly understand what changed and why they care

Omit Silently:
- Empty sections
- Dependency updates unless security-critical
- Internal refactoring that doesn't affect users
- Minor formatting/linting changes
- Routine maintenance tasks
`;

// In-memory cache for username lookups
const usernameCache = new Map();

/**
 * Pauses execution for a specified amount of time.
 *
 * @param {number} ms - The number of milliseconds to sleep.
 * @returns {Promise<void>} A promise that resolves after the specified time has passed.
 */
function sleep(ms) {
  new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validates required environment variables
 */
function validateEnvironment() {
  const requiredEnvVars = ['GITHUB_TOKEN']; // 'OPENAI_API_KEY'];

  const missing = requiredEnvVars
    .filter((envVar) => !process.env[envVar])
    .map((envVar) => `${envVar} environment variable is not set`);

  if (missing.length > 0) {
    throw new Error(`Environment prerequisites not met:\n${missing.join('\n')}`);
  }
}

/**
 * Returns the current date as a string in the format YYYY-MM-DD.
 *
 * This function creates a new Date object representing the current date and
 * formats it by extracting the year, month, and day components. It ensures that
 * the month and day are always two digits long by padding single digits with a leading zero.
 *
 * @returns {string} - The current date formatted as YYYY-MM-DD.
 */
function getDateString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-based
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Makes a request to the GitHub API.
 *
 * @param {string} path - The API endpoint path including query parameters
 * @returns {Promise<object|null>} - Parsed JSON response or null for 404s
 * @throws {Error} - If the API request fails with a non-200/404 status
 */
function githubApiRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      headers: {
        'User-Agent': 'techpivot/terraform-module-releaser GitHub-Username-Lookup',
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
    };

    https
      .get(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else if (res.statusCode === 404) {
            resolve(null);
          } else {
            reject(new Error(`GitHub API returned status ${res.statusCode}`));
          }
        });
      })
      .on('error', reject);
  });
}

/**
 * Makes a request to the GitHub API with retries
 * @param {string} path - The API endpoint path including query parameters
 * @param {number} retries - Number of retries remaining
 * @returns {Promise<object|null>} - Parsed JSON response or null for 404s
 */
async function githubApiRequestWithRetry(path, retries = 2) {
  try {
    return await githubApiRequest(path);
  } catch (error) {
    if (retries > 0 && error.message.includes('403')) {
      console.log(`Rate limited, retrying after 2 seconds... (${retries} retries left)`);
      await sleep(2000);
      return githubApiRequestWithRetry(path, retries - 1);
    }
    throw error;
  }
}

/**
 * Attempts to resolve a GitHub username from a commit email address
 * using multiple GitHub API endpoints.
 *
 * @param {string} email - The email address from the git commit
 * @returns {Promise<string|null>} - GitHub username if found, null otherwise
 */
async function resolveGitHubUsername(email) {
  console.log('Attempting to resolve username:', email);

  // Local resolution - Handle various GitHub email patterns
  const emailMatches = email.match(/^(?:(?:[^@]+)?@)?([^@]+)$/);
  if (emailMatches) {
    const [, domain] = emailMatches;

    // Handle github.com email variations
    if (domain === 'users.noreply.github.com') {
      // Extract username from 1234567+username@users.noreply.github.com
      // or username@users.noreply.github.com
      const matches = email.match(/^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/);
      if (matches) {
        console.log(`Matched to: ${matches[2]}`);
        return matches[2];
      }
      return null;
    }

    // Handle organization emails like username@organization.github.com
    if (domain.endsWith('.github.com')) {
      const matches = email.match(/^([^@]+)@[^@]+\.github\.com$/);
      if (matches) {
        console.log(`Matched to: ${matches[1]}`);
        return matches[1];
      }
      return null;
    }

    // Handle GitHub Enterprise emails
    // Pattern: username@github.{enterprise}.com
    const enterpriseMatches = email.match(/^([^@]+)@github\.[^@]+\.com$/);
    if (enterpriseMatches) {
      console.log(`Matched to: ${enterpriseMatches[1]}`);
      return enterpriseMatches[1];
    }

    // Handle GitHub staff emails
    if (email.endsWith('@github.com')) {
      const matches = email.match(/^([^@]+)@github\.com$/);
      if (matches) {
        console.log(`Matched to: ${matches[1]}`);
        return matches[1];
      }

      return null;
    }
  }

  try {
    // First attempt: Direct API search for user by email
    console.log(`[${email}] Querying user API`);
    const searchResponse = await githubApiRequestWithRetry(
      `https://api.github.com/search/users?q=${encodeURIComponent(email)}+in:email`,
    );
    if (searchResponse?.items && searchResponse.items.length > 0) {
      console.log(`[${email}] Found username`);
      // Get the first matching user
      return searchResponse.items[0].login;
    }
    console.log(`[${email}] No username found via user API`);
  } catch (error) {
    console.error(`[${email}] Error resolving GitHub username via user API:`, error);
  }

  try {
    console.log(`[${email}] Querying commit API`);
    // Second attempt: Check commit API for associated username
    const commitSearchResponse = await githubApiRequestWithRetry(
      `https://api.github.com/search/commits?q=author-email:${encodeURIComponent(email)}&per_page=25`,
    );
    if (commitSearchResponse?.items?.length > 0) {
      // Loop through all items looking for first commit with an author
      for (const commit of commitSearchResponse.items) {
        if (commit.author) {
          console.log(`[${email}] Found username from commit ${commit.sha}`);
          return commit.author.login;
        }
      }
      console.log(`[${email}] No commits with author found in ${commitSearchResponse.items.length} results`);
    }
  } catch (error) {
    console.error(`[${email}] Error resolving GitHub username via commit API:`, error);
  }

  return null;
}

/**
 * Gets a GitHub username for an email address with caching.
 *
 * @param {string} email - The email address to look up
 * @returns {Promise<string|null>} - Cached or newly resolved GitHub username
 */
async function getGitHubUsername(email) {
  // Check cache first
  if (usernameCache.has(email)) {
    return usernameCache.get(email);
  }

  const githubUsername = await resolveGitHubUsername(email);

  if (githubUsername) {
    usernameCache.set(email, githubUsername);
    return githubUsername;
  }

  // If all methods fail, cache the email as fallback
  usernameCache.set(email, null);
  return null;
}

/**
 * Retrieves all commits between the specified latest release tag and HEAD,
 * including author email, GitHub username (if found), commit message, and
 * associated pull request information. Filters out merge commits following
 * a specific pattern.
 *
 * @param {string} latestVersionTag - The latest release tag to compare against HEAD.
 * @returns {Promise<Array>} A promise that resolves to an array of processed
 * commit objects, each containing the GitHub username, message, and PR info.
 * @throws {Error} If git command execution fails.
 */
async function getCommitsBetweenLatestReleaseAndMain(latestVersionTag) {
  try {
    const args = ['log', `${latestVersionTag}..HEAD`, '--pretty=format:%H|%aE|%B\x1E'];

    console.debug('Executing git command:', 'git', args.join(' '));

    const stdout = execFileSync('/usr/bin/git', args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // Increase buffer to 10MB
    });

    // Split by the special character first
    const commitEntries = stdout
      .split('\x1E')
      .map((str) => str.trim()) // Immediately trim after split to handle newlines
      .filter(Boolean) // Remove empty entries
      .filter((entry) => {
        // Filter out merge commits that match the specific pattern
        const message = entry.split('|')[2] || '';
        return !message.match(/^Merge [a-f0-9]+ into [a-f0-9]+/);
      });

    // Extract unique email addresses from all commits
    const uniqueEmails = [...new Set(commitEntries.map((entry) => entry.split('|')[1]))];

    // Pre-populate the username cache by processing all unique emails in parallel
    console.log(`Pre-loading usernames for ${uniqueEmails.length} unique email addresses...`);
    await Promise.all(uniqueEmails.map((email) => getGitHubUsername(email)));

    // Process the filtered commits getting usernames (from cache) and PR information in parallel
    const commitPromises = commitEntries.map(async (entry) => {
      const [commitSha, commitEmail, commitMessage] = entry.split('|');

      // Username lookup will now hit the cache, PR lookup still needs API call
      const [username, pullRequest] = await Promise.all([
        getGitHubUsername(commitEmail), // This will be cached
        getPullRequestForCommit(commitSha),
      ]);

      return {
        author: username,
        message: commitMessage.trim(),
        pullRequest: pullRequest,
      };
    });

    // Wait for all commits to be processed
    const commits = await Promise.all(commitPromises);

    console.log(`${commits.length} commits:`);
    console.log(commits);

    return commits;
  } catch (error) {
    throw new Error(`Failed to get commits: ${error.message}`);
  }
}

/**
 * Gets pull request information for a commit SHA.
 * Uses the GitHub API to find pull requests associated with a specific commit.
 * Handles both merge-squash scenarios and rebase-commit scenarios.
 *
 * @param {string} commitSha - The commit SHA to look up
 * @returns {Promise<object|null>} - Pull request object with number and title, or null if not found
 */
async function getPullRequestForCommit(commitSha) {
  try {
    console.log(`[${commitSha}] Looking up pull request information`);

    // Use GitHub API to get pull requests associated with this commit
    const pullRequests = await githubApiRequestWithRetry(
      `/repos/techpivot/terraform-module-releaser/commits/${commitSha}/pulls`,
    );

    if (pullRequests && pullRequests.length > 0) {
      // Return the first (most relevant) pull request
      const pr = pullRequests[0];
      console.log(`[${commitSha}] Found PR #${pr.number}: ${pr.title}`);

      return {
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
      };
    }

    console.log(`[${commitSha}] No pull request found`);
    return null;
  } catch (error) {
    console.error(`[${commitSha}] Error looking up pull request:`, error);
    return null;
  }
}

/**
 * Fetches the latest release tag from the GitHub repository.
 *
 * @async
 * @function getLatestRelease
 * @returns {Promise<void>} Returns nothing. Logs the latest tag to the console.
 */
async function getLatestReleaseTag() {
  console.log('Fetching latest release tag from GitHub...');
  try {
    const response = await fetch('https://api.github.com/repos/techpivot/terraform-module-releaser/releases/latest');

    if (!response.ok) {
      throw new Error(`Error: ${response.status} - ${response.statusText}`);
    }

    const data = await response.json();
    const latestTag = data.tag_name;
    console.log(`The latest release tag is: ${latestTag}`);

    return latestTag;
  } catch (error) {
    console.error(`Failed to retrieve the latest release: ${error.message}`);
  }
}

/**
 * Main function to generate changelog from commits using GitHub and GitHub Models APIs.
 *
 * This function:
 * - Validates environment variables
 * - Retrieves commits between HEAD and latest release tag
 * - Resolves GitHub usernames for commit authors
 * - Sends commit data to GitHub Models API to generate a formatted changelog
 *
 * @param {string} version - The version number for the release
 * @returns {Promise<string>} - Generated changelog content
 * @throws {Error} - If environment variables are missing or API requests fail
 */
async function generateChangelog(version) {
  validateEnvironment();

  // Strip the leading "v" if it's a prefix
  const versionNumber = version.startsWith('v') ? version.slice(1) : version;
  const latestVersionTag = await getLatestReleaseTag();

  console.log(`Generating changelog for version: ${versionNumber}`);

  const commits = await getCommitsBetweenLatestReleaseAndMain(latestVersionTag);

  console.log(`Found ${commits.length} commits between ${latestVersionTag} and main`);
  console.log('Commits:', JSON.stringify(commits, null, 2));

  try {
    const client = new OpenAI({ baseURL: ENDPOINT, apiKey: process.env.GITHUB_TOKEN });
    const response = await client.chat.completions.create({
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: JSON.stringify(commits) },
      ],
      temperature: 0.3, // Low temperature for consistent, focused output (0.0-2.0, lower = more deterministic)
      top_p: 0.9, // High nucleus sampling to maintain quality while reducing randomness (0.0-1.0)
      model: MODEL,
    });

    console.log('Generated changelog content:');
    console.log(response.choices[0].message.content);

    return [
      '# ✨ Release Notes Preview',
      `\n> **Important:** Upon merging this pull request, the following release notes will be automatically created for version v${versionNumber}.`,
      '\n---\n',
      `<!-- RELEASE-NOTES-VERSION: ${versionNumber} -->`,
      '<!-- RELEASE-NOTES-MARKER-START -->',
      `## ${versionNumber} (${getDateString()})\n`,
      response.choices[0].message.content,
      `\n###### Full Changelog: https://github.com/techpivot/terraform-module-releaser/compare/${latestVersionTag}...v${versionNumber}`,
    ].join('\n');
  } catch (error) {
    console.error('Error generating changelog:', error);
    throw error;
  }
}

// Export the main function for external usage
export { generateChangelog };

/**
 * CLI interface for testing the changelog generator locally.
 *
 * Usage: node .github/scripts/changelog.js [version]
 * Example: node .github/scripts/changelog.js "1.2.3"
 */
async function main() {
  // Check if this script is being run directly (not imported)
  if (import.meta.url === `file://${process.argv[1]}`) {
    const version = process.argv[2];

    if (!version) {
      console.error('❌ Error: Version argument is required');
      console.error('Usage: node .github/scripts/changelog.js [version]');
      console.error('Example: node .github/scripts/changelog.js "1.2.3"');
      process.exit(1);
    }

    try {
      const changelog = await generateChangelog(version);

      console.log('✅ Changelog generated successfully!\n');
      console.log('📋 Generated Changelog:');
      console.log('='.repeat(80));
      console.log(changelog);
      console.log('='.repeat(80));
    } catch (error) {
      console.error('❌ Error generating changelog:', error.message);
      process.exit(1);
    }
  }
}

// Run main function if this script is executed directly
main().catch(console.error);
