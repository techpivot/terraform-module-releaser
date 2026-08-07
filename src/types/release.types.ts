import type { TerraformModule } from '@/terraform-module';
import type { ReleaseType } from '@/types/common.types';
import type { GitHubRelease } from '@/types/github.types';

/**
 * Release and self-healing related types
 */

/**
 * What `createTaggedReleases()` actually did for a module on this run.
 *
 * - `created` — a new version was bumped, committed, tagged, pushed, and released (the normal path).
 * - `recovered` — an existing tag produced by this pull request had no release (a partial failure, or
 *   a release deleted by hand), so the missing release was created for that tag at its existing
 *   version. No bump, no new tag.
 * - `skipped` — this pull request had already released the module; nothing was created.
 */
export type ReleaseAction = 'created' | 'recovered' | 'skipped';

/**
 * The per-module result of `createTaggedReleases()`.
 *
 * This exists because "which modules were released" is no longer the whole story once releases are
 * self-healing: on a re-run a module may be skipped or recovered rather than newly created, and the
 * version that ends up published is then NOT the live-bumped `module.getReleaseTag()`. Consumers of
 * the action's outputs and the post-release comment must both report the tag that actually exists.
 */
export interface ReleaseOutcome {
  /**
   * The module this outcome describes.
   */
  module: TerraformModule;

  /**
   * What was done for this module on this run.
   */
  action: ReleaseAction;

  /**
   * The tag that actually exists for this pull request's release of the module. For `created` this is
   * the newly pushed tag; for `recovered` and `skipped` it is the pre-existing tag.
   */
  releaseTag: string;

  /**
   * The release attributed to this pull request — never simply the module's highest release.
   */
  release: GitHubRelease;
}

/**
 * What happened to a changed module, as reported in the `changed-modules-map` action output.
 *
 * Extends {@link ReleaseAction} with `none`, meaning no release was attempted for the module on this
 * run — because the legacy gate skipped the pull request, or because the module was withheld on a
 * stale checkout. When the action is `none`, `releaseTag` is `null`: nothing was published.
 */
export type ChangedModuleAction = ReleaseAction | 'none';

/**
 * The per-module shape of the `changed-modules-map` action output.
 *
 * On a merge run this map is re-emitted after releases are created so `releaseTag` names a tag that
 * actually exists rather than the optimistically computed next version. Consumers should branch on
 * `action` before treating `releaseTag` as a newly published release.
 */
export interface ChangedModuleOutput {
  /**
   * The directory path of the module.
   */
  path: string;

  /**
   * The most recent git tag for the module prior to this run.
   */
  latestTag: string | null;

  /**
   * The tag associated with this pull request's release of the module, or `null` when nothing was
   * published (`action: 'none'`).
   */
  releaseTag: string | null;

  /**
   * The computed release type (major, minor, patch).
   */
  releaseType: ReleaseType | null;

  /**
   * What the action actually did for this module. Only present on merge runs.
   */
  action?: ChangedModuleAction;
}
