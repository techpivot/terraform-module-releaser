import { CommitParser } from 'conventional-commits-parser';
import { config } from '@/config';
import type { ConventionalCommitResult, ConventionalCommitsPreset, ReleaseType } from '@/types';
import { RELEASE_TYPE, SEMVER_MODE } from '@/utils/constants';

/**
 * Pre-configured conventional commit parser instance.
 *
 * Uses a custom `headerPattern` that mirrors the Conventional Commits v1.0.0 spec
 * (`<type>[(<scope>)][!]: <description>`) but intentionally omits the `!` breaking
 * indicator from the capture groups. The library's `headerCorrespondence` mapping
 * does not handle optional capture groups correctly, so the `!` is detected
 * separately via {@link BREAKING_BANG_REGEX}.
 *
 * `noteKeywords` enables detection of `BREAKING CHANGE:` and `BREAKING-CHANGE:`
 * footer tokens in the commit body per the spec.
 */
const commitParser = new CommitParser({
  headerPattern: /^(\w+)(?:\(([^)]*)\))?!? *: *(.+)$/,
  headerCorrespondence: ['type', 'scope', 'subject'],
  noteKeywords: ['BREAKING CHANGE', 'BREAKING-CHANGE'],
});

/**
 * Detects the `!` breaking change indicator in the commit header.
 * Matches `type[scope]!:` — the `!` must immediately precede the colon.
 */
const BREAKING_BANG_REGEX = /^\w+(?:\([^)]*\))?!:/;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Single-message detection
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Parses a commit message according to the Conventional Commits specification
 * using the `conventional-commits-parser` library.
 *
 * The expected format is: `<type>[(scope)][!]: <description>`
 *
 * The parser handles multi-line messages, extracting the header (first line) and
 * scanning the full message body for `BREAKING CHANGE:` or `BREAKING-CHANGE:`
 * footer tokens per the spec. The `!` breaking indicator in the header is detected
 * separately since the library does not natively support it.
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

  const parsed = commitParser.parse(trimmed);

  if (!parsed.type) {
    return null;
  }

  const firstLine = trimmed.split('\n')[0].trim();
  const hasBreakingBang = BREAKING_BANG_REGEX.test(firstLine);
  const hasBreakingNote = parsed.notes.length > 0;
  const description = firstLine.replace(/^\w+(?:\([^)]*\))?!? *: */, '').trim();

  return {
    type: parsed.type.toLowerCase(),
    scope: parsed.scope ?? null,
    breaking: hasBreakingBang || hasBreakingNote,
    description,
  };
}

/**
 * Determines the semantic version release type from a single commit message using
 * the Conventional Commits specification.
 *
 * The mapping from commit type to release level depends on the chosen preset:
 *
 * **`conventionalcommits`** preset (Conventional Commits v1.0.0 spec):
 * - Breaking change (`!` or `BREAKING CHANGE` footer) → MAJOR
 * - `feat` → MINOR
 * - `fix` → PATCH
 * - Any other valid type (e.g. `docs`, `chore`, `refactor`) → PATCH
 *
 * **`angular`** preset (Angular commit convention):
 * - Breaking change (`!` or `BREAKING CHANGE` footer) → MAJOR
 * - `feat` → MINOR
 * - `fix` or `perf` → PATCH
 * - Any other valid type (e.g. `docs`, `chore`, `refactor`) → PATCH
 *
 * The Conventional Commits spec intentionally does not constrain the set of valid
 * types, so any message matching the `<type>[(<scope>)][!]: <description>` format
 * is considered a conventional commit. Types beyond `feat` and `fix` (or `perf` in
 * Angular) all map to PATCH since the action always performs a minimum version bump.
 *
 * Non-conventional commit messages (those that don't match the format at all) return `null`,
 * allowing the caller to fall back to `defaultSemverLevel`.
 *
 * @param message - The full commit message string
 * @param preset - The conventional commits preset to use for type-to-level mapping
 * @returns The computed release type, or `null` if the message is not a recognized conventional commit
 *
 * @example
 * ```typescript
 * detectConventionalCommitReleaseType('feat: add login', 'conventionalcommits')
 * // → 'minor'
 *
 * detectConventionalCommitReleaseType('fix!: security patch', 'angular')
 * // → 'major'
 *
 * detectConventionalCommitReleaseType('update readme', 'conventionalcommits')
 * // → null (not a conventional commit)
 * ```
 */
export function detectConventionalCommitReleaseType(
  message: string,
  preset: ConventionalCommitsPreset,
): ReleaseType | null {
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

  // Angular preset: `perf` maps to PATCH
  if (preset === 'angular' && parsed.type === 'perf') {
    return RELEASE_TYPE.PATCH;
  }

  // Any other valid conventional commit type (docs, chore, refactor, ci, etc.) → PATCH
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
      ? (message: string) => detectConventionalCommitReleaseType(message, config.conventionalCommitsPreset)
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
