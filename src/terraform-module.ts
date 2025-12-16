import { relative } from 'node:path';
import { config } from '@/config';
import { context } from '@/context';
import type { CommitDetails, GitHubRelease, GitHubTag, ReleaseReason, ReleaseType } from '@/types';
import {
  MODULE_TAG_REGEX,
  RELEASE_REASON,
  RELEASE_TYPE,
  VALID_TAG_DIRECTORY_SEPARATORS,
  VERSION_TAG_REGEX,
} from '@/utils/constants';
import { removeLeadingCharacters, removeTrailingCharacters } from '@/utils/string';
import { endGroup, info, startGroup } from '@actions/core';

/**
 * Represents a Terraform module with its associated metadata, commits, and release information.
 *
 * The TerraformModule class provides functionality to track changes to a Terraform module,
 * manage its release lifecycle, and compute appropriate version updates based on changes.
 * It handles both direct changes to module files and dependency-triggered updates.
 */
export class TerraformModule {
  /**
   * The Terraform module name used for tagging with some special characters removed.
   */
  public readonly name: string;

  /**
   * The full path to the directory where the module is located.
   */
  public readonly directory: string;

  /**
   * Map of commits that affect this module, keyed by SHA to prevent duplicates.
   */
  private readonly _commits: Map<string, CommitDetails> = new Map();

  /**
   * Private list of tags relevant to this module.
   */
  private _tags: GitHubTag[] = [];

  /**
   * Private list of releases relevant to this module.
   */
  private _releases: GitHubRelease[] = [];

  constructor(directory: string) {
    this.directory = directory;

    // Handle modules outside workspace directory (primarily for testing scenarios)
    // Falls back to directory name when relative path contains '../'
    const relativePath = relative(context.workspaceDir, directory);

    // If relative path starts with '../', the module is outside the workspace directory
    // Fall back to using the directory name directly to avoid invalid module names
    const pathForModuleName = relativePath.startsWith('../') ? directory : relativePath;

    this.name = TerraformModule.getTerraformModuleNameFromRelativePath(pathForModuleName);
  }

  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Commits
  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  /**
   * Gets all commits that affect this Terraform module.
   *
   * Returns a read-only array of commit details that have been associated with this module
   * through files changes. Each commit includes the SHA, message, and affected file paths.
   *
   * @returns {ReadonlyArray<CommitDetails>} A read-only array of commit details affecting this module
   *
   * @example
   * ```typescript
   * const module = new TerraformModule('/path/to/module');
   * const commits = module.commits;
   * console.log(`Module has ${commits.length} commits`);
   * ```
   */
  public get commits(): ReadonlyArray<CommitDetails> {
    return Array.from(this._commits.values());
  }

  /**
   * Gets all commit messages for commits that affect this Terraform module.
   *
   * Extracts just the commit messages from the full commit details, providing
   * a convenient way to access commit messages for analysis or display purposes.
   *
   * @returns {ReadonlyArray<string>} A read-only array of commit messages
   *
   * @example
   * ```typescript
   * const module = new TerraformModule('/path/to/module');
   * const messages = module.commitMessages;
   * console.log('Recent changes:', messages.join(', '));
   * ```
   */
  public get commitMessages(): ReadonlyArray<string> {
    return this.commits.map((c) => c.message);
  }

  /**
   * Adds a commit to this module's commit collection with automatic deduplication.
   *
   * This method safely adds commit details to the module's internal commit tracking.
   * It prevents duplicate entries by using the commit SHA as a unique identifier.
   * Multiple file changes from the same commit will only result in one commit entry.
   *
   * @param {CommitDetails} commit - The commit details to add, including SHA, message, and file paths
   * @returns {void}
   *
   * @example
   * ```typescript
   * const module = new TerraformModule('/path/to/module');
   * module.addCommit({
   *   sha: 'abc123def456',
   *   message: 'feat: add new feature',
   *   files: ['module/main.tf', 'module/variables.tf']
   * });
   * ```
   */
  public addCommit(commit: CommitDetails): void {
    if (!this._commits.has(commit.sha)) {
      this._commits.set(commit.sha, commit);
    }
  }

