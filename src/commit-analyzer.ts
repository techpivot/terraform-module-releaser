import { CommitParser } from 'conventional-commits-parser';
import { config } from '@/config';
import type { ConventionalCommitResult, ReleaseType } from '@/types';
import { RELEASE_TYPE, SEMVER_MODE } from '@/utils/constants';

/**
 * Matches GitHub-style revert commits (`Revert "<header>"` … `This reverts commit <hash>.`),
 * capturing the original header and commit hash.
 *
 * This is the one parser option deliberately not taken verbatim from the
 * `conventional-changelog-conventionalcommits` preset. The preset's pattern
 * (`/^(?:Revert|revert:)\s"?([\s\S]+?)"?\s*This reverts commit (\w*)\./i`) backtracks
 * super-linearly: the lazy `[\s\S]+?`, the optional `"?`, and the `\s*` all match the same
 * characters, so a crafted message with a long whitespace run costs O(n²) — roughly 14 seconds
 * at 100k characters. Requiring the captured header to end on a non-quote, non-whitespace
 * character (`[\s\S]*?[^"\s]`) removes the ambiguity and keeps matching linear (<1ms at 100k)
 * while accepting the same real-world revert messages. Only degenerate headers diverge: an
 * empty quoted header (`Revert ""`) no longer matches, where the preset pattern captured a
 * stray quote character as the header.
 *
 * Exported for the linear-time regression test; not part of the public API.
 */
export const REVERT_PATTERN = /^(?:Revert|revert:)\s"?([\s\S]*?[^"\s])"?\s*This reverts commit (\w*)\./i;

/**
 * Pre-configured conventional commit parser using options taken from the
 * `conventional-changelog-conventionalcommits` preset's `createParserOpts()`
 * (verbatim except `revertPattern` — see {@link REVERT_PATTERN}):
 *
 * @see https://github.com/conventional-changelog/conventional-changelog/blob/master/packages/conventional-changelog-conventionalcommits/src/parser.js
 *
 * We inline these options rather than depending on the preset package because
 * that package pulls in changelog writer, whatBump, and other utilities we don't
 * need. The patterns themselves are stable — they encode the Conventional Commits
 * v1.0.0 header grammar and are unlikely to change.
 *
 * Key options and why they matter:
 *
 * - `headerPattern` — Matches `<type>[(<scope>)][!]: <description>`. The `!?`
 *   makes the breaking-change indicator optional so both `feat: x` and `feat!: x`
 *   parse correctly. The library's default pattern omits `!?`, causing commits
 *   like `feat!: drop old API` to fail matching entirely.
 *
 * - `breakingHeaderPattern` — Same as above but with `!` required. When this
 *   pattern matches, the library's `parseBreakingHeader()` method automatically
 *   pushes a BREAKING CHANGE entry into the `notes` array, letting us detect
 *   `!`-style breaking changes via `notes.length > 0`.
 *
 * - `headerCorrespondence` — Maps the three capture groups in `headerPattern`
 *   to `type`, `scope`, and `subject` on the parsed result object.
 *
 * - `noteKeywords` — Tokens scanned in the commit body/footer to detect
 *   breaking changes: `BREAKING CHANGE` and `BREAKING-CHANGE` per the spec.
 *
 * - `revertPattern` / `revertCorrespondence` — Matches GitHub-style revert
 *   commits (`Revert "<header>" / This reverts commit <hash>.`), extracting the
 *   original header and commit hash. The parsed revert fields are currently
 *   unused by this action; the option is kept for preset fidelity.
 *
 * - `issuePrefixes` — Deliberately overridden to `undefined` (the second divergence
 *   from the preset, which uses `['#']` — also the library default). The references
 *   output it feeds is unused by this action, and the regex the library builds from
 *   it (`(?:.*?)??\s*([\w-.\/]*?)??(#)…`) is catastrophically super-linear: measured
 *   at 10 seconds on a single 2,000-character line without a `#`. Since commit
 *   messages come from pull requests, that is an attacker-triggerable CI stall.
 *   The explicit `undefined` overrides the library default via the constructor's
 *   `{ ...defaultOptions, ...options }` spread; if a future library version changes
 *   that merge style the default would silently return, which the pathological-input
 *   regression tests would catch as a test timeout.
 */
