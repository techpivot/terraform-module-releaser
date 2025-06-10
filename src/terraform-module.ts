import { relative } from 'node:path';
import { config } from '@/config';
import { context } from '@/context';
import type { CommitDetails, GitHubRelease, ReleaseReason, ReleaseType } from '@/types';
import { RELEASE_REASON, RELEASE_TYPE, VERSION_TAG_REGEX } from '@/utils/constants';
import { removeTrailingCharacters } from '@/utils/string';
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
  private _tags: string[] = [];

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
   * Accepts an array of tag strings and automatically sorts them by semantic version
   * in descending order (newest first). Tags must follow the format `{moduleName}/v{x.y.z}` or `{moduleName}/x.y.z`.
   * This method replaces any previously set tags. Throws if any tag is invalid.
   *
   * @param {ReadonlyArray<string>} tags - Array of Git tag strings to associate with this module
   * @throws {Error} If any tag does not match the required format
   * @returns {void}
   *
   * @example
   * ```typescript
   * const module = new TerraformModule('/path/to/module');
   * module.setTags([
   *   'my-module/v1.0.0',
   *   'my-module/v1.1.0',
   *   'my-module/v2.0.0'
   * ]);
   * // Tags will be automatically sorted: v2.0.0, v1.1.0, v1.0.0
   * ```
   */
  public setTags(tags: ReadonlyArray<string>): void {
    // Extract versions once and validate during the process
    const tagVersionMap = new Map<string, string>();

    // First pass: validate all tags and extract versions
    for (const tag of tags) {
      tagVersionMap.set(tag, this.extractVersionFromTag(tag));
    }

    // Second pass: Sort using pre-extracted versions (create copy to avoid mutating input)
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
   * Returns a read-only array of tag strings that have been filtered and sorted
   * for this specific module. Tags are sorted by semantic version in descending order.
   *
   * @returns {ReadonlyArray<string>} A read-only array of Git tag strings for this module
   */
  public get tags(): ReadonlyArray<string> {
    return this._tags;
  }

  /**
   * Returns the latest full tag for this module.
   *
   * @returns {string | null} The latest tag string (e.g., 'module-name/v1.2.3'), or null if no tags exist.
   */
  public getLatestTag(): string | null {
    if (this.tags.length === 0) {
      return null;
    }

    return this.tags[0];
  }

  /**
   * Returns the version part of the latest tag for this module.
   *
   * Preserves any version prefixes (such as "v") that may be present or configured.
   *
   * @returns {string | null} The version string including any prefixes (e.g., 'v1.2.3' or '1.2.3'), or null if no tags exist.
   */
  public getLatestTagVersion(): string | null {
    if (this.tags.length === 0) {
      return null;
    }

    return this.tags[0].replace(`${this.name}/`, '');
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

    // Second pass: Sort using pre-extracted versions

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
      const { majorKeywords, minorKeywords } = config;
      let computedReleaseType: ReleaseType = RELEASE_TYPE.PATCH;

      // Analyze each commit message and determine highest release type
      for (const message of this.commitMessages) {
        const messageCleaned = message.toLowerCase().trim();

        // Determine release type from current message
        let currentReleaseType: ReleaseType = RELEASE_TYPE.PATCH;
        if (majorKeywords.some((keyword) => messageCleaned.includes(keyword.toLowerCase()))) {
          currentReleaseType = RELEASE_TYPE.MAJOR;
        } else if (minorKeywords.some((keyword) => messageCleaned.includes(keyword.toLowerCase()))) {
          currentReleaseType = RELEASE_TYPE.MINOR;
        }

        // Determine the next release type considering the previous release type
        if (currentReleaseType === RELEASE_TYPE.MAJOR || computedReleaseType === RELEASE_TYPE.MAJOR) {
          computedReleaseType = RELEASE_TYPE.MAJOR;
        } else if (currentReleaseType === RELEASE_TYPE.MINOR || computedReleaseType === RELEASE_TYPE.MINOR) {
          computedReleaseType = RELEASE_TYPE.MINOR;
        }
      }

      return computedReleaseType;
    }

    // If this is initial release, return patch
    if (this.isInitialRelease()) {
      return RELEASE_TYPE.PATCH;
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
    //if (this.hasLocalDependencyUpdates()) {
    //  reasons.push(RELEASE_REASON.DEPENDENCY_UPDATES);
    //}
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

    const versionMatch = latestTagVersion.match(VERSION_TAG_REGEX);
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

    // Hard coding "v" for now. Potentially fixing in the future.
    return `v${semver.join('.')}`;
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

    return `${this.name}/${releaseTagVersion}`;
  }

  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Helper
  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  /**
   * Safely extracts the numerical version string from a tag, avoiding regex vulnerabilities.
   * Handles tags in format: moduleName/vX.Y.Z or moduleName/X.Y.Z
   * Also validates that tag format matches expected pattern and returns only the numerical part.
   *
   * @param {string} tag - The tag string to extract version from
   * @returns {string} The numerical version string (e.g., "1.2.3")
   * @throws {Error} If the tag does not match the required format
   */
  private extractVersionFromTag(tag: string): string {
    // Validate tag format - must start with module name followed by slash
    if (!tag.startsWith(`${this.name}/`)) {
      throw new Error(
        `Invalid tag format: '${tag}'. Expected format: '${this.name}/v#.#.#' or '${this.name}/#.#.#' for module.`,
      );
    }

    // Extract everything after the last slash
    const versionPart = tag.substring(tag.lastIndexOf('/') + 1);

    // Validate that the version part matches the expected format
    if (!VERSION_TAG_REGEX.test(versionPart)) {
      throw new Error(
        `Invalid tag format: '${tag}'. Expected format: '${this.name}/v#.#.#' or '${this.name}/#.#.#' for module.`,
      );
    }

    // Return only the numerical part, stripping the 'v' prefix if present
    return versionPart.startsWith('v') ? versionPart.substring(1) : versionPart;
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
        lines.push(`     - ${tag}`);
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
   * - Replacing invalid characters with hyphens
   * - Normalizing slashes
   * - Removing leading/trailing slashes
   * - Handling consecutive dots and hyphens
   * - Removing any remaining whitespace
   * - Converting to lowercase (for consistency)
   * - Removing trailing dots, hyphens, and underscores
   *
   * @param {string} terraformDirectory - The relative directory path from which to generate the module name.
   * @returns {string} A valid Terraform module name based on the provided directory path.
   */
  public static getTerraformModuleNameFromRelativePath(terraformDirectory: string): string {
    const cleanedDirectory = terraformDirectory
      .trim()
      .replace(/[^a-zA-Z0-9/_-]+/g, '-')
      .replace(/\/{2,}/g, '/')
      .replace(/\/\.+/g, '/')
      .replace(/(^\/|\/$)/g, '')
      .replace(/\.\.+/g, '.')
      .replace(/--+/g, '-')
      .replace(/\s+/g, '')
      .toLowerCase();
    return removeTrailingCharacters(cleanedDirectory, ['.', '-', '_']);
  }

  /**
   * Static utility to check if a tag is associated with a given module name.
   * Supports both versioned tags ({moduleName}/v#.#.#) and non-versioned tags ({moduleName}/#.#.#).
   *
   * @param {string} moduleName - The Terraform module name
   * @param {string} tag - The tag to check
   * @returns {boolean} True if the tag belongs to the module and has valid version format
   */
  public static isModuleAssociatedWithTag(moduleName: string, tag: string): boolean {
    // Check if tag starts with exactly the module name followed by a slash
    if (!tag.startsWith(`${moduleName}/`)) {
      return false;
    }

    // Extract the version part after the module name and slash
    const versionPart = tag.substring(moduleName.length + 1);

    // Check if version part matches either v#.#.# or #.#.# format
    return VERSION_TAG_REGEX.test(versionPart);
  }

  /**
   * Static utility to filter tags for a given module name.
   *
   * @param {string} moduleName - The Terraform module name to find current tags
   * @param {string[]} allTags - An array of all available tags
   * @returns {string[]} An array of all matching tags for the module
   */
  public static getTagsForModule(moduleName: string, allTags: string[]): string[] {
    return allTags.filter((tag) => TerraformModule.isModuleAssociatedWithTag(moduleName, tag));
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
   * module list by filtering tags that match the pattern {moduleName}/vX.Y.Z
   * where the module name is not in the current modules.
   *
   * @param {string[]} allTags - A list of all tags associated with the modules.
   * @param {TerraformModule[]} terraformModules - An array of Terraform modules.
   * @returns {string[]} An array of tag names that need to be deleted.
   */
  public static getTagsToDelete(allTags: string[], terraformModules: TerraformModule[]): string[] {
    startGroup('Finding all Terraform tags that should be deleted');

    // Get module names from current terraformModules (these exist in source)
    const moduleNamesFromModules = new Set(terraformModules.map((module) => module.name));

    // Filter tags that belong to modules no longer in the current module list
    const tagsToRemove = allTags
      .filter((tag) => {
        // Extract module name from tag by removing the version suffix
        // Handle both versioned tags (module-name/vX.Y.Z) and non-versioned tags
        const versionMatch = tag.match(/^(.+)\/v.+$/);
        const moduleName = versionMatch ? versionMatch[1] : tag;
        return !moduleNamesFromModules.has(moduleName);
      })
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
   * module list by filtering releases that match the pattern {moduleName}/vX.Y.Z
   * where the module name is not in the current modules.
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

    // Get module names from current terraformModules (these exist in source)
    const moduleNamesFromModules = new Set(terraformModules.map((module) => module.name));

    // Filter releases that belong to modules no longer in the current module list
    const releasesToRemove = allReleases
      .filter((release) => {
        // Extract module name from versioned release tag by removing the version suffix
        // Handle both versioned tags (module-name/vX.Y.Z) and non-versioned tags
        const versionMatch = release.tagName.match(/^(.+)\/v.+$/);
        const moduleName = versionMatch ? versionMatch[1] : release.tagName;
        return !moduleNamesFromModules.has(moduleName);
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
