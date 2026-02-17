/**
 * Types for the commit analyzer module.
 */

/**
 * Result of parsing a conventional commit message.
 */
export interface ConventionalCommitResult {
  /** The commit type (e.g., 'feat', 'fix', 'chore') */
  type: string;
  /** The optional scope (e.g., 'parser', 'api') — without parentheses */
  scope: string | null;
  /** Whether the commit indicates a breaking change via `!` suffix or `BREAKING CHANGE` footer */
  breaking: boolean;
  /** The commit description (text after the colon) */
  description: string;
}
