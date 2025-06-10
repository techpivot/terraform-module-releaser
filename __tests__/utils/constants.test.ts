import {
  BRANDING_COMMENT,
  BRANDING_WIKI,
  GITHUB_ACTIONS_BOT_NAME,
  GITHUB_ACTIONS_BOT_USERNAME,
  PROJECT_URL,
  PR_RELEASE_MARKER,
  PR_SUMMARY_MARKER,
  WIKI_TITLE_REPLACEMENTS,
} from '@/utils/constants';
import { describe, expect, it } from 'vitest';

describe('utils/constants', () => {
  it('should have the correct GitHub Actions bot name', () => {
    expect(GITHUB_ACTIONS_BOT_NAME).toBe('GitHub Actions');
  });

  it('should have the correct GitHub Actions bot username', () => {
    expect(GITHUB_ACTIONS_BOT_USERNAME).toBe('github-actions[bot]');
  });

  it('should have the correct PR summary marker', () => {
    expect(PR_SUMMARY_MARKER).toBe('<!-- techpivot/terraform-module-releaser — pr-summary-marker -->');
  });

  it('should have the correct PR release marker', () => {
    expect(PR_RELEASE_MARKER).toBe('<!-- techpivot/terraform-module-releaser — release-marker -->');
  });

  it('should have the correct project URL', () => {
    expect(PROJECT_URL).toBe('https://github.com/techpivot/terraform-module-releaser');
  });

  it('should have the correct branding comment HTML', () => {
    const expectedBrandingComment = `<h4 align="center"><sub align="middle">Powered by:&nbsp;&nbsp;<a href="${PROJECT_URL}"><img src="https://raw.githubusercontent.com/techpivot/terraform-module-releaser/refs/heads/main/assets/octicons-mark-github.svg" height="12" width="12" align="center" /></a> <a href="${PROJECT_URL}">techpivot/terraform-module-releaser</a></sub></h4>`;
    expect(BRANDING_COMMENT).toBe(expectedBrandingComment);
  });

  it('should have the correct branding wiki HTML', () => {
    const expectedBrandingWiki = `<h3 align="center">Powered by:&nbsp;&nbsp;<a href="${PROJECT_URL}"><img src="https://raw.githubusercontent.com/techpivot/terraform-module-releaser/refs/heads/main/assets/octicons-mark-github.svg" height="14" width="14" align="center" /></a> <a href="${PROJECT_URL}">techpivot/terraform-module-releaser</a></h3>`;
    expect(BRANDING_WIKI).toBe(expectedBrandingWiki);
  });

  describe('WIKI_TITLE_REPLACEMENTS', () => {
    it('should replace forward slash with division slash', () => {
      expect(WIKI_TITLE_REPLACEMENTS['/']).toBe('∕');
    });

    it('should replace hyphen with figure dash', () => {
      expect(WIKI_TITLE_REPLACEMENTS['-']).toBe('‒');
    });
  });
});
