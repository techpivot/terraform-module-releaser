/**
 * GitHub Username Resolution and Release Notes Generator
 *
 * This module resolves GitHub usernames from commit email addresses and generates
 * release notes using OpenAI's AI service.
 *
 * Required Environment Variables:
 * -----------------------------
 * GITHUB_TOKEN: Personal Access Token (PAT) for GitHub API
 *   - Required for higher rate limits and access to private data
 *   - Generate at: https://github.com/settings/tokens
 *   - Minimum required scopes:
 *     * `read:user` - For user email lookup
 *     * `repo` - For accessing repository commits
 *
 * OPENAI_API_KEY: OpenAI API Key
 *   - Found in your OpenAI dashboard or account settings
 */
import { execFileSync } from "node:child_process";
import https from "node:https";

const OPENAI_MODEL = "gpt-4-turbo-2024-04-09";
const PROMPT = `
You're the head of developer relations at a SaaS. Write a concise, professional, and fun changelog, prioritizing important changes.

Header is provided externally. Focus on grouping commits logically under these sections with H3 level headers: "New Features ✨", "Bug Fixes 🐛", "Improvements 🛠", and "Breaking Changes 🚨".

Ignore merge commits and minor changes. For each commit, use only the first line before any dash (\`-\`) or line break.

Translate Conventional Commit messages into professional, human-readable language, avoiding technical jargon.

For each commit, use this format:
- **Bold 3-5 word Summary** (with related GitHub emoji): Continuation with 1-3 sentence description. [Include (#XX) only if a PR/issue number matching #\\d+ is found in the commit message] @author
  - Sub-bullets for key details (include only if necessary)

Important formatting rules:
- Only include PR/issue numbers that match the exact pattern #\\d+ (e.g., #123)
- Do not use commit hashes as PR numbers
- If no PR/issue number is found matching #\\d+, omit the parenthetical reference entirely

Avoid level 4 headings. Use level 3 (###) for sections. Omit sections with no content.
`;

// In-memory cache for username lookups
const usernameCache = new Map();

/**
 * Validates required environment variables
 */
function validateEnvironment() {
  const requiredEnvVars = ["GITHUB_TOKEN", "OPENAI_API_KEY"];

  const missing = requiredEnvVars
    .filter((envVar) => !process.env[envVar])
    .map((envVar) => `${envVar} environment variable is not set`);

  if (missing.length > 0) {
    throw new Error(
      "Environment prerequisites not met:\n" + missing.join("\n")
    );
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
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are zero-based
  const day = String(date.getDate()).padStart(2, "0");

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
      hostname: "api.github.com",
      path,
      headers: {
        "User-Agent": "GitHub-Username-Lookup",
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
      },
    };

    https
      .get(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else if (res.statusCode === 404) {
            resolve(null);
          } else {
            reject(new Error(`GitHub API returned status ${res.statusCode}`));
          }
        });
      })
      .on("error", reject);
  });
}

/**
 * Attempts to resolve a GitHub username from a commit email address
 * using multiple GitHub API endpoints.
 *
 * @param {string} commitEmail - The email address from the git commit
 * @returns {Promise<string|null>} - GitHub username if found, null otherwise
 */