const commitParser = new CommitParser({
  headerPattern: /^(\w*)(?:\((.*)\))?!?: (.*)$/,
  breakingHeaderPattern: /^(\w*)(?:\((.*)\))?!: (.*)$/,
  headerCorrespondence: ['type', 'scope', 'subject'],
  noteKeywords: ['BREAKING CHANGE', 'BREAKING-CHANGE'],
  revertPattern: REVERT_PATTERN,
  revertCorrespondence: ['header', 'hash'],
  issuePrefixes: undefined,
});

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Single-message detection
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Messages longer than this are reduced to a parse-safe digest before being handed to the parser.
 *
 * Even with `issuePrefixes` disabled, `conventional-commits-parser` substitutes the never-matching
 * stub `/(?!.*)/` for the disabled regex — and that stub is itself quadratic, because the `.*`
 * inside the lookahead walks to the end of the line at every scan position (measured: ~2.3s on a
 * 100k-character line, growing quadratically). Bounding what reaches the parser caps that cost at
 * ~60ms per message while `toParseSafeMessage()` preserves every output this module consumes.
 * Real conventional commit messages — including large squash-merge bodies — sit far below this cap
 * and always take the unmodified fast path.
 *
 * Exported for the oversized-message tests; not part of the public API.
 */
export const MAX_COMMIT_MESSAGE_PARSE_LENGTH = 16_384;

/** Cap applied to the individual lines kept by `toParseSafeMessage()`. */
const MAX_DIGEST_LINE_LENGTH = 1_024;

/**
 * Matches any line the parser's notes regex (`/^(?:\*\s+)?(BREAKING CHANGE|BREAKING-CHANGE):\s*(.*)/i`)
 * would record as a breaking-change note. Kept in sync with that shape so the digest never drops a
 * line the full parse would have counted.
 */
const BREAKING_NOTE_LINE = /^(?:\*\s+)?BREAKING[ -]CHANGE:/i;

/**
 * Reduces an oversized commit message to the lines that can influence this module's outputs.
 *
 * Everything `parseConventionalCommit()` returns derives from exactly two things: the header (first
 * line → type, scope, subject, `!` indicator) and whether any breaking-change note exists (`!` or a
 * `BREAKING CHANGE:` footer line). So for messages over `MAX_COMMIT_MESSAGE_PARSE_LENGTH`, parsing
 * the header plus the first breaking-change footer line yields identical results to parsing the
 * whole message — at bounded cost. The only lossy cases are absurd ones: a single header line over
 * `MAX_DIGEST_LINE_LENGTH` characters gets its subject truncated, and note *text* (which this
 * module never reads) is truncated.
 *
 * @param message - The trimmed commit message
 * @returns The message itself when within the cap, otherwise the reduced digest
 */
function toParseSafeMessage(message: string): string {
  if (message.length <= MAX_COMMIT_MESSAGE_PARSE_LENGTH) {
    return message;
  }

  const lines = message.split(/\r?\n/);
  const header = lines[0].slice(0, MAX_DIGEST_LINE_LENGTH);
  const breakingLine = lines.slice(1).find((line) => BREAKING_NOTE_LINE.test(line));

  return breakingLine === undefined ? header : `${header}\n\n${breakingLine.slice(0, MAX_DIGEST_LINE_LENGTH)}`;
}

