import { context } from '@/context';
import { RELEASE_BODY_PR_MARKER_PREFIX, RELEASE_BODY_PR_MARKER_SCHEMA } from '@/utils/constants';

/**
 * Escapes a string for safe literal use inside a regular expression.
 *
 * @param {string} value - The raw string to escape.
 * @returns {string} The escaped string.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ESCAPED_MARKER_PREFIX = escapeRegExp(RELEASE_BODY_PR_MARKER_PREFIX);

/**
 * Matches every marker that occupies a whole line, capturing its `<owner>/<repo>#<prNumber>` identity.
 *
 * Anchoring to a standalone line (tolerating CRLF from the API and surrounding horizontal whitespace)
 * means a marker embedded mid-sentence inside attacker-influenced prose is never honored. Both writers
 * always emit the marker as its own trailing line.
 */
const MARKER_LINE_REGEX = new RegExp(
  `(?:^|\\r?\\n)[ \\t]*${ESCAPED_MARKER_PREFIX}\\d+:(\\S+#\\d+) -->[ \\t]*(?=\\r?\\n|$)`,
  'g',
);

/**
 * Returns the pull request identity this marker scheme uses: `<owner>/<repo>#<prNumber>`.
 *
 * The repository is part of the identity because a fork or mirror clone copies **tags but not
 * releases**. Every module's latest tag in such a clone is therefore an orphan carrying the upstream
 * marker, and fork pull request numbering restarts at 1 — so a bare number would let a fork adopt an
 * upstream tag on a number collision.
 *
 * @param {number} prNumber - The pull request number.
 * @returns {string} The scoped identity.
 */
function buildPrIdentity(prNumber: number): string {
  const {
    repo: { owner, repo },
  } = context;

  return `${owner}/${repo}#${prNumber}`;
}

/**
 * Collects the distinct pull request identities carried by standalone marker lines in the given text.
 *
 * @param {string} text - The release body or commit message to scan.
 * @returns {Set<string>} The distinct identities found.
 */
function collectMarkerIdentities(text: string): Set<string> {
  const identities = new Set<string>();
  for (const match of text.matchAll(MARKER_LINE_REGEX)) {
    identities.add(match[1]);
  }

  return identities;
}

/**
 * Builds the hidden, schema-versioned marker that ties a release — and the release commit its tag
 * points at — to the pull request that produced it. The marker is an HTML comment so it never renders
 * in release notes or in the wiki changelog.
 *
 * Format: `<!-- techpivot/terraform-module-releaser:release-pr:<schema>:<owner>/<repo>#<prNumber> -->`
 *
 * This is the single source of truth for the idempotency tie. Every writer (`createTaggedReleases`,
 * which appends it to each release body it creates and to each release commit message) and the reader
 * ({@link matchesPrMarker}) go through this module, so the two can never drift.
 *
 * @param {number} prNumber - The pull request number that produced the release.
 * @returns {string} The hidden marker for that pull request.
 */
export function buildPrMarker(prNumber: number): string {
  return `${RELEASE_BODY_PR_MARKER_PREFIX}${RELEASE_BODY_PR_MARKER_SCHEMA}:${buildPrIdentity(prNumber)} -->`;
}

/**
 * Returns true if the given text carries this action's marker for the given pull request.
 *
 * Used against two kinds of text, which is why it is deliberately generic:
 * - a **release body**, to detect that this pull request already released a module (step 1); and
 * - a **release commit message**, to prove that an orphan tag was produced by this pull request
 *   (step 2 provenance).
 *
 * Matching rules:
 * - **Schema-agnostic** on the schema digit: a marker written by a future `:2:` schema is still
 *   recognized by current code, and vice versa.
 * - **Repository-scoped**, so a fork never mistakes an upstream tag for its own.
 * - **Anchored to a standalone line**, so marker-shaped text inside prose is ignored.
 * - **Ambiguity is not ownership.** If the text carries markers for more than one distinct pull
 *   request, no match is reported. A single text should only ever name one producer; more than one
 *   means something injected a marker, and the safe reading is "not ours" (which costs at most a
 *   version bump, never a lost release).
 *
 * @param {string | undefined | null} text - The release body or commit message to test.
 * @param {number} prNumber - The pull request number to match.
 * @returns {boolean} Whether the text carries a marker for that pull request.
 */