  /**
   * Clears all commits associated with this Terraform module.
   *
   * This method removes all commit details from the module's internal commit tracking.
   * It is typically called after a module has been successfully released to prevent
   * the module from being released again for the same commits.
   *
   * @returns {void}
   */
  public clearCommits(): void {
    this._commits.clear();
  }

  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Tags
  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  /**
   * Sets the Git tags associated with this Terraform module.
   *
   * Accepts an array of GitHubTag objects and automatically sorts them by semantic version
   * in descending order (newest first). Tags must have name following the format
   * `{moduleName}/v{x.y.z}` or `{moduleName}/x.y.z`. Throws if any tag is invalid.
   * This method replaces any previously set tags.
   *
   * @param {ReadonlyArray<GitHubTag>} tags - Array of GitHubTag objects to associate with this module
   * @throws {Error} If any tag name does not match the required format
   * @returns {void}
   *
   * @example
   * ```typescript
   * const module = new TerraformModule('/path/to/module');
   * module.setTags([
   *   { name: 'my-module/v1.0.0', commitSHA: 'abc123' },
   *   { name: 'my-module/v1.1.0', commitSHA: 'def456' },
   *   { name: 'my-module/v2.0.0', commitSHA: 'ghi789' }
   * ]);
   * // Tags will be automatically sorted by version (newest first)
   * ```
   */
  public setTags(tags: ReadonlyArray<GitHubTag>): void {
    // Extract versions once and validate during the process
    const tagVersionMap = new Map<GitHubTag, string>();

    // First pass: validate all tags and extract versions
    for (const tag of tags) {
      tagVersionMap.set(tag, this.extractVersionFromTag(tag.name));
    }

    // Sort using pre-extracted versions (create copy to avoid mutating input)
    this._tags = [...tags].sort((a, b) => {
      const aVersion = tagVersionMap.get(a);
      const bVersion = tagVersionMap.get(b);
      if (!aVersion || !bVersion) {
        throw new Error('Internal error: version not found in map');
      }
      return this.compareSemanticVersions(bVersion, aVersion); // Descending
    });
  }

  /**
   * Gets all Git tags relevant to this Terraform module.
   *
   * Returns a read-only array of GitHubTag objects that have been filtered and sorted
   * for this specific module. Tags are sorted by semantic version in descending order.
   * Each tag contains the name and commit SHA.
   *
   * @returns {ReadonlyArray<GitHubTag>} A read-only array of GitHubTag objects for this module
   *
   * @example
   * ```typescript
   * const module = new TerraformModule('/path/to/module');
   * const tags = module.tags;
   * console.log('Latest tag:', tags[0]?.name); // Most recent version
   * console.log('Tag count:', tags.length);
   *
   * // Access tag details
   * tags.forEach(tag => {
   *   console.log(`Tag ${tag.name} -> ${tag.commitSHA}`);
   * });
   * ```
   */
  public get tags(): ReadonlyArray<GitHubTag> {
    return this._tags;
  }

  /**
   * Returns the latest full tag name for this module.
   *
   * @returns {string | null} The latest tag name (e.g., 'module-name/v1.2.3'), or null if no tags exist.
   */
  public getLatestTag(): string | null {
    if (this.tags.length === 0) {
      return null;
    }

    return this.tags[0].name;
  }

  /**
   * Returns the commit SHA for the latest tag.
   *
   * @returns {string | null} The commit SHA of the latest tag, or null if no tags exist.
   */
  public getLatestTagCommitSHA(): string | null {
    if (this.tags.length === 0) {
      return null;
    }

    return this.tags[0].commitSHA;
  }

  /**
   * Returns the version part of the latest tag for this module.
   *
   * Preserves any version prefixes (such as "v") that may be present or configured.
   *
   * @returns {string | null} The version string including any prefixes (e.g., 'v1.2.3' or '1.2.3'), or null if no tags exist.
   */
  public getLatestTagVersion(): string | null {
    const latestTag = this.getLatestTag();
    if (latestTag === null) {
      return null;
    }

    const match = MODULE_TAG_REGEX.exec(latestTag);

    return match ? match[3] : null;
  }

