/**
 * Removes any leading and trailing slashes (/) from the given string.
 *
 * @param {string} str - The input string from which to trim slashes.
 * @returns {string} - The string without leading or trailing slashes.
 *
 * @example
 * // Returns "example/path"
 * trimSlashes("/example/path/");
 *
 * @example
 * // Returns "another/example"
 * trimSlashes("///another/example///");
 */
export function trimSlashes(str: string): string {
  let start = 0;
  let end = str.length;

  // Remove leading slashes by adjusting start index
  while (start < end && str[start] === '/') {
    start++;
  }

  // Remove trailing slashes by adjusting end index
  while (end > start && str[end - 1] === '/') {
    end--;
  }

  // Return the substring without leading and trailing slashes
  return str.slice(start, end);
}

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