export function matchesPrMarker(text: string | undefined | null, prNumber: number): boolean {
  if (!text) {
    return false;
  }

  const identities = collectMarkerIdentities(text);

  return identities.size === 1 && identities.has(buildPrIdentity(prNumber));
}

/**
 * Returns true if the given text carries one of our markers for ANY pull request.
 *
 * Used by the orphan-tag provenance check to distinguish "this tag predates the marker scheme"
 * (no marker at all — eligible for the pre-marker fallback) from "this tag names some other pull
 * request" (never adoptable, and no lookup needed).
 *
 * @param {string | undefined | null} text - The release body or commit message to test.
 * @returns {boolean} Whether the text carries a marker for any pull request.
 */
export function hasAnyPrMarker(text: string | undefined | null): boolean {
  if (!text) {
    return false;
  }

  return collectMarkerIdentities(text).size > 0;
}

/**
 * Returns true if `text` contains `marker` on a line of its own.
 *
 * Used for the fixed comment markers (`PR_SUMMARY_MARKER`, `PR_RELEASE_COMMENT_MARKER`), whose matches
 * are acted on **destructively** — the newest match is edited in place and older ones are deleted. A
 * bare `includes()` would also match a comment that merely *quotes* one of ours: GitHub's "Quote
 * reply" copies raw markdown, hidden HTML comments included, so a reviewer quoting the action's
 * comment would otherwise become the newest match and have their text overwritten.
 *
 * Quote-reply prefixes every line with `> `, so requiring the marker to start its own line (allowing
 * only horizontal whitespace) excludes quoted copies while still matching our own comments, which
 * always emit the marker as the first line. This deliberately does not filter on comment author,
 * because consumers may run the action with a custom `github-token` whose comments are not authored by
 * `github-actions[bot]`.
 *
 * @param {string | undefined | null} text - The comment body to test.
 * @param {string} marker - The exact marker string to look for.
 * @returns {boolean} Whether the marker occupies its own line.
 */
export function hasStandaloneMarkerLine(text: string | undefined | null, marker: string): boolean {
  if (!text) {
    return false;
  }

  return new RegExp(`(^|\\r?\\n)[ \\t]*${escapeRegExp(marker)}[ \\t]*(\\r?\\n|$)`).test(text);
}

/**
 * Neutralizes any text that looks like one of our markers so untrusted input can never forge the
 * idempotency tie or the provenance proof.
 *
 * Pull request titles and bodies, and commit messages, are interpolated verbatim into **release
 * bodies** (`src/changelog.ts`) and into the **release commit message** (`createTaggedReleases`).
 * Without this, a merged pull request whose description contained
 * `<!-- techpivot/terraform-module-releaser:release-pr:1:owner/repo#123 -->` on its own line would
 * plant that marker in a tag's commit message — the exact text the provenance check trusts — and could
 * make pull request #123 adopt someone else's tag or skip its own release entirely.
 *
 * We escape only the opening `<` of our own marker namespace — unrelated HTML comments a user
 * legitimately writes are left untouched. The escaped form renders visibly (rather than silently
 * disappearing as a comment), which makes an attempted forgery obvious.
 *
 * @param {string} text - Untrusted text destined for a release body or a release commit message.
 * @returns {string} The text with any marker-shaped sequences neutralized.
 */
export function neutralizePrMarkers(text: string): string {
  return text.replaceAll(RELEASE_BODY_PR_MARKER_PREFIX, `&lt;${RELEASE_BODY_PR_MARKER_PREFIX.slice(1)}`);
}
