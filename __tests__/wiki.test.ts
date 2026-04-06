import { execFileSync } from 'node:child_process';
import type { ExecFileSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { config } from '@/mocks/config';
import { context } from '@/mocks/context';
import { parseTerraformModules } from '@/parser';
import * as terraformDocs from '@/terraform-docs';
import type { ExecSyncError } from '@/types';
import { WIKI_STATUS } from '@/utils/constants';

import { checkoutWiki, commitAndPushWikiChanges, generateWikiFiles, getWikiLink, getWikiStatus } from '@/wiki';
import { endGroup, info, startGroup } from '@actions/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

describe('wiki', async () => {
  let tmpDir: string;
  let wikiDir: string;

  const originalNodeChildProcess = (await vi.importActual('node:child_process')) as typeof import('node:child_process');
  const originalExecFileSync = originalNodeChildProcess.execFileSync;

  // Grab the original set of modules by moving the workspaceDir to tf-modules
  context.workspaceDir = join(process.cwd(), '/tf-modules');

  // Configure to include all modules by setting modulePathIgnore to empty
  config.set({
    modulePathIgnore: [],
  });

  const terraformModules = parseTerraformModules(
    [
      {
        message: 'Update VPC endpoint',
        sha: 'sha00234',
        files: ['vpc-endpoint/main.tf'],
      },
    ],
    [{ name: 'vpc-endpoint/v1.0.0', commitSHA: 'sha00234' }],
    [
      {
        id: 123434,
        title: 'vpc-endpoint/v1.0.0',
        body: 'Sample Body\n## Heading\nSample Release',
        tagName: 'vpc-endpoint/v1.0.0',
      },
    ],
  );

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wiki-test-'));
    wikiDir = join(tmpDir, '.wiki');
    mkdirSync(wikiDir);

    context.set({
      repo: { owner: 'techpivot', repo: 'terraform-module-releaser' },
      repoUrl: 'https://github.com/techpivot/terraform-module-releaser',
      workspaceDir: tmpDir,
      prBody: 'Test PR body',
      prNumber: 123,
      issueNumber: 123,
      prTitle: 'Test PR title',
    });
    config.set({
      moduleRefMode: 'tag',
    });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true });
    }
  });

  describe('checkoutWiki()', () => {
    it('should properly initialize and configure wiki repository', () => {
      checkoutWiki();

      // Verify git commands were called in correct order
      const gitCalls = vi.mocked(execFileSync).mock.calls.map((call) => call?.[1]?.join(' ') || '');

      expect(gitCalls).toEqual([
        `config --global --add safe.directory ${wikiDir}`,
        `init --initial-branch=master ${wikiDir}`,
        'remote',
        'remote add origin https://github.com/techpivot/terraform-module-releaser.wiki',
        'config --local --unset-all http.https://github.com/.extraheader',
        expect.stringContaining('config --local http.https://github.com/.extraheader Authorization: Basic'),
        'fetch --no-tags --prune --no-recurse-submodules --depth=1 origin +refs/heads/master*:refs/remotes/origin/master* +refs/tags/master*:refs/tags/master*',
        'checkout master',
      ]);

      expect(startGroup).toHaveBeenCalledWith(
        'Checking out wiki repository [https://github.com/techpivot/terraform-module-releaser.wiki]',
      );
      expect(endGroup).toHaveBeenCalled();
    });

    it('should skip git init when repository already exists', () => {
      // Create .git directory to simulate existing repository
      const gitDir = join(wikiDir, '.git');
      mkdirSync(gitDir, { recursive: true });

      checkoutWiki();

      const gitCalls = vi.mocked(execFileSync).mock.calls.map((call) => call?.[1]?.join(' ') || '');

      // Verify git init was NOT called
      expect(gitCalls.some((call) => call.includes('init'))).toBe(false);

      // Verify "Initializing new repository" was NOT logged
      expect(info).not.toHaveBeenCalledWith('Initializing new repository');
    });

    it('should handle unsetting config extraheader and throwing error accordingly', () => {
      const mockExecFileSync = vi.fn(
        (_command: string, args?: readonly string[] | undefined, _options?: ExecFileSyncOptions) => {
          if (args?.includes('--unset-all') && args.includes('http.https://github.com/.extraheader')) {
            const error = new Error('git config error') as ExecSyncError;
            error.status = 10;
            throw error;
          }

          // Default return for other cases
          return Buffer.from('');
        },
      );
      vi.mocked(execFileSync).mockImplementation(mockExecFileSync);

      try {
        checkoutWiki();
      } catch (error) {
        // Check for ExecException properties
        expect(error).toEqual(
          expect.objectContaining({
            message: 'git config error',
            status: 10,
          }),
        );
      }
    });

    it('should handle unsetting config extraheader gracefully', () => {
      const mockExecFileSync = vi.fn(
        (_command: string, args?: readonly string[] | undefined, _options?: ExecFileSyncOptions) => {
          if (args?.includes('--unset-all') && args.includes('http.https://github.com/.extraheader')) {
            const error = new Error('git config error') as ExecSyncError;
            error.status = 5;
            throw error;
          }

          // Default return for other cases
          return Buffer.from('');
        },
      );
      vi.mocked(execFileSync).mockImplementation(mockExecFileSync);

      expect(() => checkoutWiki()).not.toThrow();
    });

    it('should handle wiki clone failures gracefully', () => {
      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw new Error('Repository not found');
      });

      expect(() => checkoutWiki()).toThrow('Repository not found');
    });

    it('should handle create wiki directory if it does not exist', () => {
      vi.resetAllMocks();
      rmSync(wikiDir, { recursive: true });
      checkoutWiki();
      expect(existsSync(wikiDir)).toBe(true);
    });

    it('should set origin url if origin exists', () => {
      checkoutWiki();
      expect(existsSync(wikiDir)).toBe(true);

      // Reset mocks and configure remote command to return "origin"
      vi.clearAllMocks();
      vi.mocked(execFileSync).mockImplementation((_cmd, args = []) => {
        if (args[0] === 'remote') {
          return Buffer.from('origin');
        }
        return Buffer.from('');
      });

      // Second call should update existing repo without error
      expect(() => checkoutWiki()).not.toThrow();
      // Verify the remote set-url command was called correctly
      const gitCalls = vi.mocked(execFileSync).mock.calls.map((call) => call?.[1]?.join(' ') || '');

      expect(gitCalls).toContain('remote set-url origin https://github.com/techpivot/terraform-module-releaser.wiki');
    });
  });

  describe('getWikiLink()', () => {
    it.each([
      [true, '/techpivot/terraform-module-releaser/wiki/test‒module'],
      [false, 'https://github.com/techpivot/terraform-module-releaser/wiki/test‒module'],
    ])('should generate correct %s link', (relative, expected) => {
      expect(getWikiLink('test-module', relative)).toBe(expected);
    });
  });

  describe('generateWikiFiles()', () => {
    beforeAll(() => {
      // We generate some console.log statements when installing terraform-docs. Let's keep the tests cleaner
      vi.spyOn(console, 'log').mockImplementation(() => {});

      vi.mocked(execFileSync).mockImplementation(originalExecFileSync);
      // Actually install terraform-docs as we're actually going to generate using terraform docs.
      terraformDocs.installTerraformDocs(config.terraformDocsVersion);
    });

    afterAll(() => {
      vi.mocked(execFileSync).mockImplementation(vi.fn());
      vi.resetAllMocks(); // Unclears the console.log
    });

    it('should generate all required wiki files', async () => {
      vi.clearAllMocks();
      const { updatedFiles: files } = await generateWikiFiles(terraformModules);

      // With modulePathIgnore: [], all modules in tf-modules directory should be processed
      // tf-modules directory contains: animal, kms, kms/examples/complete, s3-bucket-object, vpc-endpoint, zoo
      // So we expect: 6 module files + Home.md + _Sidebar.md + _Footer.md = 9 files
      expect(files.length).toBe(9);

      // Verify the specific files that should be generated
      const fileBasenames = files.map((f) => basename(f)).sort();
      expect(fileBasenames).toEqual([
        'Home.md',
        '_Footer.md',
        '_Sidebar.md',
        'animal.md',
        'kms.md',
        'kms∕examples∕complete.md',
        's3‒bucket‒object.md',
        'vpc‒endpoint.md',
        'zoo.md',
      ]);

      // Verify that the files actually exist and have content
      for (const file of files) {
        expect(existsSync(file)).toBe(true);
        const content = readFileSync(file, 'utf8');
        expect(content.length).toBeGreaterThan(0);
      }

      expect(startGroup).toHaveBeenCalledWith('Generating wiki files');
      expect(endGroup).toHaveBeenCalled();
    });

    it('should not generate branding for footer when disableBranding enabled', async () => {
      config.set({ disableBranding: true });
      await generateWikiFiles(terraformModules);
      expect(info).toHaveBeenCalledWith('Skipping footer generation as branding is disabled');
    });

    it('should generate proper wiki link [relative]', () => {
      expect(getWikiLink('aws/vpc', true)).toEqual('/techpivot/terraform-module-releaser/wiki/aws∕vpc');
    });

    it('should generate proper wiki link [absolute]', () => {
      expect(getWikiLink('aws/vpc', false)).toEqual(
        'https://github.com/techpivot/terraform-module-releaser/wiki/aws∕vpc',
      );
    });

    it('should use the default usage block when custom template is not provided', async () => {
      const { updatedFiles: files } = await generateWikiFiles(terraformModules);
      for (const file of files) {
        if (
          file.endsWith('.md') &&
          basename(file) !== 'Home.md' &&
          basename(file) !== '_Sidebar.md' &&
          basename(file) !== '_Footer.md'
        ) {
          const content = readFileSync(file, 'utf8');
          expect(content).toContain('To use this module in your Terraform, refer to the below module example:');
        }
      }
    });

    it('should use the custom usage template when provided', async () => {
      const customUsage = 'This is a custom usage template: {{module_name}}';
      config.set({ wikiUsageTemplate: customUsage });
      const terraformModule = terraformModules[0];
      const { updatedFiles: files } = await generateWikiFiles([terraformModule]);
      for (const file of files) {
        if (
          file.endsWith('.md') &&
          basename(file) !== 'Home.md' &&
          basename(file) !== '_Sidebar.md' &&
          basename(file) !== '_Footer.md'
        ) {
          const content = readFileSync(file, 'utf8');
          const moduleName = basename(file, '.md');
          expect(content).toContain(`# Usage\n\nThis is a custom usage template: ${moduleName}`);
        }
      }
    });

    it('should handle missing variables in the custom usage template', async () => {
      const customUsage = 'Module: {{module_name}}, Missing: {{missing_variable}}';
      config.set({ wikiUsageTemplate: customUsage });
      const terraformModule = terraformModules[0];
      const { updatedFiles: files } = await generateWikiFiles([terraformModule]);
      for (const file of files) {
        if (
          file.endsWith('.md') &&
          basename(file) !== 'Home.md' &&
          basename(file) !== '_Sidebar.md' &&
          basename(file) !== '_Footer.md'
        ) {
          const content = readFileSync(file, 'utf8');
          expect(content).toContain(`# Usage\n\nModule: ${terraformModule.name}, Missing: {{missing_variable}}`);
        }
      }
    });

    it('should handle all variables in the custom usage template', async () => {
      const customUsage =
        'Name: {{module_name}}, Tag: {{latest_tag}}, Version: {{latest_tag_version_number}}, Source: {{module_source}}, TFName: {{module_name_terraform}}';
      config.set({ useSSHSourceFormat: true, wikiUsageTemplate: customUsage });
      const { updatedFiles: files } = await generateWikiFiles(terraformModules);
      for (const file of files) {
        if (
          file.endsWith('.md') &&
          basename(file) !== 'Home.md' &&
          basename(file) !== '_Sidebar.md' &&
          basename(file) !== '_Footer.md'
        ) {
          const content = readFileSync(file, 'utf8');
          const moduleName = basename(file, '.md');
          // vpc-endpoint is the only one with a tag in the test setup
          if (moduleName === 'vpc‒endpoint') {
            expect(content).toContain(
              'Name: vpc-endpoint, Tag: vpc-endpoint/v1.0.0, Version: 1.0.0, Source: git::ssh://git@github.com/techpivot/terraform-module-releaser.git, TFName: vpc_endpoint',
            );
          }
        }
      }
    });

    it('should use SHA mode when moduleRefMode is set to "sha"', async () => {
      config.set({
        moduleRefMode: 'sha',
        modulePathIgnore: [],
      });

      const { updatedFiles: files } = await generateWikiFiles(terraformModules);

      // Find the vpc-endpoint module file (it has a tag)
      const vpcEndpointFile = files.find((f) => basename(f) === 'vpc‒endpoint.md');
      expect(vpcEndpointFile).toBeDefined();

      if (vpcEndpointFile) {
        const content = readFileSync(vpcEndpointFile, 'utf8');
        // In SHA mode, the ref should be the commit SHA
        expect(content).toContain('ref=sha00234');
        // And should include a comment with the version
        expect(content).toContain('# v1.0.0');
      }
    });

    it('should handle SHA mode when no commit SHA is available', async () => {
      config.set({
        moduleRefMode: 'sha',
        modulePathIgnore: [],
      });

      // Create a module with a tag but no commit SHA
      const moduleWithoutSHA = terraformModules.find((m) => m.name !== 'vpc-endpoint');
      if (moduleWithoutSHA) {
        const { updatedFiles: files } = await generateWikiFiles([moduleWithoutSHA]);

        // The file should still be generated
        expect(files.length).toBeGreaterThan(0);
        expect(info).toHaveBeenCalledWith(expect.stringContaining('Warning: No ref available'));
      }
    });

    it('should return moduleErrors for invalid module_ref_mode', async () => {
      // Force an invalid moduleRefMode by bypassing validation
      // @ts-expect-error - Testing invalid moduleRefMode value
      config.set({ moduleRefMode: 'invalid-mode' });

      const { moduleErrors } = await generateWikiFiles(terraformModules);
      expect(moduleErrors.size).toBeGreaterThan(0);
      for (const [, errorMessage] of moduleErrors) {
        expect(errorMessage).toContain('Invalid module_ref_mode: invalid-mode');
      }
    });

    it('should stringify non-Error module failures', async () => {
      const generateTerraformDocsSpy = vi
        .spyOn(terraformDocs, 'generateTerraformDocs')
        .mockRejectedValueOnce('string failure');

      try {
        const { moduleErrors } = await generateWikiFiles(terraformModules);
        expect(moduleErrors.size).toBeGreaterThan(0);
        expect(Array.from(moduleErrors.values())).toContain('string failure');
      } finally {
        generateTerraformDocsSpy.mockRestore();
      }
    });
  });

  describe('commitAndPushWikiChanges()', () => {
    beforeAll(() => {
      // Ensure we're using the mock octokit, not real one
      context.useMockOctokit();
    });

    it('should commit and push changes when changes are detected', async () => {
      // Mock git status to indicate changes exist
      vi.mocked(execFileSync).mockImplementationOnce(() => Buffer.from('M  _Sidebar.md\n'));

      await commitAndPushWikiChanges();

      // Verify git commands were called in correct order
      const gitCalls = vi.mocked(execFileSync).mock.calls.map((call) => call?.[1]?.join(' ') || '');

      expect(gitCalls).toEqual([
        'status --porcelain',
        'config --local user.name GitHub Actions',
        'config --local user.email 41898282+github-actions[bot]@users.noreply.github.com',
        'add .',
        'commit -m PR #123 - Test PR title', // Note that we don't include the PR body
        'push origin',
      ]);

      expect(startGroup).toHaveBeenCalledWith('Committing and pushing changes to wiki');
      expect(info).toHaveBeenCalledWith('Checking for changes in wiki repository');
      expect(info).toHaveBeenCalledWith('git status output: M  _Sidebar.md');
      expect(info).toHaveBeenCalledWith('Changes committed and pushed to wiki repository');
      expect(endGroup).toHaveBeenCalled();
    });

    it('should skip commit and push when no changes are detected', async () => {
      // Mock git status to indicate no changes
      vi.mocked(execFileSync).mockImplementationOnce(() => Buffer.from(''));

      await commitAndPushWikiChanges();

      // Verify only status check was called
      const gitCalls = vi.mocked(execFileSync).mock.calls.map((call) => call?.[1]?.join(' ') || '');
      expect(gitCalls).toEqual(['status --porcelain']);

      expect(startGroup).toHaveBeenCalledWith('Committing and pushing changes to wiki');
      expect(info).toHaveBeenCalledWith('Checking for changes in wiki repository');
      expect(info).toHaveBeenCalledWith('git status output: ');
      expect(info).toHaveBeenCalledWith('No changes detected, skipping commit and push');
      expect(endGroup).toHaveBeenCalled();
    });

    it('should handle git command failures gracefully', async () => {
      // Mock git status to indicate changes exist but make add command fail
      vi.mocked(execFileSync)
        .mockImplementationOnce(() => Buffer.from('M  _Sidebar.md\n'))
        .mockImplementationOnce(() => {
          throw new Error('Git command failed');
        });

      await expect(commitAndPushWikiChanges()).rejects.toThrow('Git command failed');

      expect(startGroup).toHaveBeenCalledWith('Committing and pushing changes to wiki');
      expect(info).toHaveBeenCalledWith('Checking for changes in wiki repository');
      expect(info).toHaveBeenCalledWith('git status output: M  _Sidebar.md');
      expect(endGroup).toHaveBeenCalled();
    });

    it('should not use complete PR information in commit message', async () => {
      // Set up PR context with multiline body
      context.set({
        prBody: 'Line 1\nLine 2\nLine 3',
        prNumber: 456,
        prTitle: 'Complex PR title\n\n',
      });

      // Mock git status to indicate changes exist
      vi.mocked(execFileSync).mockImplementationOnce(() => Buffer.from('M  _Sidebar.md\n'));

      await commitAndPushWikiChanges();

      // Verify commit message format
      const commitCall = vi.mocked(execFileSync).mock.calls.find((call) => call?.[1]?.includes('commit'));
      expect(commitCall?.[1]).toEqual(['commit', '-m', 'PR #456 - Complex PR title']);
    });
  });

  describe('getWikiStatus()', () => {
    beforeEach(() => {
      config.set({ disableWiki: false });
      vi.clearAllMocks();
    });

    it('should return DISABLED status when wiki is disabled', async () => {
      config.set({ disableWiki: true });

      const result = await getWikiStatus([]);

      expect(result).toEqual({ status: WIKI_STATUS.DISABLED });
      // Should not attempt to checkout wiki when disabled
      expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
    });

    it('should return SUCCESS status when checkout and generation succeed', async () => {
      // Allow real execFileSync for terraform-docs but keep git calls (checkoutWiki) as no-ops
      vi.mocked(execFileSync).mockImplementation((...args: unknown[]) => {
        const [command] = args as [string];
        if (typeof command === 'string' && basename(command) === 'git') {
          return Buffer.from('');
        }
        return originalExecFileSync(...(args as Parameters<typeof originalExecFileSync>));
      });

      const result = await getWikiStatus(terraformModules);

      expect(result.status).toBe(WIKI_STATUS.SUCCESS);
      expect(result.errorMessage).toBeUndefined();
    });

    it('should return FAILURE_TERRAFORM_DOCS status when generateWikiFiles has module errors', async () => {
      // Mock git commands as no-ops, allow real execFileSync for terraform-docs
      vi.mocked(execFileSync).mockImplementation((...args: unknown[]) => {
        const [command] = args as [string];
        if (typeof command === 'string' && basename(command) === 'git') {
          return Buffer.from('');
        }
        return originalExecFileSync(...(args as Parameters<typeof originalExecFileSync>));
      });

      // Force an invalid moduleRefMode to trigger terraform-docs errors
      // @ts-expect-error - Testing invalid moduleRefMode value
      config.set({ moduleRefMode: 'invalid-mode' });

      const result = await getWikiStatus(terraformModules);

      expect(result.status).toBe(WIKI_STATUS.FAILURE_TERRAFORM_DOCS_RUN);
      expect(result.errorMessage).toBeDefined();
      expect(result.terraformDocsErrors).toBeDefined();
      expect(result.terraformDocsErrors?.size).toBeGreaterThan(0);
    });

    it('should return singular terraform-docs failure message when exactly one module fails', async () => {
      // Mock git commands as no-ops, allow real execFileSync for terraform-docs
      vi.mocked(execFileSync).mockImplementation((...args: unknown[]) => {
        const [command] = args as [string];
        if (typeof command === 'string' && basename(command) === 'git') {
          return Buffer.from('');
        }
        return originalExecFileSync(...(args as Parameters<typeof originalExecFileSync>));
      });

      // Force an invalid moduleRefMode to trigger terraform-docs errors
      // @ts-expect-error - Testing invalid moduleRefMode value
      config.set({ moduleRefMode: 'invalid-mode' });

      const firstModule = terraformModules[0];
      if (!firstModule) {
        throw new Error('Expected at least one terraform module for this test');
      }

      const result = await getWikiStatus([firstModule]);

      expect(result.status).toBe(WIKI_STATUS.FAILURE_TERRAFORM_DOCS_RUN);
      expect(result.terraformDocsErrors?.size).toBe(1);
      expect(result.errorMessage).toContain('1 module');
    });

    it('should return FAILURE_TERRAFORM_DOCS_INSTALL status when terraform-docs installation fails', async () => {
      // Mock git commands as no-ops so checkout succeeds
      vi.mocked(execFileSync).mockImplementation((...args: unknown[]) => {
        const [command] = args as [string];
        if (typeof command === 'string' && basename(command) === 'git') {
          return Buffer.from('');
        }
        return originalExecFileSync(...(args as Parameters<typeof originalExecFileSync>));
      });

      const installSpy = vi.spyOn(terraformDocs, 'installTerraformDocs').mockImplementationOnce(() => {
        throw new Error('Failed to install terraform-docs: binary not found in PATH');
      });

      try {
        const result = await getWikiStatus(terraformModules);

        expect(result.status).toBe(WIKI_STATUS.FAILURE_TERRAFORM_DOCS_INSTALL);
        expect(result.errorMessage).toBe('Failed to install terraform-docs: binary not found in PATH');
        expect(result.terraformDocsErrors).toBeUndefined();
      } finally {
        installSpy.mockRestore();
      }
    });

    it('should handle non-Error terraform-docs install failures', async () => {
      // Mock git commands as no-ops so checkout succeeds
      vi.mocked(execFileSync).mockImplementation((...args: unknown[]) => {
        const [command] = args as [string];
        if (typeof command === 'string' && basename(command) === 'git') {
          return Buffer.from('');
        }
        return originalExecFileSync(...(args as Parameters<typeof originalExecFileSync>));
      });

      const installSpy = vi.spyOn(terraformDocs, 'installTerraformDocs').mockImplementationOnce(() => {
        throw 'terraform-docs install string error'; // eslint-disable-line no-throw-literal
      });

      try {
        const result = await getWikiStatus(terraformModules);

        expect(result.status).toBe(WIKI_STATUS.FAILURE_TERRAFORM_DOCS_INSTALL);
        expect(result.errorMessage).toBe('terraform-docs install string error');
        expect(result.terraformDocsErrors).toBeUndefined();
      } finally {
        installSpy.mockRestore();
      }
    });

    it('should return FAILURE_CHECKOUT status with error details when checkout fails', async () => {
      const mockError = new Error('Repository not found');

      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw mockError;
      });

      const result = await getWikiStatus([]);

      expect(result.status).toBe(WIKI_STATUS.FAILURE_CHECKOUT);
      expect(result.errorMessage).toBe('Repository not found');
      expect(vi.mocked(execFileSync)).toHaveBeenCalled();
    });

    it('should handle errors with complex messages', async () => {
      const mockError = new Error('Git clone failed\nAdditional details');

      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw mockError;
      });

      const result = await getWikiStatus([]);

      expect(result.status).toBe(WIKI_STATUS.FAILURE_CHECKOUT);
      expect(result.errorMessage).toBe('Git clone failed\nAdditional details');
    });
    it('should handle non-Error checkout failures', async () => {
      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw 'string error'; // eslint-disable-line no-throw-literal
      });

      const result = await getWikiStatus([]);

      expect(result.status).toBe(WIKI_STATUS.FAILURE_CHECKOUT);
      expect(result.errorMessage).toBe('string error');
    });
  });
});