  /**
   * Returns the version part of the latest tag for this module, without any "v" prefix.
   *
   * @returns {string | null} The version string without any prefixes (e.g., '1.2.3'), or null if no tags exist.
   */
  public getLatestTagVersionNumber(): string | null {
    const version = this.getLatestTagVersion();
    if (!version) {
      return null;
    }
    return version.replace(/^v/, '');
  }

  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Releases
  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  /**
   * Sets the GitHub releases associated with this Terraform module.
   *
   * Accepts an array of GitHub release objects and automatically sorts them by semantic version
   * in descending order (newest first). Releases must have tagName following the format
   * `{moduleName}/v{x.y.z}` or `{moduleName}/x.y.z`. Throws if any release is invalid.
   * This method replaces any previously set releases.
   *
   * @param {ReadonlyArray<GitHubRelease>} releases - Array of GitHub release objects to associate with this module
   * @throws {Error} If any release tagName does not match the required format
   * @returns {void}
   *
   * @example
   * ```typescript
   * const module = new TerraformModule('/path/to/module');
   * module.setReleases([
   *   { id: 1, title: 'my-module/v1.0.0', body: 'Initial release', tagName: 'my-module/v1.0.0' },
   *   { id: 2, title: 'my-module/v1.1.0', body: 'Feature update', tagName: 'my-module/v1.1.0' }
   * ]);
   * // Releases will be automatically sorted by version (newest first)
   * ```
   */
  public setReleases(releases: ReadonlyArray<GitHubRelease>): void {
    // Extract versions once and validate during the process
    const releaseVersionMap = new Map<GitHubRelease, string>();

    // First pass: validate all releases and extract versions
    for (const release of releases) {
      releaseVersionMap.set(release, this.extractVersionFromTag(release.tagName));
    }

    // Second pass: Sort using pre-extracted versions (create copy to avoid mutating input)
    this._releases = [...releases].sort((a, b) => {
      const aVersion = releaseVersionMap.get(a);
      const bVersion = releaseVersionMap.get(b);
      if (!aVersion || !bVersion) {
        throw new Error('Internal error: version not found in map');
      }
      return this.compareSemanticVersions(bVersion, aVersion); // Descending
    });
  }

  /**
   * Gets all GitHub releases relevant to this Terraform module.
   *
   * Returns a read-only array of GitHub release objects that have been filtered and sorted
   * for this specific module. Releases are sorted by semantic version in descending order.
   * Each release contains the ID, title, body content, and associated tag name.
   *
   * @returns {ReadonlyArray<GitHubRelease>} A read-only array of GitHub release objects for this module
   *
   * @example
   * ```typescript
   * const module = new TerraformModule('/path/to/module');
   * const releases = module.releases;
   * console.log('Latest release:', releases[0]?.title); // Most recent version
   * console.log('Release count:', releases.length);
   *
   * // Access release details
   * releases.forEach(release => {
   *   console.log(`Release ${release.title}: ${release.body}`);
   * });
   * ```
   */
  public get releases(): ReadonlyArray<GitHubRelease> {
    return this._releases;
  }

  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Release Management
  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  /**
   * Determines if this module represents an initial release with no existing version tags.
   *
   * @returns {boolean} True if this is the first release for the module, false otherwise.
   */
  private isInitialRelease(): boolean {
    return this.tags.length === 0;
  }

  /**
   * Checks if the module has direct file changes based on commit history.
   *
   * @returns {boolean} True if the module has commits with direct file changes, false otherwise.
   */
  private hasDirectChanges(): boolean {
    return this.commitMessages.length > 0;
  }

  /**
   * Evaluates whether the module needs any type of release based on changes, dependencies, or initial state.
   *
   * @returns {boolean} True if the module requires a release for any reason, false otherwise.
   */
  public needsRelease(): boolean {
    return this.isInitialRelease() || this.hasDirectChanges();
  }