async function resolveGitHubUsername(commitEmail) {
  try {
    // First attempt: Direct API search for user by email
    const searchResponse = await githubApiRequest(
      `https://api.github.com/search/users?q=${encodeURIComponent(
        commitEmail
      )}+in:email`
    );
    if (
      searchResponse &&
      searchResponse.items &&
      searchResponse.items.length > 0
    ) {
      // Get the first matching user
      return searchResponse.items[0].login;
    }

    // Second attempt: Check commit API for associated username
    const commitSearchResponse = await githubApiRequest(
      `https://api.github.com/search/commits?q=author-email:${encodeURIComponent(
        commitEmail
      )}&per_page=20`
    );
    if (
      commitSearchResponse &&
      commitSearchResponse.items &&
      commitSearchResponse.items.length > 0
    ) {
      const commit = commitSearchResponse.items[0];
      if (commit.author) {
        return commit.author.login;
      }
    }

    // If all attempts fail, return null or the email
    return null;
  } catch (error) {
    console.error("Error resolving GitHub username:", error);
    return null;
  }
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
 * Gets all commits between HEAD and origin/main, including commit hash,
 * author email, GitHub username (if found), and commit message.
 *
 * @returns {Promise<Array>} Array of processed commit objects with hash, username, and message
 * @throws {Error} If git command execution fails
 */
async function getCommitsBetweenHeadAndMain() {
  try {
    const baseBranch = process.env.GITHUB_BASE_REF || "main";
    const args = [
      "log",
      `origin/${baseBranch}..HEAD`,
      "--pretty=format:%H|%aE|%B\x1E",
    ];

    console.log(`>> running:  "git ${args.join(" ")}`);
    const stdout = execFileSync("/usr/bin/git", args, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // Increase buffer to 10MB
    });

    // Split by the special character first
    const commitEntries = stdout
      .split("\x1E")
      .map((str) => str.trim()) // Immediately trim after split to handle newlines
      .filter(Boolean) // Remove empty entries
      .filter((entry) => {
        // Filter out merge commits that match the specific pattern
        const message = entry.split("|")[2] || "";
        return !message.match(/^Merge [a-f0-9]+ into [a-f0-9]+/);
      });

    console.log("Filtered commits:");
    console.log(commitEntries);

    // Process the filtered commits
    const commits = commitEntries.map(async (entry) => {
      const [commitHash, commitEmail, commitMessage] = entry.split("|");

      const username = await getGitHubUsername(commitEmail);

      return {
        hash: commitHash,
        author: username,
        message: commitMessage.trim(),
      };
    });

    return await Promise.all(commits);
  } catch (error) {
    throw new Error(`Failed to get commits: ${error.message}`);
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
  try {
    const response = await fetch(
      "https://api.github.com/repos/techpivot/terraform-module-releaser/releases/latest"
    );

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
 * Main function to generate changelog from commits using GitHub and OpenAI APIs.
 *
 * This function:
 * - Validates environment variables
 * - Retrieves commits between HEAD and origin/main
 * - Resolves GitHub usernames for commit authors
 * - Sends commit data to OpenAI to generate a formatted changelog
 *
 * @returns {Promise<string>} - Generated changelog content
 * @throws {Error} - If environment variables are missing or API requests fail
 */
async function generateChangelog(version) {
  // Strip the leading "v" if it's a prefix
  const versionNumber = version.startsWith("v") ? version.slice(1) : version;
  const latestVersionTag = await getLatestReleaseTag();

  validateEnvironment();

  const commits = await getCommitsBetweenHeadAndMain();
  console.log("Commits:");
  console.debug(commits);

  try {
    /*
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content: PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify(commits),
          },
        ],
      }),
    });

    const data = await response.json();

    console.log("Changelog");
    console.dir(data);*/

    const content = `### Improvements 🛠
- **Automated Release Workflow** 🤖: Streamlined the release process through the implementation of a new GitHub Actions workflow. @virgofx
  - Automates version bumps and handles the entire release cycle efficiently.
  - Ensures adherence to semantic versioning and conventional commit formats.`;

    return [
      `# Release Notes v${versionNumber} Preview`,
      `\n**Important:** Upon merging this pull request, the following release notes will be automatically created for version v${versionNumber}.`,
      `\n## ${versionNumber} (${getDateString()})\n`,
      `<!-- RELEASE-NOTES-VERSION: ${versionNumber} -->`,
      "<!-- RELEASE-NOTES-MARKER-START -->",
      content,
      //data.choices[0].message.content,
      `\n###### Full Changelog: https://github.com/techpivot/terraform-module-releaser/compare/${latestVersionTag}...v${versionNumber}`,
    ].join("\n");
  } catch (error) {
    console.error("Error querying OpenAI:", error);
  }
}

// Export the main function for external usage
export { generateChangelog };
