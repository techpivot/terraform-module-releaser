import { TerraformModule } from '@/terraform-module';
import { stubOctokitImplementation } from '@/tests/helpers/octokit';
import type { CommitDetails, GitHubRelease, GitHubTag } from '@/types';

/**
 * A minimal, **stateful** stand-in for the parts of GitHub this action mutates.
 *
 * Every unit test in this repository is a single invocation against hand-built fixtures. The whole
 * point of self-healing releases, however, is what happens on the *second* run — when the tags,
 * releases, comments and release commits produced by run N become the input to run N+1. That seam is
 * where the real defects lived (see the B1 regression), and no amount of single-shot fixture testing
 * reaches it.
 *
 * This fake closes that gap in-process. It records:
 * - **tags** and the **commit message** of the commit each tag points at (the provenance oracle), so
 *   `git.getCommit` answers truthfully on later runs;
 * - **releases** and their bodies (where the idempotency marker lives);
 * - **issue comments**, so post-release comment idempotency is observable.
 *
 * The fake git implementation is the important part: `createTaggedReleases` shells out to
 * `git commit -m <msg>` / `git tag <name>` / `git push origin <name>`, and unless the message written
 * there is carried forward, provenance cannot be tested at all.
 */
export interface FakeRepoState {
  tags: GitHubTag[];
  releases: GitHubRelease[];
  comments: { id: number; node_id: string; body: string; created_at: string; user: { login: string } }[];
  /** commit sha -> commit message. Populated by the fake `git commit`. */
  commits: Map<string, string>;
  /** Directories (relative to the workspace) that contain a Terraform module. */
  moduleDirectories: string[];
  /** `compareCommitsWithBasehead` result — flip to 'ahead' to simulate a stale checkout. */
  compareStatus: 'identical' | 'ahead' | 'behind' | 'diverged';
  /** Paths that 404 on the base ref (used by the resurrection guard). */
  missingOnBaseRef: Set<string>;
}

let seq = 0;
const nextId = () => ++seq;

/**
 * Creates a fake repository and wires it into the shared Octokit mock.
 *
 * @param {Partial<FakeRepoState>} initial - Seed state (existing tags, releases, comments, modules).
 * @returns {FakeRepoState} The live state object; assertions read from it directly.
 */
export function createFakeRepo(initial: Partial<FakeRepoState> = {}): FakeRepoState {
  const state: FakeRepoState = {
    tags: initial.tags ?? [],
    releases: initial.releases ?? [],
    comments: initial.comments ?? [],
    commits: initial.commits ?? new Map(),
    moduleDirectories: initial.moduleDirectories ?? [],
    compareStatus: initial.compareStatus ?? 'identical',
    missingOnBaseRef: initial.missingOnBaseRef ?? new Set(),
  };

  // Generic so each endpoint's literal `data` type survives instead of widening to `unknown`.
  const ok = <T>(data: T, status = 200) => ({ data, status, url: 'https://api.github.com/fake', headers: {} });

  // Shape matters: getAllTags() reads `tag.commit.sha`.
  stubOctokitImplementation('repos.listTags', () =>
    ok(state.tags.map((tag) => ({ name: tag.name, commit: { sha: tag.commitSHA } }))),
  );
  stubOctokitImplementation('repos.listReleases', () =>
    ok(
      state.releases.map((release) => ({
        id: release.id,
        name: release.title,
        body: release.body,
        tag_name: release.tagName,
      })),
    ),
  );

  stubOctokitImplementation('repos.createRelease', (params) => {
    const p = params as { tag_name: string; name?: string; body?: string };
    const release: GitHubRelease = {
      id: nextId(),
      title: p.name ?? p.tag_name,
      tagName: p.tag_name,
      body: p.body ?? '',
    };
    state.releases.unshift(release);
    return ok({ id: release.id, name: release.title, tag_name: release.tagName, body: release.body }, 201);
  });

  stubOctokitImplementation('repos.deleteRelease', (params) => {
    const { release_id } = params as { release_id: number };
    state.releases = state.releases.filter((release) => release.id !== release_id);
    return ok(undefined, 204);
  });

  // The provenance oracle: answer with the message recorded by the fake `git commit`.
  stubOctokitImplementation('git.getCommit', (params) => {
    const { commit_sha } = params as { commit_sha: string };
    const message = state.commits.get(commit_sha);
    if (message === undefined) {
      throw Object.assign(new Error('Not Found'), { status: 404 });
    }
    return ok({ message });
  });

  stubOctokitImplementation('repos.compareCommitsWithBasehead', () =>
    ok({ status: state.compareStatus, ahead_by: state.compareStatus === 'identical' ? 0 : 3, behind_by: 0 }),
  );

  stubOctokitImplementation('repos.getContent', (params) => {
    const { path } = params as { path: string };
    if (state.missingOnBaseRef.has(path)) {
      throw Object.assign(new Error('Not Found'), { status: 404 });
    }
    return ok({});
  });

  stubOctokitImplementation('issues.listComments', () => ok(state.comments));
  stubOctokitImplementation('issues.createComment', (params) => {
    const { body } = params as { body: string };
    const comment = {
      id: nextId(),
      node_id: `node-${seq}`,
      body,
      created_at: '2026-01-01T00:00:00Z',
      user: { login: 'github-actions[bot]' },
    };
    state.comments.push(comment);
    return ok({ id: comment.id, html_url: `https://x/#${comment.id}` }, 201);
  });
  stubOctokitImplementation('issues.updateComment', (params) => {
    const { comment_id, body } = params as { comment_id: number; body: string };
    const comment = state.comments.find((c) => c.id === comment_id);
    if (comment) {
      comment.body = body;
    }
    return ok({ id: comment_id });
  });
  stubOctokitImplementation('issues.deleteComment', (params) => {
    const { comment_id } = params as { comment_id: number };
    state.comments = state.comments.filter((c) => c.id !== comment_id);
    return ok(undefined, 204);
  });

  return state;
}

