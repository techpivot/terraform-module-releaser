import { execFileSync } from 'node:child_process';
import { run } from '@/main';
import { config } from '@/mocks/config';
import { context } from '@/mocks/context';
import { parseTerraformModules } from '@/parser';
import { type FakeRepoState, buildModules, createFakeGit, createFakeRepo } from '@/tests/helpers/fake-github';
import type { CommitDetails } from '@/types';
import { buildPrMarker, matchesPrMarker } from '@/utils/markers';
import { warning } from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * End-to-end convergence tests for the self-healing release model.
 *
 * These exercise the REAL `run()`, `createTaggedReleases()`, `addPostReleaseComment()`,
 * `getTagProvenance()`, marker and freshness code together against a stateful fake GitHub — so one
 * run's tags, releases, release-commit messages and comments become the next run's input.
 *
 * Every other suite in this repository mocks at least one side of that seam and asserts a single
 * invocation. Multi-run convergence is precisely where the defects were found during live testing
 * (a re-run silently rewriting the post-release comment; an orphan tag being adopted from the wrong
 * pull request), so it is worth testing for real rather than by hand-built fixture.
 */

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn() };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    mkdtempSync: vi.fn(() => '/tmp/fake-module'),
    cpSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    existsSync: vi.fn(() => true),
    copyFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(() => ({ isDirectory: () => false })),
    rmSync: vi.fn(),
  };
});
vi.mock('@/parser');
// The wiki and terraform-docs paths need a network and a binary; they are covered by their own suites.
vi.mock('@/wiki');
vi.mock('@/terraform-docs');
vi.mock('which', () => ({ default: vi.fn(async () => '/usr/bin/git') }));

const WORKSPACE = '/workspace';
const PR = 1;

