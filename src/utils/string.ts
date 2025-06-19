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