/**
 * Builds a fake `execFileSync` that emulates just enough git for `createTaggedReleases`.
 *
 * Critically it records the message passed to `git commit -m` against the synthetic SHA that
 * `git rev-parse HEAD` then returns, and associates that SHA with the tag pushed immediately after.
 * Without this, a tag created by run N carries no recoverable message and provenance on run N+1 could
 * not be exercised at all.
 *
 * @param {FakeRepoState} state - The repository state to mutate.
 * @returns {(file: string, args?: readonly string[]) => Buffer} A drop-in `execFileSync` replacement.
 */
export function createFakeGit(state: FakeRepoState) {
  let pendingMessage = '';
  let pendingSha = '';

  return (_file: string, args?: readonly string[]): Buffer => {
    const argv = Array.isArray(args) ? args : [];

    if (argv[0] === 'commit' && argv[1] === '-m') {
      pendingMessage = String(argv[2]);
      pendingSha = `sha-${nextId()}`;
      state.commits.set(pendingSha, pendingMessage);
      return Buffer.from('');
    }

    if (argv[0] === 'tag') {
      // `git tag <name>` — remember which tag the pending commit belongs to.
      state.tags.unshift({ name: String(argv[1]), commitSHA: pendingSha });
      // Keep tags ordered the way TerraformModule expects (semver desc is applied by setTags).
      return Buffer.from('');
    }

    if (argv[0] === 'rev-parse') {
      return Buffer.from(pendingSha);
    }

    return Buffer.from('');
  };
}

/**
 * Builds Terraform modules the way `parseTerraformModules` would, from the fake state.
 *
 * Reuses the real tag/release association logic (`TerraformModule.getTagsForModule` /
 * `getReleasesForModule`) so module naming, tag matching and semver ordering behave exactly as in
 * production — only the filesystem walk is replaced.
 *
 * @param {FakeRepoState} state - The repository state.
 * @param {string} workspaceDir - The workspace root.
 * @param {CommitDetails[]} commits - Commits attributed to the pull request.
 * @returns {TerraformModule[]} Modules with tags, releases and commits attached.
 */
export function buildModules(
  state: FakeRepoState,
  workspaceDir: string,
  commits: CommitDetails[] = [],
): TerraformModule[] {
  return state.moduleDirectories.map((relativeDir) => {
    const module = new TerraformModule(`${workspaceDir}/${relativeDir}`);
    module.setTags(TerraformModule.getTagsForModule(module.name, state.tags));
    module.setReleases(TerraformModule.getReleasesForModule(module.name, state.releases));
    for (const commit of commits) {
      if (commit.files.some((file) => file.startsWith(`${workspaceDir}/${relativeDir}/`))) {
        module.addCommit(commit);
      }
    }
    return module;
  });
}
