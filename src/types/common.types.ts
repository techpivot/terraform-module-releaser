import type { RELEASE_REASON, RELEASE_TYPE, SEMVER_MODE, VALID_CC_PRESETS } from '@/utils/constants';

/**
 * Common types used across the application
 */

/**
 * Represents the semantic release type associated with a release.
 *
 * This type is derived from the `RELEASE_TYPE` constant object,
 * ensuring that only valid predefined release reasons can be used.
 *
 * @see {@link RELEASE_TYPE} for the available release reason values
 */
export type ReleaseType = (typeof RELEASE_TYPE)[keyof typeof RELEASE_TYPE];

/**
 * Represents a reason for triggering a release.
 *
 * This type is derived from the `RELEASE_REASON` constant object,
 * ensuring that only valid predefined release reasons can be used.
 *
 * @see {@link RELEASE_REASON} for the available release reason values
 */
export type ReleaseReason = (typeof RELEASE_REASON)[keyof typeof RELEASE_REASON];

/**
 * Represents the semver mode used to determine version bumps.
 *
 * - `'keywords'`: Uses simple keyword substring matching (existing behavior)
 * - `'conventional-commits'`: Uses Conventional Commits specification parsing
 *
 * @see {@link SEMVER_MODE} for the available mode values
 */
export type SemverMode = (typeof SEMVER_MODE)[keyof typeof SEMVER_MODE];

/**
 * Represents the conventional commits preset used when semver-mode is 'conventional-commits'.
 *
 * - `'conventionalcommits'`: Follows the Conventional Commits v1.0.0 spec
 * - `'angular'`: Follows Angular's commit convention
 *
 * @see {@link VALID_CC_PRESETS} for the available presets
 */
export type ConventionalCommitsPreset = (typeof VALID_CC_PRESETS)[number];
