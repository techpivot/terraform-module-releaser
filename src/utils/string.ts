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