  /**
   * Computes the appropriate semantic version release type based on commit analysis and module state.
   * Analyzes commit messages against configured keywords to determine if changes warrant major, minor, or patch releases.
   *
   * @returns {ReleaseType | null} The computed release type (major, minor, or patch), or null if no release is needed.
   */
  public getReleaseType(): ReleaseType | null {
    // If we have commits, analyze them for release type
    if (this.hasDirectChanges()) {
      const { majorKeywords, minorKeywords, patchKeywords, defaultSemverLevel } = config;
      let computedReleaseType: ReleaseType | null = null;

      // Analyze each commit message and determine highest release type
      for (const message of this.commitMessages) {
        const messageCleaned = message.toLowerCase().trim();

        // Determine release type from current message
        let currentReleaseType: ReleaseType | null = null;
        if (majorKeywords.some((keyword) => messageCleaned.includes(keyword.toLowerCase()))) {
          currentReleaseType = RELEASE_TYPE.MAJOR;
        } else if (minorKeywords.some((keyword) => messageCleaned.includes(keyword.toLowerCase()))) {
          currentReleaseType = RELEASE_TYPE.MINOR;
        } else if (patchKeywords.some((keyword) => messageCleaned.includes(keyword.toLowerCase()))) {
          currentReleaseType = RELEASE_TYPE.PATCH;
        }

        // Only update computedReleaseType if a keyword was matched in this commit
        if (currentReleaseType !== null) {
          // Determine the next release type considering the previous release type
          if (currentReleaseType === RELEASE_TYPE.MAJOR || computedReleaseType === RELEASE_TYPE.MAJOR) {
            computedReleaseType = RELEASE_TYPE.MAJOR;
          } else if (currentReleaseType === RELEASE_TYPE.MINOR || computedReleaseType === RELEASE_TYPE.MINOR) {
            computedReleaseType = RELEASE_TYPE.MINOR;
          } else if (computedReleaseType === null) {
            // First keyword match, set it
            computedReleaseType = currentReleaseType;
          }
        }
      }

      // If no keywords matched in any commit, use the default semver level
      if (computedReleaseType === null) {
        return defaultSemverLevel;
      }

      return computedReleaseType;
    }

    // If this is initial release, return the default semver level
    if (this.isInitialRelease()) {
      return config.defaultSemverLevel;
    }

    // Otherwise, return null
    return null;
  }

  /**
   * Identifies all release reasons that apply to this module based on its current state.
   * A module can have multiple reasons for requiring a release, such as both direct changes and dependency updates.
   *
   * @returns {ReleaseReason[]} An array of release reasons, or an empty array if no release is needed.
   */
  public getReleaseReasons(): ReleaseReason[] {
    if (!this.needsRelease()) {
      return [];
    }

    const reasons: ReleaseReason[] = [];

    if (this.isInitialRelease()) {
      reasons.push(RELEASE_REASON.INITIAL);
    }
    if (this.hasDirectChanges()) {
      reasons.push(RELEASE_REASON.DIRECT_CHANGES);
    }
    return reasons;
  }

  /**
   * Computes the next release tag version for this module based on its current state.
   *
   * Analyzes the latest tag and determines the next version number according to the
   * computed release type (major, minor, or patch). Returns null if no release is needed.
   *
   * @returns {string | null} The next release tag version (e.g., 'v1.2.3' or '1.2.3'), or null if no release is needed.
   *
   * @example
   * ```typescript
   * const module = new TerraformModule('/path/to/module');
   * const version = module.getReleaseTagVersion(); // Returns 'v1.2.4' if release needed
   * ```
   */
  public getReleaseTagVersion(): string | null {
    const releaseType = this.getReleaseType();
    if (releaseType === null) {
      return null;
    }

    const latestTagVersion = this.getLatestTagVersion();
    if (latestTagVersion === null) {
      return config.defaultFirstTag;
    }

    // Note: At this point, we'll always have a valid format either 'v1.2.3' or '1.2.3' based on how we validate
    // via the setTags() and setReleases(). But we'll check anyways for robustness.

    const versionMatch = VERSION_TAG_REGEX.exec(latestTagVersion);
    if (!versionMatch) {
      // We should not reach here due to our validation, so throw an error instead of returning default tag
      throw new Error(`Invalid version format: '${latestTagVersion}'. Expected v#.#.# or #.#.# format.`);
    }

    const [, major, minor, patch] = versionMatch;
    const semver = [Number(major), Number(minor), Number(patch)];

    if (releaseType === RELEASE_TYPE.MAJOR) {
      semver[0]++;
      semver[1] = 0;
      semver[2] = 0;
    } else if (releaseType === RELEASE_TYPE.MINOR) {
      semver[1]++;
      semver[2] = 0;
    } else {
      semver[2]++;
    }

    return `${config.useVersionPrefix ? 'v' : ''}${semver.join('.')}`;
  }