/**
 * Parses a commit message according to the Conventional Commits specification
 * using the `conventional-commits-parser` library.
 *
 * The expected format is: `<type>[(scope)][!]: <description>`
 *
 * The parser handles multi-line messages, extracting the header (first line) and
 * scanning the full message body for `BREAKING CHANGE:` or `BREAKING-CHANGE:`
 * footer tokens per the spec. The `!` breaking indicator in the header is detected
 * by the library's `breakingHeaderPattern` option, which adds a `BREAKING CHANGE`
 * entry to the `notes` array when the `!` is present.
 *
 * @param message - The full commit message string
 * @returns The parsed result, or `null` if the message doesn't match the conventional format
 *
 * @example
 * ```typescript
 * parseConventionalCommit('feat(api): add user endpoint')
 * // → { type: 'feat', scope: 'api', breaking: false, description: 'add user endpoint' }
 *
 * parseConventionalCommit('fix!: critical security patch')
 * // → { type: 'fix', scope: null, breaking: true, description: 'critical security patch' }
 *
 * parseConventionalCommit('feat: new feature\n\nBREAKING CHANGE: old API removed')
 * // → { type: 'feat', scope: null, breaking: true, description: 'new feature' }
 * ```
 */
export function parseConventionalCommit(message: string): ConventionalCommitResult | null {
  const trimmed = message.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = commitParser.parse(toParseSafeMessage(trimmed));

  if (!parsed.type) {
    return null;
  }

  return {
    type: parsed.type.toLowerCase(),
    scope: parsed.scope ?? null,
    breaking: parsed.notes.length > 0,
    description: parsed.subject ?? '',
  };
}

/**
 * Determines the semantic version release type from a single commit message using
 * the Conventional Commits specification.
 *
 * This action applies the following commit type → release level mapping
 * (inspired by common Conventional Commits usage, but not defined by the
 * v1.0.0 spec itself):
 * - Breaking change (`!` or `BREAKING CHANGE` footer) → MAJOR
 * - `feat` → MINOR
 * - `fix` → PATCH
 * - Any other valid type (e.g. `docs`, `chore`, `refactor`, `perf`) → PATCH
 *
 * The Conventional Commits spec intentionally does not constrain the set of valid
 * types or prescribe SemVer bump rules beyond indicating breaking changes, so any
 * message matching the `<type>[(<scope>)][!]: <description>` format is considered
 * a conventional commit. Types beyond `feat` and `fix` all map to PATCH since the
 * action always performs a minimum version bump.
 *
 * Non-conventional commit messages (those that don't match the format at all) return `null`,
 * allowing the caller to fall back to `defaultSemverLevel`.
 *
 * @param message - The full commit message string
 * @returns The computed release type, or `null` if the message is not a recognized conventional commit
 *
 * @example
 * ```typescript
 * detectConventionalCommitReleaseType('feat: add login')
 * // → 'minor'
 *
 * detectConventionalCommitReleaseType('fix!: security patch')
 * // → 'major'
 *
 * detectConventionalCommitReleaseType('update readme')
 * // → null (not a conventional commit)
 * ```
 */
export function detectConventionalCommitReleaseType(message: string): ReleaseType | null {
  const parsed = parseConventionalCommit(message);

  if (!parsed) {
    // Not a conventional commit — let caller decide the fallback
    return null;
  }

  // Breaking changes always produce a MAJOR release, regardless of type
  if (parsed.breaking) {
    return RELEASE_TYPE.MAJOR;
  }

  // Type-specific mappings
  if (parsed.type === 'feat') {
    return RELEASE_TYPE.MINOR;
  }

  if (parsed.type === 'fix') {
    return RELEASE_TYPE.PATCH;
  }

  // Any other valid conventional commit type (docs, chore, refactor, perf, ci, etc.) → PATCH
  return RELEASE_TYPE.PATCH;
}

/**
 * Detects the release type from a single commit message based on keyword matching.
 *
 * Checks the message against major, minor, and patch keyword lists in priority order.
 * Keyword matching is case-insensitive. Returns the first matching level, or `null`
 * if no keywords match, allowing the caller to fall back to `defaultSemverLevel`.
 *
 * @param message - The commit message to analyze
 * @param majorKeywords - Keywords that indicate a major release
 * @param minorKeywords - Keywords that indicate a minor release
 * @param patchKeywords - Keywords that indicate a patch release
 * @returns The detected release type, or `null` if no keywords match
 *
 * @example
 * ```typescript
 * detectKeywordReleaseType('BREAKING CHANGE: remove API', ['breaking change'], ['feat'], ['fix'])
 * // → 'major'
 *
 * detectKeywordReleaseType('feat: add login', ['breaking change'], ['feat'], ['fix'])
 * // → 'minor'
 *
 * detectKeywordReleaseType('update readme', ['breaking change'], ['feat'], ['fix'])
 * // → null
 * ```
 */
