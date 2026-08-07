import { context } from '@/mocks/context';
import { RELEASE_BODY_PR_MARKER_PREFIX } from '@/utils/constants';
import {
  buildPrMarker,
  hasAnyPrMarker,
  hasStandaloneMarkerLine,
  matchesPrMarker,
  neutralizePrMarkers,
} from '@/utils/markers';
import { describe, expect, it } from 'vitest';

// The mock context repo is techpivot/terraform-module-releaser, so the scoped identity is
// `techpivot/terraform-module-releaser#<prNumber>`.
const SLUG = 'techpivot/terraform-module-releaser';

describe('utils/markers', () => {
  describe('buildPrMarker()', () => {
    it('builds the schema-versioned, repository-scoped hidden marker for a pull request', () => {
      expect(buildPrMarker(42)).toBe(`<!-- techpivot/terraform-module-releaser:release-pr:1:${SLUG}#42 -->`);
    });

    it('scopes the marker to the repository so a fork never adopts an upstream tag', () => {
      // A fork clones tags but not releases, so every latest tag there is an orphan carrying the
      // upstream marker — and fork pull request numbering restarts at 1.
      const upstreamMarker = buildPrMarker(1);

      context.set({ repo: { owner: 'someone', repo: 'my-fork' } });
      expect(matchesPrMarker(upstreamMarker, 1)).toBe(false);
      expect(buildPrMarker(1)).toBe('<!-- techpivot/terraform-module-releaser:release-pr:1:someone/my-fork#1 -->');

      context.set({ repo: { owner: 'techpivot', repo: 'terraform-module-releaser' } });
      expect(matchesPrMarker(upstreamMarker, 1)).toBe(true);
    });
  });

  describe('matchesPrMarker()', () => {
    it('matches a body that carries the current-schema marker for the pull request', () => {
      const body = `## v1.1.0\n\nchangelog\n\n${buildPrMarker(7)}`;
      expect(matchesPrMarker(body, 7)).toBe(true);
    });

    it('matches a future schema version (version-agnostic on the schema digit)', () => {
      const futureMarker = `<!-- techpivot/terraform-module-releaser:release-pr:2:${SLUG}#7 -->`;
      expect(matchesPrMarker(`notes\n\n${futureMarker}`, 7)).toBe(true);
    });

    it('matches the pull request number exactly (the trailing terminator prevents prefix collisions)', () => {
      const body = buildPrMarker(123);
      expect(matchesPrMarker(body, 123)).toBe(true);
      expect(matchesPrMarker(body, 12)).toBe(false);
      expect(matchesPrMarker(body, 1234)).toBe(false);
    });

    it('matches a marker on its own line in a CRLF body (the API may return CRLF)', () => {
      expect(matchesPrMarker(`notes\r\n\r\n${buildPrMarker(7)}\r\n`, 7)).toBe(true);
    });

    it('tolerates leading and trailing horizontal whitespace around the marker line', () => {
      expect(matchesPrMarker(`notes\n  \t${buildPrMarker(7)}  \n`, 7)).toBe(true);
    });

    it('does NOT match a marker embedded mid-line inside prose (anchored to a standalone line)', () => {
      // This is the forgery vector: attacker-influenced prose that merely contains the marker text.
      expect(matchesPrMarker(`- fix: something ${buildPrMarker(99)} and more text`, 99)).toBe(false);
    });

    it('does not match the human-facing [PR #n] changelog link or unrelated content', () => {
      expect(matchesPrMarker('- [PR #7](https://github.com/o/r/pull/7) - title', 7)).toBe(false);
      expect(matchesPrMarker('just a changelog with no marker', 7)).toBe(false);
    });

    it('returns false for an empty, undefined, or null body', () => {
      expect(matchesPrMarker('', 7)).toBe(false);
      expect(matchesPrMarker(undefined, 7)).toBe(false);
      expect(matchesPrMarker(null, 7)).toBe(false);
    });

    it('matches a commit message whose final line is the marker', () => {
      // Step 2 provenance relies on this exact shape (see createTaggedReleases).
      const commitMessage = `modules/vpc/v1.1.0\n\nSome PR title\n\nSome PR body\n\n${buildPrMarker(31)}`;
      expect(matchesPrMarker(commitMessage, 31)).toBe(true);
      expect(matchesPrMarker(commitMessage, 32)).toBe(false);
    });

    it('reports no match when the text carries markers for two different pull requests', () => {
      // Ambiguity is not ownership. A text naming two producers means something injected a marker;
      // the safe reading is "not ours", which costs at most a version bump and never a lost release.
      const ambiguous = `notes\n\n${buildPrMarker(7)}\n\n${buildPrMarker(8)}`;

      expect(matchesPrMarker(ambiguous, 7)).toBe(false);
      expect(matchesPrMarker(ambiguous, 8)).toBe(false);
      // ...but it is still recognizably "someone's", so no provenance lookup is wasted on it.
      expect(hasAnyPrMarker(ambiguous)).toBe(true);
    });

    it('still matches when the same marker appears more than once', () => {
      const repeated = `notes\n\n${buildPrMarker(7)}\n\nmore\n\n${buildPrMarker(7)}`;
      expect(matchesPrMarker(repeated, 7)).toBe(true);
    });
  });

  describe('hasStandaloneMarkerLine()', () => {
    const COMMENT_MARKER = '<!-- techpivot/terraform-module-releaser:release:1 -->';

    it('matches a marker on its own line', () => {
      expect(hasStandaloneMarkerLine(`${COMMENT_MARKER}\n\n## Releases`, COMMENT_MARKER)).toBe(true);
      expect(hasStandaloneMarkerLine(`intro\n${COMMENT_MARKER}\ntail`, COMMENT_MARKER)).toBe(true);
      expect(hasStandaloneMarkerLine(`intro\r\n${COMMENT_MARKER}\r\ntail`, COMMENT_MARKER)).toBe(true);
    });

    it('does NOT match a quote-replied copy of our comment', () => {
      // GitHub's "Quote reply" copies raw markdown (hidden HTML comments included) with a `> ` prefix.
      // Matching it would make a reviewer's comment the newest match, and it would then be overwritten.
      expect(hasStandaloneMarkerLine(`> ${COMMENT_MARKER}\n>\n> ## Releases`, COMMENT_MARKER)).toBe(false);
    });

    it('does not match the marker inline within prose', () => {
      expect(hasStandaloneMarkerLine(`see ${COMMENT_MARKER} here`, COMMENT_MARKER)).toBe(false);
    });

    it('returns false for empty, undefined, or null bodies', () => {
      expect(hasStandaloneMarkerLine('', COMMENT_MARKER)).toBe(false);
      expect(hasStandaloneMarkerLine(undefined, COMMENT_MARKER)).toBe(false);
      expect(hasStandaloneMarkerLine(null, COMMENT_MARKER)).toBe(false);
    });
  });

  describe('hasAnyPrMarker()', () => {
    it('detects a marker for any pull request', () => {
      expect(hasAnyPrMarker(`notes\n\n${buildPrMarker(5)}`)).toBe(true);
      expect(hasAnyPrMarker(`<!-- techpivot/terraform-module-releaser:release-pr:9:${SLUG}#1234 -->`)).toBe(true);
    });

    it('returns false when no marker is present', () => {
      expect(hasAnyPrMarker('plain release notes')).toBe(false);
      expect(hasAnyPrMarker('')).toBe(false);
      expect(hasAnyPrMarker(undefined)).toBe(false);
      expect(hasAnyPrMarker(null)).toBe(false);
    });

    it('does not treat a mid-line marker as present', () => {
      expect(hasAnyPrMarker(`prose ${buildPrMarker(5)} more prose`)).toBe(false);
    });
  });

  describe('neutralizePrMarkers()', () => {
    it('neutralizes a forged marker so it can no longer be matched', () => {
      const forged = buildPrMarker(99);
      const neutralized = neutralizePrMarkers(forged);

      expect(neutralized).not.toBe(forged);
      expect(matchesPrMarker(`notes\n\n${neutralized}`, 99)).toBe(false);
      expect(hasAnyPrMarker(`notes\n\n${neutralized}`)).toBe(false);
    });

    it('escapes only the opening angle bracket, keeping the attempt visible', () => {
      expect(neutralizePrMarkers(buildPrMarker(99))).toBe(
        `&lt;!-- techpivot/terraform-module-releaser:release-pr:1:${SLUG}#99 -->`,
      );
    });

    it('neutralizes every occurrence', () => {
      const text = `${buildPrMarker(1)} middle ${buildPrMarker(2)}`;
      expect(neutralizePrMarkers(text)).not.toContain(RELEASE_BODY_PR_MARKER_PREFIX);
    });

    it('leaves unrelated HTML comments untouched', () => {
      const text = '<!-- a normal comment -->\n<!-- another/namespace:thing -->';
      expect(neutralizePrMarkers(text)).toBe(text);
    });

    it('returns text without markers unchanged', () => {
      expect(neutralizePrMarkers('feat: add a feature')).toBe('feat: add a feature');
    });
  });
});