  /**
   * Returns the full release tag that would be created for this module based on its current state.
   *
   * Combines the module name with the computed release version to form a complete tag
   * in the format '{moduleName}/v{x.y.z}'. Returns null if no release is needed.
   *
   * @returns {string | null} The full release tag string (e.g., 'module-name/v1.2.3'), or null if no release is needed.
   *
   * @example
   * ```typescript
   * const module = new TerraformModule('/path/to/module');
   * const tag = module.getReleaseTag(); // Returns 'my-module/v1.2.4' if release needed
   * ```
   */
  public getReleaseTag(): string | null {
    const releaseTagVersion = this.getReleaseTagVersion();
    if (releaseTagVersion === null) {
      return null;
    }

    return `${this.name}${config.tagDirectorySeparator}${releaseTagVersion}`;
  }

  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Helper
  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  /**
   * Extracts and validates the version string from a Terraform module tag.
   *
   * Uses the MODULE_TAG_REGEX to validate the tag format and extract version components.
   * This method leverages the static validation logic to ensure consistent tag processing
   * across different separator formats (/, -, _, .).
   *
   * @param {string} tag - The tag string to extract version from (e.g., "module/v1.2.3", "module-v1.2.3")
   * @returns {string} The numerical version string without prefix (e.g., "1.2.3")
   * @throws {Error} If the tag does not match the required format or is not associated with this module
   */
  private extractVersionFromTag(tag: string): string {
    // Use the static validation method to ensure the tag is associated with this module
    if (!TerraformModule.isModuleAssociatedWithTag(this.name, tag)) {
      throw new Error(
        `Invalid tag format: '${tag}'. Expected format: '${this.name}[separator]v#.#.#' or '${this.name}[separator]#.#.#'.`,
      );
    }

    // Parse the tag using MODULE_TAG_REGEX to extract version components
    // This will never be null since TerraformModule.isModuleAssociatedWithTag already validates the regex match
    const match = MODULE_TAG_REGEX.exec(tag) as RegExpExecArray;

    // Extract the numerical version components (groups 4, 5, 6 are major.minor.patch)
    const major = match[4];
    const minor = match[5];
    const patch = match[6];

    return `${major}.${minor}.${patch}`;
  }

  /**
   * Compares two semantic version strings safely.
   *
   * @param {string} versionA - First version string in format "#.#.#" (e.g., "1.2.3")
   * @param {string} versionB - Second version string in format "#.#.#" (e.g., "1.2.4")
   * @returns {number} Negative if A < B, positive if A > B, zero if equal
   *
   * @note Both parameters are guaranteed to be in numerical format "#.#.#" without any prefix,
   *       as they are processed through extractVersionFromTag which strips any 'v' prefix.
   */
  private compareSemanticVersions(versionA: string, versionB: string): number {
    const parseVersion = (version: string): number[] => {
      const parts = version.split('.');
      return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
    };

    const [majorA, minorA, patchA] = parseVersion(versionA);
    const [majorB, minorB, patchB] = parseVersion(versionB);

    if (majorA !== majorB) return majorA - majorB;
    if (minorA !== minorB) return minorA - minorB;
    return patchA - patchB;
  }

