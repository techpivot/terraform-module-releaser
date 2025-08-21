/**
 * Development script to test the parseTerraformModules function locally
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '@/config';
import { getContext } from '@/context';
import { parseTerraformModules } from '@/parser';

async function main() {
  console.log('🔍 Development: Testing parseTerraformModules function');
  //console.log('Workspace directory:', context.workspaceDir);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  process.env.GITHUB_SERVER_URL = 'https://github.com';
  process.env.GITHUB_API_URL = 'https://api.github.com';
  process.env.GITHUB_EVENT_NAME = 'pull_request';
  process.env.GITHUB_EVENT_PATH = resolve(__dirname, 'event.pull-request.json'); // Path to a test event file
  process.env.GITHUB_WORKSPACE = resolve(__dirname, '..');
  process.env.GITHUB_REPOSITORY = 'techpivot/terraform-module-releaser';

  process.env['INPUT_MAJOR-KEYWORDS'] = 'major change,breaking change';
  process.env['INPUT_MINOR-KEYWORDS'] = 'feat,feature';
  process.env['INPUT_PATCH-KEYWORDS'] = 'fix,chore,docs';
  process.env['INPUT_DEFAULT-FIRST-TAG'] = 'v1.0.0';
  process.env['INPUT_TERRAFORM-DOCS-VERSION'] = 'v0.20.0';
  process.env['INPUT_DELETE-LEGACY-TAGS'] = 'false';
  process.env['INPUT_DISABLE-WIKI'] = 'true';
  process.env['INPUT_WIKI-SIDEBAR-CHANGELOG-MAX'] = '5';
  process.env['INPUT_WIKI-USAGE-TEMPLATE'] = 'Wiki usage template';
  process.env['INPUT_DISABLE-BRANDING'] = 'false';
  process.env.INPUT_GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  process.env['INPUT_USE-SSH-SOURCE-FORMAT'] = 'true';
  process.env['INPUT_TAG-DIRECTORY-SEPARATOR'] = '/';
  process.env['INPUT_USE-VERSION-PREFIX'] = 'true';
  process.env['INPUT_MODULE-PATH-IGNORE'] = '**/examples/**';
  process.env['INPUT_MODULE-CHANGE-EXCLUDE-PATTERNS'] = '.gitignore,*.md';

  // Initialize
  const _config = getConfig();
  const _context = getContext();

  // Test with empty tags and releases for now
  const _modules = parseTerraformModules(
    [
      {
        message: 'feat: add screenshots for documentation',
        sha: '7f614091a80fb05a10659f4a5b8df9fee4fdea58',
        files: [
          '.github/linters/.markdown-lint.yml',
          'README.md',
          'screenshots/module-contents-explicit-dir-only.jpg',
          'screenshots/pr-initial-module-release.jpg',
          'screenshots/pr-separate-modules-updating.jpg',
          'screenshots/release-details.jpg',
          'screenshots/wiki-changelog.jpg',
          'screenshots/wiki-module-example.jpg',
          'screenshots/wiki-sidebar.jpg',
          'screenshots/wiki-usage.jpg',
        ],
      },
      {
        message: 'docs: ensure GitHub wiki is enabled and initialized before action execution',
        sha: '8c2c39eb20e8fab10fd2fd1263d0e39cf371eebf',
        files: ['.github/workflows/ci.yml', 'README.md'],
      },
      {
        message: 'fix: add animal documentation',
        sha: '111111111111111111111111111111111111111',
        files: ['tf-modules/animal/README.md'],
      },
      {
        message: 'fix: vpc-endpoint bugfix',
        sha: '992c39eb20e8fab10fd2fd1263d0234234243422',
        files: [
          'tf-modules/vpc-endpoint/main.tf',
          'tf-modules/vpc-endpoint/outputs.tf',
          'tf-modules/vpc-endpoint/variables.tf',
          'tf-modules/zoo/variables.tf',
        ],
      },
    ],
    [
      'tf-modules/animal/v1.0.0',
      'tf-modules/animal/v1.3.0',
      'tf-modules/animal/v1.3.9',
      'tf-modules/animal/v1.3.5',
      'tf-modules/vpc-endpoint/v2.2.5',
      'tf-modules/vpc-endpoint/v2.2.4',
    ],
    [
      {
        id: 1,
        title: 'tf-modules/vpc-endpoint/v2.2.5',
        tagName: 'tf-modules/vpc-endpoint/v2.2.5',
        body: 'Release notes for v2.2.5',
      },
      {
        id: 2,
        title: 'tf-modules/vpc-endpoint/v2.2.4',
        tagName: 'tf-modules/vpc-endpoint/v2.2.4',
        body: 'Release notes for v2.2.4',
      },
      {
        id: 5,
        title: 'tf-modules/vpc-endpoint/v9.2.4',
        tagName: 'tf-modules/vpc-endpoint/v9.2.4',
        body: 'Release notes for v9.2.4',
      },
    ],
  );
}

main();