describe('integration: self-healing releases (multi-run convergence)', () => {
  let repo: FakeRepoState;

  /** A pull request commit touching the given module directories. */
  const commitTouching = (...dirs: string[]): CommitDetails => ({
    sha: 'c1',
    message: 'feat: change modules',
    files: dirs.map((d) => `${WORKSPACE}/${d}/main.tf`),
  });

  /** Runs the action once, rebuilding modules from the CURRENT fake state (as a fresh run would). */
  const runAction = async (commits: CommitDetails[]) => {
    vi.mocked(parseTerraformModules).mockImplementation(() => buildModules(repo, WORKSPACE, commits));
    await run();
  };

  const tagNames = () => repo.tags.map((t) => t.name).sort();
  const releaseTagNames = () => repo.releases.map((r) => r.tagName).sort();
  const postReleaseComments = () =>
    repo.comments.filter((c) => c.body.includes('<!-- techpivot/terraform-module-releaser:release:1 -->'));
  const releasedModulesInComment = () =>
    (
      postReleaseComments()
        .at(-1)
        ?.body.match(/- \*\*`([^`]+)`\*\*/g) ?? []
    ).map((m) => m.replace(/- \*\*`|`\*\*/g, ''));

  beforeEach(() => {
    context.useMockOctokit();
    context.set({
      workspaceDir: WORKSPACE,
      prNumber: PR,
      issueNumber: PR,
      prTitle: 'feat: change modules',
      prBody: 'body',
      baseRef: 'main',
      mergeCommitSha: 'merge-sha',
    });
    context.isPrMergeEvent = true;
    config.set({ disableWiki: true, deleteLegacyTags: false, disableBranding: true });

    repo = createFakeRepo({ moduleDirectories: ['modules/alpha', 'modules/beta'] });
    vi.mocked(execFileSync).mockImplementation(createFakeGit(repo) as never);
  });

  it('first merge releases every module, stamping the marker in the release body AND the release commit', async () => {
    await runAction([commitTouching('modules/alpha')]);

    expect(tagNames()).toStrictEqual(['modules/alpha/v1.0.0', 'modules/beta/v1.0.0']);
    expect(releaseTagNames()).toStrictEqual(['modules/alpha/v1.0.0', 'modules/beta/v1.0.0']);

    for (const release of repo.releases) {
      expect(matchesPrMarker(release.body, PR)).toBe(true);
    }
    for (const tag of repo.tags) {
      expect(matchesPrMarker(repo.commits.get(tag.commitSHA), PR)).toBe(true);
    }
    expect(postReleaseComments()).toHaveLength(1);
  });

  it('re-running converges: no over-bump, no duplicate release, no duplicate comment', async () => {
    await runAction([commitTouching('modules/alpha')]);
    const tagsAfterFirst = tagNames();

    await runAction([commitTouching('modules/alpha')]);
    await runAction([commitTouching('modules/alpha')]);

    expect(tagNames()).toStrictEqual(tagsAfterFirst);
    expect(releaseTagNames()).toStrictEqual(tagsAfterFirst);
    expect(postReleaseComments()).toHaveLength(1);
  });

  it('regression (B1): a module released only as an INITIAL release stays in the comment on re-run', async () => {
    // `modules/beta` has no changes in this pull request — it is released purely because it had no
    // tags. On the re-run it is neither initial nor changed, so it drops out of needsRelease()
    // entirely. Before the fix the comment was rewritten from the surviving outcomes alone and beta
    // silently vanished from the pull request's audit trail.
    await runAction([commitTouching('modules/alpha')]);
    expect(releasedModulesInComment()).toStrictEqual(['modules/alpha/v1.0.0', 'modules/beta/v1.0.0']);

    await runAction([commitTouching('modules/alpha')]);

    expect(releasedModulesInComment()).toContain('modules/beta/v1.0.0');
    expect(releasedModulesInComment()).toContain('modules/alpha/v1.0.0');
  });

  it('self-heals a deleted release at the SAME version, without bumping', async () => {
    await runAction([commitTouching('modules/alpha')]);
    repo.releases = repo.releases.filter((r) => r.tagName !== 'modules/alpha/v1.0.0');

    await runAction([commitTouching('modules/alpha')]);

    expect(releaseTagNames()).toContain('modules/alpha/v1.0.0');
    expect(tagNames()).not.toContain('modules/alpha/v1.1.0');
    expect(matchesPrMarker(repo.releases.find((r) => r.tagName === 'modules/alpha/v1.0.0')?.body, PR)).toBe(true);
  });

  it('heals an orphan tag that is no longer the latest (widened step 2)', async () => {
    await runAction([commitTouching('modules/alpha')]);
    // Orphan v1.0.0, then let a LATER pull request bump alpha past it.
    repo.releases = repo.releases.filter((r) => r.tagName !== 'modules/alpha/v1.0.0');
    context.set({ prNumber: 2, issueNumber: 2 });
    await runAction([commitTouching('modules/alpha')]);
    expect(tagNames()).toContain('modules/alpha/v1.1.0');

    // Back to pull request 1: its orphan is no longer latest but is still provably its own.
    context.set({ prNumber: PR, issueNumber: PR });
    await runAction([commitTouching('modules/alpha')]);

    expect(releaseTagNames()).toContain('modules/alpha/v1.0.0');
    expect(tagNames()).not.toContain('modules/alpha/v1.2.0');
  });

  it('refuses an orphan tag it cannot attribute, and releases its own version instead', async () => {
    await runAction([commitTouching('modules/alpha')]);
    // A hand-made tag: higher than everything, no release, and a commit we know nothing about.
    repo.tags.unshift({ name: 'modules/alpha/v9.0.0', commitSHA: 'handmade-sha' });
    repo.commits.set('handmade-sha', 'chore: some unrelated hand-made commit');
    context.set({ prNumber: 3, issueNumber: 3 });

    await runAction([commitTouching('modules/alpha')]);

    // v9.0.0 is left untouched; the pull request's own change is released above it.
    expect(releaseTagNames()).not.toContain('modules/alpha/v9.0.0');
    expect(tagNames()).toContain('modules/alpha/v9.1.0');
  });

  it('refuses an orphan tag carrying a DIFFERENT pull request marker', async () => {
    await runAction([commitTouching('modules/alpha')]);
    repo.tags.unshift({ name: 'modules/alpha/v9.0.0', commitSHA: 'foreign-sha' });
    repo.commits.set('foreign-sha', `modules/alpha/v9.0.0\n\nOther PR\n\nbody\n\n${buildPrMarker(42)}`);
    context.set({ prNumber: 3, issueNumber: 3 });

    await runAction([commitTouching('modules/alpha')]);

    expect(releaseTagNames()).not.toContain('modules/alpha/v9.0.0');
    expect(tagNames()).toContain('modules/alpha/v9.1.0');
  });

  it('neutralizes a forged marker planted in the pull request body', async () => {
    context.set({ prBody: `Innocent text.\n\n${buildPrMarker(99)}\n\nMore text.` });

    await runAction([commitTouching('modules/alpha')]);

    const tag = repo.tags.find((t) => t.name === 'modules/alpha/v1.0.0');
    const message = repo.commits.get(tag?.commitSHA ?? '') ?? '';
    // The forged marker must not be honored; the genuine one must be.
    expect(matchesPrMarker(message, 99)).toBe(false);
    expect(matchesPrMarker(message, PR)).toBe(true);
    expect(message).toContain('&lt;!--');
  });

  it('legacy gate: skips releasing when a pre-marker post-release comment exists', async () => {
    repo.comments.push({
      id: 900,
      node_id: 'n900',
      body: '<!-- techpivot/terraform-module-releaser — release-marker -->\n\nreleased by an older version',
      created_at: '2026-01-01T00:00:00Z',
      user: { login: 'github-actions[bot]' },
    });

    await runAction([commitTouching('modules/alpha')]);

    expect(tagNames()).toStrictEqual([]);
    expect(releaseTagNames()).toStrictEqual([]);
  });

  it('stale checkout: releases still self-heal but cleanup and wiki are skipped', async () => {
    config.set({ disableWiki: false, deleteLegacyTags: true });
    repo.compareStatus = 'ahead';

    await runAction([commitTouching('modules/alpha')]);

    // Releases still happen — self-healing is the point of a re-run...
    expect(releaseTagNames()).toStrictEqual(['modules/alpha/v1.0.0', 'modules/beta/v1.0.0']);

    // ...but wiki regeneration (destructive: it rewrites the wiki from the stale module list) did not.
    const { generateWikiFiles, commitAndPushWikiChanges } = await import('@/wiki');
    expect(vi.mocked(generateWikiFiles)).not.toHaveBeenCalled();
    expect(vi.mocked(commitAndPushWikiChanges)).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('the checked-out tree is not current'));
  });

  it('stale checkout: withholds an initial-release module that no longer exists on the base branch', async () => {
    repo.compareStatus = 'ahead';
    repo.missingOnBaseRef.add('modules/beta');

    await runAction([commitTouching('modules/alpha')]);

    expect(tagNames()).toStrictEqual(['modules/alpha/v1.0.0']);
    expect(tagNames()).not.toContain('modules/beta/v1.0.0');
  });
});
