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
  // Remove leading slashes separately from the trailing to prevent backtracking.
  return str.replace(/^\/+/, '').replace(/\/+$/, '');
}