export function detectKeywordReleaseType(
  message: string,
  majorKeywords: string[],
  minorKeywords: string[],
  patchKeywords: string[],
): ReleaseType | null {
  const messageCleaned = message.toLowerCase().trim();

  if (majorKeywords.some((keyword) => messageCleaned.includes(keyword.toLowerCase()))) {
    return RELEASE_TYPE.MAJOR;
  }
  if (minorKeywords.some((keyword) => messageCleaned.includes(keyword.toLowerCase()))) {
    return RELEASE_TYPE.MINOR;
  }
  if (patchKeywords.some((keyword) => messageCleaned.includes(keyword.toLowerCase()))) {
    return RELEASE_TYPE.PATCH;
  }
  return null;
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Multi-message orchestration
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Returns the higher-priority release type between two values (MAJOR > MINOR > PATCH).
 *
 * Used internally and externally to accumulate the highest-priority bump across
 * multiple commits.
 *
 * @param current - The current accumulated release type (may be null on first iteration)
 * @param candidate - The release type from the current commit
 * @returns The higher-priority of the two release types
 *
 * @example
 * ```typescript
 * higherPriorityReleaseType(null, 'patch')    // → 'patch'
 * higherPriorityReleaseType('patch', 'minor') // → 'minor'
 * higherPriorityReleaseType('minor', 'major') // → 'major'
 * higherPriorityReleaseType('major', 'patch') // → 'major'
 * ```
 */
export function higherPriorityReleaseType(current: ReleaseType | null, candidate: ReleaseType): ReleaseType {
  if (candidate === RELEASE_TYPE.MAJOR || current === RELEASE_TYPE.MAJOR) {
    return RELEASE_TYPE.MAJOR;
  }
  if (candidate === RELEASE_TYPE.MINOR || current === RELEASE_TYPE.MINOR) {
    return RELEASE_TYPE.MINOR;
  }
  return RELEASE_TYPE.PATCH;
}

/**
 * Computes the highest-priority semantic version release type across an array of commit
 * messages, using the strategy determined by the global `config` singleton.
 *
 * When `config.semverMode` is `'keywords'`, each message is scanned for configured keyword lists.
 * When `config.semverMode` is `'conventional-commits'`, each message is parsed per the Conventional
 * Commits specification and the bump is derived from the commit type and breaking-change
 * indicators.
 *
 * In both modes, the highest-priority release type wins (MAJOR > MINOR > PATCH).
 * Returns `null` if no commit matched any detection rule, allowing the caller to
 * apply a default fallback such as `config.defaultSemverLevel`.
 *
 * @param messages - The array of commit messages to analyze
 * @returns The highest-priority release type found, or `null` if no rules matched
 *
 * @example
 * ```typescript
 * // With config.semverMode = 'keywords'
 * computeReleaseType(['feat: add feature', 'fix: bug'])
 * // → 'minor'
 *
 * // With config.semverMode = 'conventional-commits'
 * computeReleaseType(['feat: add login', 'fix!: security patch'])
 * // → 'major'
 * ```
 */
export function computeReleaseType(messages: ReadonlyArray<string>): ReleaseType | null {
  const detectFn =
    config.semverMode === SEMVER_MODE.CONVENTIONAL_COMMITS
      ? (message: string) => detectConventionalCommitReleaseType(message)
      : (message: string) =>
          detectKeywordReleaseType(message, config.majorKeywords, config.minorKeywords, config.patchKeywords);

  let result: ReleaseType | null = null;

  for (const message of messages) {
    const releaseType = detectFn(message);
    if (releaseType !== null) {
      result = higherPriorityReleaseType(result, releaseType);
    }
  }

  return result;
}