  /**
   * Returns a formatted string representation of the module for debugging and logging.
   *
   * The output includes the module name, directory path, recent commits (if any),
   * and release information when a release is needed. Commits are displayed with
   * their short SHA and first line of the commit message.
   *
   * @returns {string} A multi-line formatted string containing:
   *   - Module name with package emoji
   *   - Directory path
   *   - List of tags (if present)
   *   - List of releases with ID, title and tag (if present)
   *   - List of commits with short SHA and message (if present)
   *   - Release type, next tag, and version (if release needed)
   *   - Dependency triggers (if applicable)
   *
   * @example
   * ```
   * 📦 [my-package]
   *    Directory: /path/to/package
   *    Tags:
   *      - my-package/v1.0.0
   *    Releases:
   *      - [123] my-package/v1.0.0 -> tag: `my-package/v1.0.0`
   *    Commits:
   *      - [abc1234] feat: add new feature
   *      - [def5678] fix: resolve bug
   *    Release type: minor
   *    Next tag: v1.2.0
   *    Next version: 1.2.0
   * ```
   */
  public toString(): string {
    const lines = [`📦 [${this.name}]`, `   Directory: ${this.directory}`];

    if (this.tags.length > 0) {
      lines.push('   Tags:');
      for (const tag of this.tags) {
        lines.push(`     - ${tag.name}`);
      }
    }

    if (this.releases.length > 0) {
      lines.push('   Releases:');
      for (const release of this.releases) {
        lines.push(`     - [#${release.id}] ${release.title}  (tag: ${release.tagName})`);
      }
    }

    if (this.commits.length > 0) {
      lines.push('   Commits:');
      for (const commit of this.commits) {
        const shortSha = commit.sha.slice(0, 7);
        const firstLine = commit.message.split('\n')[0];
        lines.push(`     - [${shortSha}] ${firstLine}`);
      }
    }

    // Add release-specific info if relevant
    if (this.needsRelease()) {
      lines.push(`   Release Type: ${this.getReleaseType()}`);
      lines.push(`   Release Reasons: ${this.getReleaseReasons().join(', ')}`);
      lines.push(`   Release Tag: ${this.getReleaseTag()}`);
    }

    return lines.join('\n');
  }

  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Static Utilities
  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  /**
   * Generates a valid Terraform module name from the given relative directory path.
   *
   * The function transforms the directory path by:
   * - Trimming whitespace
   * - Converting to lowercase (for consistency)
   * - Normalizing path separators (both backslashes and forward slashes) to the configured tag directory separator
   * - Replacing invalid characters with hyphens (preserving only alphanumeric, "/", ".", "-", "_")
   * - Normalizing consecutive special characters ("/", ".", "-", "_") to single instances
   * - Removing leading/trailing special characters ("/", ".", "-", "_") using safe string operations
   *
   * @param {string} terraformDirectory - The relative directory path from which to generate the module name.
   * @returns {string} A valid Terraform module name based on the provided directory path.
   */
  public static getTerraformModuleNameFromRelativePath(terraformDirectory: string): string {
    let name = terraformDirectory
      .trim()
      .toLowerCase()
      .replace(/[/\\]/g, config.tagDirectorySeparator) // Normalize backslashes and forward slashes to configured separator
      .replace(/[^a-zA-Z0-9/._-]+/g, '-') // Replace invalid characters with hyphens (preserve alphanumeric, /, ., _, -)
      .replace(/[/._-]{2,}/g, (match) => match[0]); // Normalize consecutive special characters to single instances

    // Remove leading/trailing special characters safely without regex backtracking
    name = removeLeadingCharacters(name, VALID_TAG_DIRECTORY_SEPARATORS);
    name = removeTrailingCharacters(name, VALID_TAG_DIRECTORY_SEPARATORS);

    return name;
  }

  /**
   * Static utility to check if a tag is associated with a given module name.
   * Supports multiple directory separators and handles cases where tagging schemes
   * may have changed over time (e.g., from 'module-name/v1.0.0' to 'module-name-v1.1.0').
   *
   * @param {string} moduleName - The Terraform module name (assumed to be cleaned)
   * @param {string} tag - The tag to check
   * @returns {boolean} True if the tag belongs to the module and has valid version format
   */
  public static isModuleAssociatedWithTag(moduleName: string, tag: string): boolean {
    // Use the existing MODULE_TAG_REGEX to parse the tag and extract module name + version
    const match = MODULE_TAG_REGEX.exec(tag);
    if (!match) {
      // The tag doesn't match the expected "module-name/version" format
      return false;
    }

    // Extract the module name part from the tag (group 1)
    const moduleNameFromTag = match[1];

    // Define a consistent separator to normalize module names
    const NORMALIZE_SEPARATOR = '|';

    // Normalize both the input moduleName and the extracted module name from the tag.
    // This allows for comparison even if the tagging scheme changed over time
    // (e.g., from 'my/module/v1.0.0' to 'my-module-v1.1.0').
    const normalizeName = (name: string): string => {
      // Replace all valid tag directory separators with a consistent separator
      // This handles cases where different separators were used in different tags
      let normalized = name;
      for (const separator of VALID_TAG_DIRECTORY_SEPARATORS) {
        normalized = normalized.replaceAll(separator, NORMALIZE_SEPARATOR);
      }
      return normalized;
    };

    // Compare the normalized names to determine if they match
    return normalizeName(moduleName) === normalizeName(moduleNameFromTag);
  }

