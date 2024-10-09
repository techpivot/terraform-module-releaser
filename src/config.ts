import { getInput } from '@actions/core';
import { context } from '@actions/github';

/**
 * Configuration interface used for defining key properties related to a GitHub Action that processes Terraform modules.
 * This interface captures settings such as keywords for semantic versioning, GitHub-specific tokens and events,
 * and directory paths. It also provides helper fields for working with pull request (PR) data.
 */
interface ConfigInterface {
  /**
   * List of keywords to identify major changes (e.g., breaking changes).
   * These keywords are used to trigger a major version bump in semantic versioning.
   */
  majorKeywords: string[];

  /**
   * List of keywords to identify minor changes.
   * These keywords are used to trigger a minor version bump in semantic versioning.
   */
  minorKeywords: string[];

  /**
   * List of keywords to identify patch changes (e.g., bug fixes).
   * These keywords are used to trigger a patch version bump in semantic versioning.
   */
  patchKeywords: string[];

  /**
   * Default first tag for initializing repositories without existing tags.
   * This serves as the fallback tag when no tags are found in the repository.
   */
  defaultFirstTag: string;

  /**
   * The version of terraform-docs to be used for generating documentation for Terraform modules.
   */
  terraformDocsVersion: string;

  /**
   * GitHub token used to authenticate API requests. Can either be the default GitHub Actions token
   * or a personal access token (PAT) with the appropriate scopes.
   */
  githubToken: string;

  /**
   * Flag to indicate whether the default GitHub Actions token is being used. This token has limited permissions,
   * and some actions (e.g., PR reads and writes) may require additional permissions.
   */
  isDefaultGithubActionsToken: boolean;

  /**
   * The pull request (PR) number associated with the current GitHub Action. Used to fetch and interact with PR data.
   */
  prNumber: number;

  /**
   * The title of the pull request. This field is extracted for convenience since it is commonly referenced.
   */
  prTitle: string;

  /**
   * The message/description of the pull request. Similar to `prTitle`, this field is used in multiple locations.
   */
  prBody: string;

  /**
   * Flag to indicate if the current event is a pull request merge event.
   */
  isPrMergeEvent: boolean;

  /**
   * The root directory of the GitHub Action's workspace. This directory contains the repository files being processed.
   */
  workspaceDir: string;

  /**
   * The GitHub server URL associated with this repository
   */
  repoUrl: string;

  /**
   * Whether to disable wiki generation for Terraform modules.
   * By default, this is set to false. Set to true to prevent wiki documentation from being generated.
   */
  disableWiki: boolean;

  /**
   * An integer that specifies how many changelog entries are displayed in the sidebar per module.
   */
  wikiSidebarChangelogMax: number;

  /**
   * Whether to delete legacy tags (tags that do not follow the semantic versioning format or from
   * modules that have been since removed) from the repository.
   */
  deleteLegacyTags: boolean;
}

class Config {
  private _majorKeywords!: string[];
  private _minorKeywords!: string[];
  private _patchKeywords!: string[];
  private _defaultFirstTag!: string;
  private _terraformDocsVersion!: string;
  private _githubToken!: string;
  private _isDefaultGithubActionsToken!: boolean;
  private _prNumber!: number;
  private _prTitle!: string;
  private _prBody!: string;
  private _isPrMergeEvent!: boolean;
  private _workspaceDir!: string;
  private _repoUrl!: string;
  private _disableWiki!: boolean;
  private _wikiSidebarChangelogMax!: number;
  private _deleteLegacyTags!: boolean;

  constructor() {
    this.init();
  }

  private init() {
    // Function to split keywords
    const getKeywords = (inputName: string): string[] => {
      return getInput(inputName, { required: true }).split(',');
    };

    this._majorKeywords = getKeywords('major-keywords');
    this._minorKeywords = getKeywords('minor-keywords');
    this._patchKeywords = getKeywords('patch-keywords');

    let githubToken = getInput('github_token', { required: true });

    // Determine if it's the default GitHub Actions token and remove "default" suffix
    this._isDefaultGithubActionsToken = githubToken.endsWith('default');
    if (this._isDefaultGithubActionsToken) {
      githubToken = githubToken.slice(0, -7); // Remove the "default" suffix
    }

    this._githubToken = githubToken;
    this._defaultFirstTag = getInput('default-first-tag', { required: true });
    this._terraformDocsVersion = getInput('terraform-docs-version', { required: true });

    const workspaceDir = process.env.GITHUB_WORKSPACE;
    if (!workspaceDir) {
      throw new Error('GITHUB_WORKSPACE is not defined');
    }
    this._workspaceDir = workspaceDir;

    const prNumber = context.payload.pull_request?.number;
    if (prNumber === undefined) {
      throw new Error(
        'Pull Request Number is not defined. Ensure this workflow is being run in the context of a pull request',
      );
    }
    this._prNumber = prNumber;

    this._prTitle = context.payload.pull_request?.title.trim() || '';
    this._prBody = context.payload.pull_request?.body || '';

    this._isPrMergeEvent =
      (context.eventName === 'pull_request' &&
        context.payload.action === 'closed' &&
        context.payload.pull_request?.merged) ||
      false;

    this._repoUrl = this.getGithubRepoUrl();
    this._disableWiki = getInput('disable-wiki', { required: true }).toLowerCase() === 'true';
    this._wikiSidebarChangelogMax = Number.parseInt(getInput('wiki-sidebar-changelog-max', { required: true }), 10);
    this._deleteLegacyTags = getInput('delete-legacy-tags', { required: true }).toLowerCase() === 'true';
  }

  private getGithubRepoUrl() {
    const { owner, repo } = context.repo; // Get the repository owner and name
    const serverUrl = context.serverUrl; // Get the server URL
    return `${serverUrl}/${owner}/${repo}`; // Construct the full repo URL
  }

  get majorKeywords(): string[] {
    return this._majorKeywords;
  }

  get minorKeywords(): string[] {
    return this._minorKeywords;
  }

  get patchKeywords(): string[] {
    return this._patchKeywords;
  }

  get defaultFirstTag(): string {
    return this._defaultFirstTag;
  }

  get terraformDocsVersion(): string {
    return this._terraformDocsVersion;
  }

  get githubToken(): string {
    return this._githubToken;
  }

  get isDefaultGithubActionsToken(): boolean {
    return this._isDefaultGithubActionsToken;
  }

  get prNumber(): number {
    return this._prNumber;
  }

  get prTitle(): string {
    return this._prTitle;
  }

  get prBody(): string {
    return this._prBody;
  }

  get isPrMergeEvent(): boolean {
    return this._isPrMergeEvent;
  }

  get workspaceDir(): string {
    return this._workspaceDir;
  }

  get repoUrl(): string {
    return this._repoUrl;
  }

  get disableWiki(): boolean {
    return this._disableWiki;
  }

  get wikiSidebarChangelogMax(): number {
    return this._wikiSidebarChangelogMax;
  }

  get deleteLegacyTags(): boolean {
    return this._deleteLegacyTags;
  }
}

const config = new Config();

export { config };
