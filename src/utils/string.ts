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
 * Removes trailing dots from a string without using regex.
 *
 * This function iteratively checks each character from the end of the string
 * and removes any consecutive dots at the end. It uses a direct character-by-character
 * approach instead of regex to avoid potential backtracking issues and ensure
 * consistent O(n) performance.
 *
 * @param {string} input - The string to process
 * @returns {string} The input string with all trailing dots removed
 */
export function removeTrailingDots(input: string) {
  let endIndex = input.length;
  while (endIndex > 0 && input[endIndex - 1] === '.') {
    endIndex--;
  }
  return input.slice(0, endIndex);
}