  /**
   * Static utility to filter tags for a given module name.
   *
   * @param {string} moduleName - The Terraform module name to find current tags
   * @param {GitHubTag[]} allTags - An array of all available tags
   * @returns {GitHubTag[]} An array of all matching tags for the module
   */
  public static getTagsForModule(moduleName: string, allTags: GitHubTag[]): GitHubTag[] {
    return allTags.filter((tag) => TerraformModule.isModuleAssociatedWithTag(moduleName, tag.name));
  }

  /**
   * Static utility to filter releases for a given module name.
   *
   * @param {string} moduleName - The Terraform module name to find current releases
   * @param {GitHubRelease[]} allReleases - An array of all available GitHub releases
   * @returns {GitHubRelease[]} An array of all matching releases for the module
   */
  public static getReleasesForModule(moduleName: string, allReleases: GitHubRelease[]): GitHubRelease[] {
    return allReleases.filter((release) => TerraformModule.isModuleAssociatedWithTag(moduleName, release.tagName));
  }

  /**
   * Returns all modules that need a release from the provided list.
   *
   * @param {TerraformModule[]} modules - Array of TerraformModule instances
   * @returns {TerraformModule[]} Array of modules that need a release
   */
  public static getModulesNeedingRelease(modules: TerraformModule[]): TerraformModule[] {
    return modules.filter((module) => module.needsRelease());
  }

  /**
   * Determines an array of Terraform tags that need to be deleted.
   *
   * Identifies tags that belong to modules no longer present in the current
   * module list by checking if any current module is associated with each tag.
   * This approach leverages the robust tag association logic that handles
   * different separator schemes over time.
   *
   * @param {GitHubTag[]} allTags - A list of all tags associated with the modules.
   * @param {TerraformModule[]} terraformModules - An array of Terraform modules.
   * @returns {string[]} An array of tag names that need to be deleted.
   */
  public static getTagsToDelete(allTags: GitHubTag[], terraformModules: TerraformModule[]): string[] {
    startGroup('Finding all Terraform tags that should be deleted');

    // Filter tags that are not associated with any current module
    const tagsToRemove = allTags
      .filter((tag) => {
        // Check if ANY current module is associated with this tag
        // This handles cases where tagging schemes changed over time
        return !terraformModules.some((module) => TerraformModule.isModuleAssociatedWithTag(module.name, tag.name));
      })
      .map((tag) => tag.name)
      .sort((a, b) => a.localeCompare(b));

    info('Terraform tags to delete:');
    info(JSON.stringify(tagsToRemove, null, 2));

    endGroup();

    return tagsToRemove;
  }

  /**
   * Determines an array of Terraform releases that need to be deleted.
   *
   * Identifies releases that belong to modules no longer present in the current
   * module list by checking if any current module is associated with each release tag.
   * This approach leverages the robust tag association logic that handles
   * different separator schemes over time.
   *
   * @param {GitHubRelease[]} allReleases - A list of all releases associated with the modules.
   * @param {TerraformModule[]} terraformModules - An array of Terraform modules.
   * @returns {GitHubRelease[]} An array of releases that need to be deleted.
   *
   * @example
   * ```typescript
   * const releasesToDelete = TerraformModule.getReleasesToDelete(allReleases, currentModules);
   * ```
   */
  public static getReleasesToDelete(
    allReleases: GitHubRelease[],
    terraformModules: TerraformModule[],
  ): GitHubRelease[] {
    startGroup('Finding all Terraform releases that should be deleted');

    // Filter releases that are not associated with any current module
    const releasesToRemove = allReleases
      .filter((release) => {
        // Check if ANY current module is associated with this release tag
        // This handles cases where tagging schemes changed over time
        return !terraformModules.some((module) =>
          TerraformModule.isModuleAssociatedWithTag(module.name, release.tagName),
        );
      })
      .sort((a, b) => a.tagName.localeCompare(b.tagName));

    info('Terraform releases to delete:');
    info(
      JSON.stringify(
        releasesToRemove.map((release) => release.tagName),
        null,
        2,
      ),
    );

    endGroup();

    return releasesToRemove;
  }
}
