import {
  computeReleaseType,
  detectConventionalCommitReleaseType,
  detectKeywordReleaseType,
  higherPriorityReleaseType,
  parseConventionalCommit,
} from '@/commit-analyzer';
import { config } from '@/mocks/config';
import { RELEASE_TYPE } from '@/utils/constants';
import { beforeEach, describe, expect, it } from 'vitest';

describe('commit-analyzer', () => {
  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // parseConventionalCommit()
  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  describe('parseConventionalCommit()', () => {
    describe('valid conventional commit messages', () => {
      it('should parse a simple feat commit', () => {
        const result = parseConventionalCommit('feat: add new endpoint');
        expect(result).toEqual({
          type: 'feat',
          scope: null,
          breaking: false,
          description: 'add new endpoint',
        });
      });

      it('should parse a fix commit', () => {
        const result = parseConventionalCommit('fix: resolve null pointer');
        expect(result).toEqual({
          type: 'fix',
          scope: null,
          breaking: false,
          description: 'resolve null pointer',
        });
      });

      it('should parse a commit with scope', () => {
        const result = parseConventionalCommit('feat(api): add user endpoint');
        expect(result).toEqual({
          type: 'feat',
          scope: 'api',
          breaking: false,
          description: 'add user endpoint',
        });
      });

      it('should parse a commit with breaking change bang', () => {
        const result = parseConventionalCommit('feat!: drop Node 16 support');
        expect(result).toEqual({
          type: 'feat',
          scope: null,
          breaking: true,
          description: 'drop Node 16 support',
        });
      });

      it('should parse a commit with scope and breaking change bang', () => {
        const result = parseConventionalCommit('fix(auth)!: remove legacy OAuth flow');
        expect(result).toEqual({
          type: 'fix',
          scope: 'auth',
          breaking: true,
          description: 'remove legacy OAuth flow',
        });
      });

      it('should parse chore commit', () => {
        const result = parseConventionalCommit('chore: update dependencies');
        expect(result).toEqual({
          type: 'chore',
          scope: null,
          breaking: false,
          description: 'update dependencies',
        });
      });

      it('should parse docs commit', () => {
        const result = parseConventionalCommit('docs: update README');
        expect(result).toEqual({
          type: 'docs',
          scope: null,
          breaking: false,
          description: 'update README',
        });
      });

      it('should parse refactor commit', () => {
        const result = parseConventionalCommit('refactor(parser): simplify logic');
        expect(result).toEqual({
          type: 'refactor',
          scope: 'parser',
          breaking: false,
          description: 'simplify logic',
        });
      });

      it('should parse perf commit', () => {
        const result = parseConventionalCommit('perf: optimize query execution');
        expect(result).toEqual({
          type: 'perf',
          scope: null,
          breaking: false,
          description: 'optimize query execution',
        });
      });

      it('should parse test commit', () => {
        const result = parseConventionalCommit('test: add unit tests for parser');
        expect(result).toEqual({
          type: 'test',
          scope: null,
          breaking: false,
          description: 'add unit tests for parser',
        });
      });

      it('should parse build commit', () => {
        const result = parseConventionalCommit('build(deps): bump typescript to 5.9');
        expect(result).toEqual({
          type: 'build',
          scope: 'deps',
          breaking: false,
          description: 'bump typescript to 5.9',
        });
      });

      it('should parse ci commit', () => {
        const result = parseConventionalCommit('ci: add GitHub Actions workflow');
        expect(result).toEqual({
          type: 'ci',
          scope: null,
          breaking: false,
          description: 'add GitHub Actions workflow',
        });
      });

      it('should parse style commit', () => {
        const result = parseConventionalCommit('style: fix formatting');
        expect(result).toEqual({
          type: 'style',
          scope: null,
          breaking: false,
          description: 'fix formatting',
        });
      });

      it('should parse revert commit', () => {
        const result = parseConventionalCommit('revert: undo last change');
        expect(result).toEqual({
          type: 'revert',
          scope: null,
          breaking: false,
          description: 'undo last change',
        });
      });

      it('should normalize type to lowercase', () => {
        const result = parseConventionalCommit('FEAT: uppercase type');
        expect(result).toEqual({
          type: 'feat',
          scope: null,
          breaking: false,
          description: 'uppercase type',
        });
      });

      it('should handle mixed case types', () => {
        const result = parseConventionalCommit('Fix: mixed case');
        expect(result).toEqual({
          type: 'fix',
          scope: null,
          breaking: false,
          description: 'mixed case',
        });
      });

      it('should return null for extra spaces around colon (not valid CC format)', () => {
        // Conventional Commits spec requires type immediately followed by colon
        const result = parseConventionalCommit('feat : extra space before colon');
        expect(result).toBeNull();
      });

      it('should return null for no space after colon (not valid CC format)', () => {
        // Conventional Commits spec requires a space after the colon
        const result = parseConventionalCommit('feat:no space');
        expect(result).toBeNull();
      });

      it('should handle empty scope parentheses', () => {
        const result = parseConventionalCommit('feat(): empty scope');
        expect(result).toEqual({
          type: 'feat',
          scope: null,
          breaking: false,
          description: 'empty scope',
        });
      });

      it('should handle scope with special characters', () => {
        const result = parseConventionalCommit('feat(my-scope_v2): complex scope');
        expect(result).toEqual({
          type: 'feat',
          scope: 'my-scope_v2',
          breaking: false,
          description: 'complex scope',
        });
      });
    });

    describe('BREAKING CHANGE footer detection', () => {
      it('should detect BREAKING CHANGE footer with space separator', () => {
        const result = parseConventionalCommit('feat: new feature\n\nBREAKING CHANGE: old API removed');
        expect(result).toEqual({
          type: 'feat',
          scope: null,
          breaking: true,
          description: 'new feature',
        });
      });

      it('should detect BREAKING-CHANGE footer with hyphen separator', () => {
        const result = parseConventionalCommit('fix: patch\n\nBREAKING-CHANGE: something broke');
        expect(result).toEqual({
          type: 'fix',
          scope: null,
          breaking: true,
          description: 'patch',
        });
      });

      it('should detect BREAKING CHANGE footer with both bang and footer', () => {
        const result = parseConventionalCommit('feat!: double breaking\n\nBREAKING CHANGE: details here');
        expect(result).toEqual({
          type: 'feat',
          scope: null,
          breaking: true,
          description: 'double breaking',
        });
      });

      it('should detect BREAKING CHANGE footer deep in multi-line body', () => {
        const message = [
          'feat: add feature',
          '',
          'This is the body of the commit message.',
          'It spans multiple lines.',
          '',
          'BREAKING CHANGE: the old API has been removed',
        ].join('\n');

        const result = parseConventionalCommit(message);
        expect(result?.breaking).toBe(true);
      });

      it('should not detect breaking from partial BREAKING CHANGE text in body', () => {
        // "NOT A BREAKING CHANGE" should still match because BREAKING CHANGE: is on its own line
        // Actually, the regex /^BREAKING[ -]CHANGE\s*:/m only matches at the start of a line
        const result = parseConventionalCommit('feat: feature\n\nThis is NOT A BREAKING CHANGE in text');
        expect(result?.breaking).toBe(false);
      });
    });

    describe('non-conventional commit messages', () => {
      it('should return null for plain text message', () => {
        expect(parseConventionalCommit('update readme')).toBeNull();
      });

      it('should return null for message without colon', () => {
        expect(parseConventionalCommit('feat add new feature')).toBeNull();
      });

      it('should return null for empty string', () => {
        expect(parseConventionalCommit('')).toBeNull();
      });

      it('should return null for message with only whitespace', () => {
        expect(parseConventionalCommit('   ')).toBeNull();
      });

      it('should return null for merge commit', () => {
        expect(parseConventionalCommit("Merge branch 'feature' into main")).toBeNull();
      });

      it('should return null for message with colon but no type', () => {
        expect(parseConventionalCommit(': no type here')).toBeNull();
      });
    });

    describe('edge cases', () => {
      it('should handle multi-line message and only parse first line', () => {
        const result = parseConventionalCommit('feat: first line\n\ndetailed body\nmore details');
        expect(result).toEqual({
          type: 'feat',
          scope: null,
          breaking: false,
          description: 'first line',
        });
      });

      it('should handle description with colons', () => {
        const result = parseConventionalCommit('fix: handle edge case: null values in arrays');
        expect(result).toEqual({
          type: 'fix',
          scope: null,
          breaking: false,
          description: 'handle edge case: null values in arrays',
        });
      });

      it('should handle unrecognized but valid types', () => {
        const result = parseConventionalCommit('improvement: better logging');
        expect(result).toEqual({
          type: 'improvement',
          scope: null,
          breaking: false,
          description: 'better logging',
        });
      });

      it('should handle numeric type names', () => {
        const result = parseConventionalCommit('v2: new version');
        expect(result).toEqual({
          type: 'v2',
          scope: null,
          breaking: false,
          description: 'new version',
        });
      });

      it('should handle empty description with body text', () => {
        const result = parseConventionalCommit('feat: \n\nsome body text');
        expect(result).toEqual({
          type: 'feat',
          scope: null,
          breaking: false,
          description: '',
        });
      });
    });
  });

  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // detectConventionalCommitReleaseType()
  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  describe('detectConventionalCommitReleaseType()', () => {
    describe('MAJOR releases', () => {
      it('should return major for feat with bang', () => {
        expect(detectConventionalCommitReleaseType('feat!: breaking feature')).toBe(RELEASE_TYPE.MAJOR);
      });

      it('should return major for fix with bang', () => {
        expect(detectConventionalCommitReleaseType('fix!: breaking fix')).toBe(RELEASE_TYPE.MAJOR);
      });

      it('should return major for any type with bang', () => {
        expect(detectConventionalCommitReleaseType('chore!: breaking chore')).toBe(RELEASE_TYPE.MAJOR);
      });

      it('should return major for scoped type with bang', () => {
        expect(detectConventionalCommitReleaseType('feat(api)!: remove endpoint')).toBe(RELEASE_TYPE.MAJOR);
      });

      it('should return major for BREAKING CHANGE footer', () => {
        expect(detectConventionalCommitReleaseType('feat: feature\n\nBREAKING CHANGE: removed old API')).toBe(
          RELEASE_TYPE.MAJOR,
        );
      });

      it('should return major for BREAKING-CHANGE footer', () => {
        expect(detectConventionalCommitReleaseType('fix: patch\n\nBREAKING-CHANGE: interface changed')).toBe(
          RELEASE_TYPE.MAJOR,
        );
      });
    });

    describe('MINOR releases', () => {
      it('should return minor for feat type', () => {
        expect(detectConventionalCommitReleaseType('feat: add new feature')).toBe(RELEASE_TYPE.MINOR);
      });

      it('should return minor for feat with scope', () => {
        expect(detectConventionalCommitReleaseType('feat(auth): add OAuth support')).toBe(RELEASE_TYPE.MINOR);
      });
    });

    describe('PATCH releases', () => {
      it('should return patch for fix type', () => {
        expect(detectConventionalCommitReleaseType('fix: resolve null pointer')).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return patch for fix with scope', () => {
        expect(detectConventionalCommitReleaseType('fix(parser): handle empty input')).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return patch for chore type', () => {
        expect(detectConventionalCommitReleaseType('chore: update dependencies')).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return patch for docs type', () => {
        expect(detectConventionalCommitReleaseType('docs: update README')).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return patch for refactor type', () => {
        expect(detectConventionalCommitReleaseType('refactor: simplify logic')).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return patch for style type', () => {
        expect(detectConventionalCommitReleaseType('style: fix formatting')).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return patch for test type', () => {
        expect(detectConventionalCommitReleaseType('test: add unit tests')).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return patch for build type', () => {
        expect(detectConventionalCommitReleaseType('build: update ncc config')).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return patch for ci type', () => {
        expect(detectConventionalCommitReleaseType('ci: add workflow')).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return patch for perf type', () => {
        expect(detectConventionalCommitReleaseType('perf: optimize queries')).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return patch for revert type', () => {
        expect(detectConventionalCommitReleaseType('revert: undo change')).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return patch for unrecognized but valid CC types', () => {
        expect(detectConventionalCommitReleaseType('improvement: better logging')).toBe(RELEASE_TYPE.PATCH);
      });
    });

    describe('non-conventional messages', () => {
      it('should return null for plain text message', () => {
        expect(detectConventionalCommitReleaseType('update readme')).toBeNull();
      });

      it('should return null for merge commit', () => {
        expect(detectConventionalCommitReleaseType("Merge branch 'feature' into main")).toBeNull();
      });

      it('should return null for empty string', () => {
        expect(detectConventionalCommitReleaseType('')).toBeNull();
      });
    });

    describe('case sensitivity', () => {
      it('should handle uppercase type', () => {
        expect(detectConventionalCommitReleaseType('FEAT: uppercase')).toBe(RELEASE_TYPE.MINOR);
      });

      it('should handle mixed case type', () => {
        expect(detectConventionalCommitReleaseType('Fix: mixed case')).toBe(RELEASE_TYPE.PATCH);
      });
    });
  });

  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // detectKeywordReleaseType()
  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  describe('detectKeywordReleaseType()', () => {
    const majorKeywords = ['BREAKING CHANGE', 'major change'];
    const minorKeywords = ['feat:', 'feature:'];
    const patchKeywords = ['fix:', 'chore:', 'docs:'];

    describe('MAJOR keyword matching', () => {
      it('should return major when message contains a major keyword', () => {
        expect(
          detectKeywordReleaseType('BREAKING CHANGE: major update', majorKeywords, minorKeywords, patchKeywords),
        ).toBe(RELEASE_TYPE.MAJOR);
      });

      it('should be case insensitive for keywords', () => {
        expect(
          detectKeywordReleaseType('breaking change: major update', majorKeywords, minorKeywords, patchKeywords),
        ).toBe(RELEASE_TYPE.MAJOR);
      });

      it('should match any configured major keyword', () => {
        expect(detectKeywordReleaseType('this is a major change', majorKeywords, minorKeywords, patchKeywords)).toBe(
          RELEASE_TYPE.MAJOR,
        );
      });
    });

    describe('MINOR keyword matching', () => {
      it('should return minor when message contains a minor keyword', () => {
        expect(detectKeywordReleaseType('feat: add new feature', majorKeywords, minorKeywords, patchKeywords)).toBe(
          RELEASE_TYPE.MINOR,
        );
      });

      it('should be case insensitive for minor keywords', () => {
        expect(detectKeywordReleaseType('FEAT: add new feature', majorKeywords, minorKeywords, patchKeywords)).toBe(
          RELEASE_TYPE.MINOR,
        );
      });

      it('should handle mixed case minor keywords', () => {
        expect(detectKeywordReleaseType('Feature: add login', majorKeywords, minorKeywords, patchKeywords)).toBe(
          RELEASE_TYPE.MINOR,
        );
      });
    });

    describe('PATCH keyword matching', () => {
      it('should return patch when message contains a patch keyword', () => {
        expect(detectKeywordReleaseType('fix: resolve bug', majorKeywords, minorKeywords, patchKeywords)).toBe(
          RELEASE_TYPE.PATCH,
        );
      });

      it('should match chore keyword', () => {
        expect(
          detectKeywordReleaseType('chore: update dependencies', majorKeywords, minorKeywords, patchKeywords),
        ).toBe(RELEASE_TYPE.PATCH);
      });

      it('should match docs keyword', () => {
        expect(detectKeywordReleaseType('docs: update README', majorKeywords, minorKeywords, patchKeywords)).toBe(
          RELEASE_TYPE.PATCH,
        );
      });
    });

    describe('priority order', () => {
      it('should prioritize major over minor when both keywords present', () => {
        expect(
          detectKeywordReleaseType('BREAKING CHANGE feat: both present', majorKeywords, minorKeywords, patchKeywords),
        ).toBe(RELEASE_TYPE.MAJOR);
      });

      it('should prioritize minor over patch when both keywords present', () => {
        expect(detectKeywordReleaseType('feat: fix: both present', majorKeywords, minorKeywords, patchKeywords)).toBe(
          RELEASE_TYPE.MINOR,
        );
      });
    });

    describe('no keyword match', () => {
      it('should return null when no keywords match', () => {
        expect(
          detectKeywordReleaseType('update configuration', majorKeywords, minorKeywords, patchKeywords),
        ).toBeNull();
      });

      it('should return null for empty message', () => {
        expect(detectKeywordReleaseType('', majorKeywords, minorKeywords, patchKeywords)).toBeNull();
      });

      it('should return null when keyword lists are empty', () => {
        expect(detectKeywordReleaseType('feat: something', [], [], [])).toBeNull();
      });
    });
  });

  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // higherPriorityReleaseType()
  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  describe('higherPriorityReleaseType()', () => {
    it('should return the candidate when current is null', () => {
      expect(higherPriorityReleaseType(null, RELEASE_TYPE.PATCH)).toBe(RELEASE_TYPE.PATCH);
      expect(higherPriorityReleaseType(null, RELEASE_TYPE.MINOR)).toBe(RELEASE_TYPE.MINOR);
      expect(higherPriorityReleaseType(null, RELEASE_TYPE.MAJOR)).toBe(RELEASE_TYPE.MAJOR);
    });

    it('should return major when candidate is major', () => {
      expect(higherPriorityReleaseType(RELEASE_TYPE.PATCH, RELEASE_TYPE.MAJOR)).toBe(RELEASE_TYPE.MAJOR);
      expect(higherPriorityReleaseType(RELEASE_TYPE.MINOR, RELEASE_TYPE.MAJOR)).toBe(RELEASE_TYPE.MAJOR);
    });

    it('should return major when current is major', () => {
      expect(higherPriorityReleaseType(RELEASE_TYPE.MAJOR, RELEASE_TYPE.PATCH)).toBe(RELEASE_TYPE.MAJOR);
      expect(higherPriorityReleaseType(RELEASE_TYPE.MAJOR, RELEASE_TYPE.MINOR)).toBe(RELEASE_TYPE.MAJOR);
    });

    it('should return minor when candidate is minor and current is patch', () => {
      expect(higherPriorityReleaseType(RELEASE_TYPE.PATCH, RELEASE_TYPE.MINOR)).toBe(RELEASE_TYPE.MINOR);
    });

    it('should return minor when current is minor and candidate is patch', () => {
      expect(higherPriorityReleaseType(RELEASE_TYPE.MINOR, RELEASE_TYPE.PATCH)).toBe(RELEASE_TYPE.MINOR);
    });

    it('should return patch when both are patch', () => {
      expect(higherPriorityReleaseType(RELEASE_TYPE.PATCH, RELEASE_TYPE.PATCH)).toBe(RELEASE_TYPE.PATCH);
    });

    it('should return major when both are major', () => {
      expect(higherPriorityReleaseType(RELEASE_TYPE.MAJOR, RELEASE_TYPE.MAJOR)).toBe(RELEASE_TYPE.MAJOR);
    });

    it('should return minor when both are minor', () => {
      expect(higherPriorityReleaseType(RELEASE_TYPE.MINOR, RELEASE_TYPE.MINOR)).toBe(RELEASE_TYPE.MINOR);
    });
  });

  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // computeReleaseType()
  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  describe('computeReleaseType()', () => {
    describe('keywords mode', () => {
      beforeEach(() => {
        config.set({ semverMode: 'keywords' });
      });

      it('should return major when commit contains major keyword', () => {
        expect(computeReleaseType(['BREAKING CHANGE: major update'])).toBe(RELEASE_TYPE.MAJOR);
      });

      it('should return minor when commit contains minor keyword', () => {
        expect(computeReleaseType(['feat: add new feature'])).toBe(RELEASE_TYPE.MINOR);
      });

      it('should return patch when commit contains patch keyword', () => {
        expect(computeReleaseType(['fix: bug fix'])).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return highest release type from multiple commits', () => {
        const messages = ['fix: bug fix', 'feat: new feature', 'docs: update readme'];
        expect(computeReleaseType(messages)).toBe(RELEASE_TYPE.MINOR);
      });

      it('should return null when no keywords match', () => {
        expect(computeReleaseType(['update configuration'])).toBeNull();
      });

      it('should return null for empty messages array', () => {
        expect(computeReleaseType([])).toBeNull();
      });

      it('should be case insensitive for keywords', () => {
        expect(computeReleaseType(['breaking change: major update'])).toBe(RELEASE_TYPE.MAJOR);
      });

      it('should handle mixed case features', () => {
        expect(computeReleaseType(['FEAT: add new feature'])).toBe(RELEASE_TYPE.MINOR);
      });

      it('should use matched keyword even with multiple unmatched commits', () => {
        const messages = ['update docs', 'feat: add new feature', 'update config'];
        expect(computeReleaseType(messages)).toBe(RELEASE_TYPE.MINOR);
      });

      it('should return patch keyword match', () => {
        expect(computeReleaseType(['chore: update dependencies'])).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return major as highest from mixed keyword commits', () => {
        const messages = ['update config', 'feat: add feature', 'BREAKING CHANGE: major update'];
        expect(computeReleaseType(messages)).toBe(RELEASE_TYPE.MAJOR);
      });

      it('should use custom keyword lists', () => {
        config.set({
          majorKeywords: ['CRITICAL'],
          minorKeywords: ['enhancement'],
          patchKeywords: ['tweak'],
        });

        expect(computeReleaseType(['CRITICAL: security issue'])).toBe(RELEASE_TYPE.MAJOR);
        expect(computeReleaseType(['enhancement: improve UX'])).toBe(RELEASE_TYPE.MINOR);
        expect(computeReleaseType(['tweak: adjust spacing'])).toBe(RELEASE_TYPE.PATCH);
        expect(computeReleaseType(['feat: not matched'])).toBeNull();
      });
    });

    describe('conventional-commits mode', () => {
      beforeEach(() => {
        config.set({
          semverMode: 'conventional-commits',
        });
      });

      it('should return minor for feat commit', () => {
        expect(computeReleaseType(['feat: add new feature'])).toBe(RELEASE_TYPE.MINOR);
      });

      it('should return patch for fix commit', () => {
        expect(computeReleaseType(['fix: resolve null pointer'])).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return major for commit with bang', () => {
        expect(computeReleaseType(['feat!: drop Node 16 support'])).toBe(RELEASE_TYPE.MAJOR);
      });

      it('should return major for commit with BREAKING CHANGE footer', () => {
        expect(computeReleaseType(['feat: new feature\n\nBREAKING CHANGE: old API removed'])).toBe(RELEASE_TYPE.MAJOR);
      });

      it('should return patch for chore commit', () => {
        expect(computeReleaseType(['chore: update dependencies'])).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return patch for docs commit', () => {
        expect(computeReleaseType(['docs: update README'])).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return patch for refactor commit', () => {
        expect(computeReleaseType(['refactor: simplify logic'])).toBe(RELEASE_TYPE.PATCH);
      });

      it('should return highest release type from multiple conventional commits', () => {
        const messages = ['fix: bug fix', 'feat: new feature', 'chore: update deps'];
        expect(computeReleaseType(messages)).toBe(RELEASE_TYPE.MINOR);
      });

      it('should return major when any commit is breaking in a mix', () => {
        const messages = ['fix: bug fix', 'feat!: breaking feature', 'docs: update docs'];
        expect(computeReleaseType(messages)).toBe(RELEASE_TYPE.MAJOR);
      });

      it('should return null when no commits are conventional', () => {
        expect(computeReleaseType(['update configuration'])).toBeNull();
      });

      it('should return null for empty messages array', () => {
        expect(computeReleaseType([])).toBeNull();
      });

      it('should not recognize keyword-style messages as conventional commits', () => {
        // "BREAKING CHANGE: ..." is NOT a valid CC header (has space after "BREAKING")
        expect(computeReleaseType(['BREAKING CHANGE: this is a plain text major'])).toBeNull();
      });

      it('should handle mixed conventional and non-conventional commits', () => {
        const messages = ['update documentation', 'feat: add new feature'];
        // feat matched → minor, non-CC message → null (skipped)
        expect(computeReleaseType(messages)).toBe(RELEASE_TYPE.MINOR);
      });
    });
  });
});
