/**
 * Regular expression that matches version tags in the format of semantic versioning.
 * This regex validates version strings like "1.2.3" or "v1.2.3" and includes capture groups.
 * Group 1: Major version number
 * Group 2: Minor version number
 * Group 3: Patch version number
 *
 * It allows either a numerical portion (e.g., "1.2.3") or one prefixed with 'v' (e.g., "v1.2.3"),
 * which is the proper semver default format.
 */
export const VERSION_TAG_REGEX = /^v?(\d+)\.(\d+)\.(\d+)$/;

/**
 * Release type constants for semantic versioning
 */
export const RELEASE_TYPE = {
  MAJOR: 'major',
  MINOR: 'minor',
  PATCH: 'patch',
} as const;

/**
 * Release reason constants - why a module needs a release
 */
export const RELEASE_REASON = {
  INITIAL: 'initial',
  DIRECT_CHANGES: 'direct-changes',
  LOCAL_DEPENDENCY_UPDATE: 'local-dependency-update',
} as const;

/**
 * Wiki status constants - status of wiki operations
 */
export const WIKI_STATUS = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  DISABLED: 'DISABLED',
} as const;
export const WIKI_HOME_FILENAME = 'Home.md';
export const WIKI_SIDEBAR_FILENAME = '_Sidebar.md';
export const WIKI_FOOTER_FILENAME = '_Footer.md';

export const GITHUB_ACTIONS_BOT_USER_ID = 41898282;
export const GITHUB_ACTIONS_BOT_NAME = 'GitHub Actions';
export const GITHUB_ACTIONS_BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';

export const PR_SUMMARY_MARKER = '<!-- techpivot/terraform-module-releaser — pr-summary-marker -->';
export const PR_RELEASE_MARKER = '<!-- techpivot/terraform-module-releaser — release-marker -->';

export const PROJECT_URL = 'https://github.com/techpivot/terraform-module-releaser';

export const BRANDING_COMMENT = `<h4 align="center"><sub align="middle">Powered by:&nbsp;&nbsp;<a href="${PROJECT_URL}"><img src="https://raw.githubusercontent.com/techpivot/terraform-module-releaser/refs/heads/main/assets/octicons-mark-github.svg" height="12" width="12" align="center" /></a> <a href="${PROJECT_URL}">techpivot/terraform-module-releaser</a></sub></h4>`;
export const BRANDING_WIKI = `<h3 align="center">Powered by:&nbsp;&nbsp;<a href="${PROJECT_URL}"><img src="https://raw.githubusercontent.com/techpivot/terraform-module-releaser/refs/heads/main/assets/octicons-mark-github.svg" height="14" width="14" align="center" /></a> <a href="${PROJECT_URL}">techpivot/terraform-module-releaser</a></h3>`;

/**
 * WIKI_TITLE_REPLACEMENTS - This object maps specific characters in wiki titles to visually
 * similar Unicode alternatives to handle GitHub Wiki limitations related to directory structure,
 * uniqueness, and consistent character visibility.
 *
 * ### GitHub Wiki Issues Addressed:
 *
 * - **Slash (`/`) Handling**:
 *   GitHub Wiki does not interpret forward slashes (`/`) as part of a directory structure in titles.
 *   When a title includes a slash, GitHub Wiki only recognizes the last segment (basename) for
 *   navigation, leading to potential conflicts if multiple pages share the same basename but
 *   reside in different contexts. By replacing `/` with a visually similar division slash (`∕`),
 *   this mapping helps preserve the intended path within the title, avoiding structure-related conflicts.
 *
 * - **Hyphen (`-`) Behavior**:
 *   If GitHub encounters a hyphen (`-`) in a title, it will automatically replace it with a figure dash (`‒`).
 *   Additionally, GitHub may move the file to the root directory, overriding any intended subdirectory placement.
 *   This behavior can lead to confusion and disorganization within the wiki. To maintain consistent naming
 *   conventions and avoid unintended movements of files, the hyphen is replaced with a figure dash in titles
 *   to ensure proper display and organization.
 *
 * ### Key-Value Pairs:
 * - Each **key** represents an original character in the title that may be problematic in GitHub Wiki.
 * - Each **value** is a Unicode replacement character chosen to visually resemble the original while
 *   avoiding structural or display conflicts.
 *
 * ### Current Mappings:
 * - `'/'` → `'∕'` (U+2215 Division Slash): Replaces forward slashes in titles to prevent directory
 *   conflicts.
 * - `'-'` → `'‒'` (U+2012 Figure Dash): Replaces hyphen with figure dash for better display and to avoid
 *   GitHub's auto-movement to the root directory.
 */
export const WIKI_TITLE_REPLACEMENTS: { [key: string]: string } = {
  '/': '∕', // Replace forward slash with a visually similar division slash (U+2215)
  '-': '‒', // Replace hyphen with figure dash (U+2012) for better display and to avoid GitHub's auto-movement
};
