import { describe, expect, it } from 'vitest';
import {
  BRANDING_COMMENT,
  BRANDING_WIKI,
  GITHUB_ACTIONS_BOT_EMAIL,
  GITHUB_ACTIONS_BOT_NAME,
  PROJECT_URL,
  PR_RELEASE_MARKER,
  PR_SUMMARY_MARKER,
  WIKI_TITLE_REPLACEMENTS,
} from '../src/constants';

describe('constants', () => {
  it('should have the correct GitHub Actions bot name', () => {
    expect(GITHUB_ACTIONS_BOT_NAME).toBe('GitHub Actions');
  });

  it('should have the correct GitHub Actions bot email', () => {
    expect(GITHUB_ACTIONS_BOT_EMAIL).toBe('41898282+github-actions[bot]@users.noreply.github.com');
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
    const expectedBrandingComment = `<h4 align="center"><sub align="middle">Powered by <img src="https://raw.githubusercontent.com/techpivot/terraform-module-releaser/refs/heads/main/assets/github-mark-top-padding.png" height="16" width="12" align="top" /> <a href="${PROJECT_URL}">techpivot/terraform-module-releaser</a></sub></h4>`;
    expect(BRANDING_COMMENT).toBe(expectedBrandingComment);
  });

  it('should have the correct branding wiki HTML', () => {
    const expectedBrandingWiki = `<h4 align="center">Powered by <img src="https://raw.githubusercontent.com/techpivot/terraform-module-releaser/refs/heads/main/assets/github-mark-12x14.png" height="14" width="12" align="top" /> <a href="${PROJECT_URL}">techpivot/terraform-module-releaser</a></h4>`;
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
