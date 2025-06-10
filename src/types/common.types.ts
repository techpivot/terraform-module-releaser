import type { RELEASE_REASON, RELEASE_TYPE } from '@/utils/constants';

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
