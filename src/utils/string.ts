/**
 * Removes trailing characters from a string without using regex.
 *
 * This function iteratively checks each character from the end of the string
 * and removes any consecutive characters that match the specified characters to remove.
 * It uses a direct character-by-character approach instead of regex to avoid potential
 * backtracking issues and ensure consistent O(n) performance.
 *
 * @param {string} input - The string to process
 * @param {string[]} charactersToRemove - Array of characters to remove from the end
 * @returns {string} The input string with all trailing specified characters removed
 *
 * @example
 * // Returns "example"
 * removeTrailingCharacters("example...", ["."])
 *
 * @example
 * // Returns "module-name"
 * removeTrailingCharacters("module-name-_.", [".", "-", "_"])
 */
export function removeTrailingCharacters(input: string, charactersToRemove: string[]): string {
  let endIndex = input.length;
  while (endIndex > 0 && charactersToRemove.includes(input[endIndex - 1])) {
    endIndex--;
  }

  return input.slice(0, endIndex);
}

/**
 * Removes leading characters from a string without using regex.
 *
 * This function iteratively checks each character from the beginning of the string
 * and removes any consecutive characters that match the specified characters to remove.
 * It uses a direct character-by-character approach instead of regex to avoid potential
 * backtracking issues and ensure consistent O(n) performance.
 *
 * @param {string} input - The string to process
 * @param {string[]} charactersToRemove - Array of characters to remove from the beginning
 * @returns {string} The input string with all leading specified characters removed
 *
 * @example
 * // Returns "example"
 * removeLeadingCharacters("...example", ["."])
 *
 * @example
 * // Returns "module-name"
 * removeLeadingCharacters("._-module-name", [".", "-", "_"])
 */
export function removeLeadingCharacters(input: string, charactersToRemove: string[]): string {
  let startIndex = 0;
  while (startIndex < input.length && charactersToRemove.includes(input[startIndex])) {
    startIndex++;
  }

  return input.slice(startIndex);
}

/**
 * Renders a template string by replacing placeholders with provided values.
 *
 * @param template The template string containing placeholders in the format `{{key}}`.
 * @param variables An object where keys correspond to placeholder names and values are their replacements.
 *                   If a value is undefined or null, the placeholder will be left unchanged.
 * @returns The rendered string with placeholders replaced.
 *
 * @example
 * // Returns "Hello, World!"
 * renderTemplate("Hello, {{name}}!", { name: "World" })
 *
 * @example
 * // Returns "Hi, There!"
 * renderTemplate("{{greeting}}, {{name}}!", { greeting: "Hi", name: "There" })
 *
 * @example
 * // Returns "Hello, {{name}}!" (undefined value leaves placeholder unchanged)
 * renderTemplate("Hello, {{name}}!", { name: undefined })
 *
 * @example
 * // Returns "Hello, {{name}}!" (null value leaves placeholder unchanged)
 * renderTemplate("Hello, {{name}}!", { name: null })
 */
export function renderTemplate(template: string, variables: Record<string, string | undefined | null>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, key) => {
    const value = variables[key];
    return value !== undefined && value !== null ? value : placeholder;
  });
}

/**
 * Formats a repository URL as a Terraform module source URL.
 *
 * Converts repository URLs to the appropriate format for Terraform module sourcing:
 * - SSH format: git::ssh://git@hostname/path.git
 * - HTTPS format: git::https://hostname/path.git
 *
 * @param repoUrl - The repository URL (must be a valid HTTPS URL)
 * @param useSSH - Whether to use SSH format instead of HTTPS
 * @returns The formatted source URL for the module with git:: prefix
 * @throws {TypeError} When repoUrl is not a valid URL that can be parsed
 *
 * @example
 * ```typescript
 * getModuleSource('https://github.com/owner/repo', false)
 * // Returns: 'git::https://github.com/owner/repo.git'
 *
 * getModuleSource('https://github.techpivot.com/owner/repo', true)
 * // Returns: 'git::ssh://git@github.techpivot.com/owner/repo.git'
 * ```
 */
export function getModuleSource(repoUrl: string, useSSH: boolean): string {
  if (useSSH) {
    const url = new URL(repoUrl);
    return `git::ssh://git@${url.hostname}${url.pathname}.git`;
  }

  return `git::${repoUrl}.git`;
}
