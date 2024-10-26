import { config } from './config';

// Define a type for the release type options
export type ReleaseType = 'major' | 'minor' | 'patch';

/**
 * Determines the release type based on the provided commit message and previous release type.
 *
 * @param message - The commit message to analyze.
 * @param previousReleaseType - The previous release type ('major', 'minor', 'patch', or null).
 * @returns The computed release type: 'major', 'minor', or 'patch'.
 */
export function determineReleaseType(message: string, previousReleaseType: ReleaseType | null = null): ReleaseType {
  const messageCleaned = message.toLowerCase().trim();

  // Destructure keywords from config
  const { majorKeywords, minorKeywords } = config;

  // Determine release type from message
  let currentReleaseType: ReleaseType = 'patch';
  if (majorKeywords.some((keyword) => messageCleaned.includes(keyword))) {
    currentReleaseType = 'major';
  } else if (minorKeywords.some((keyword) => messageCleaned.includes(keyword))) {
    currentReleaseType = 'minor';
  }

  // Determine the next release type considering the previous release type
  if (currentReleaseType === 'major' || previousReleaseType === 'major') {
    return 'major';
  }
  if (currentReleaseType === 'minor' || previousReleaseType === 'minor') {
    return 'minor';
  }

  // Note: For now, we don't have a separate default increment config and therefore we'll always
  // return true which somewhat negates searching for patch keywords; however, in the future
  // there may be a usecase where we make this configurable.
  return 'patch';
}

/**
 * Computes the next tag version based on the current tag and the specified release type.
 *
 * This function increments the version based on semantic versioning rules:
 * - If the release type is 'major', it increments the major version and resets the minor and patch versions.
 * - If the release type is 'minor', it increments the minor version and resets the patch version.
 * - If the release type is 'patch', it increments the patch version.
 *
 * Note: The returned version only includes the 'vX.Y.Z' portion.
 * The caller is responsible for adding the module prefix to form the complete tag (e.g., 'module-name/vX.Y.Z').
 *
 * @param {string | null} latestTagVersion - The current version tag, or null if there is no current tag.
 * @param {ReleaseType} releaseType - The type of release to be performed ('major', 'minor', or 'patch').
 * @returns {string} The computed next tag version in the format 'vX.Y.Z'.
 */
export function getNextTagVersion(latestTagVersion: string | null, releaseType: ReleaseType): string {
  if (latestTagVersion === null) {
    return config.defaultFirstTag;
  }

  // Remove 'v' prefix if present, and split by '.'
  const semver = latestTagVersion.replace(/^v/, '').split('.').map(Number);
  if (releaseType === 'major') {
    semver[0]++;
    semver[1] = 0;
    semver[2] = 0;
  } else if (releaseType === 'minor') {
    semver[1]++;
    semver[2] = 0;
  } else {
    semver[2]++;
  }
  return `v${semver.join('.')}`;
}
