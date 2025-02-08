import { execFileSync } from 'node:child_process';
import type { ExecFileSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { config } from '@/mocks/config';
import { context } from '@/mocks/context';
import { installTerraformDocs } from '@/terraform-docs';
import { getAllTerraformModules } from '@/terraform-module';
import type { ExecSyncError } from '@/types';
import { checkoutWiki, commitAndPushWikiChanges, generateWikiFiles, getWikiLink } from '@/wiki';
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
  const terraformModules = getAllTerraformModules(
    [
      {
        message: 'Update VPC endpoint',
        sha: 'sha00234',
        files: ['/vpc-endpoint/main.tf'],
      },
    ],
    ['vpc-endpoint/v1.0.0'],
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

    it('should handle unsetting config extraheader and throwing error accordingly', () => {
      const mockExecFileSync = vi.fn(
        (command: string, args?: readonly string[] | undefined, options?: ExecFileSyncOptions) => {
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
        (command: string, args?: readonly string[] | undefined, options?: ExecFileSyncOptions) => {
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
      vi.mocked(execFileSync).mockImplementation(originalExecFileSync);
      // Actually install terraform-docs as we're actually going to generate using terraform docs.
      installTerraformDocs(config.terraformDocsVersion);

      // We generate some console.log statements. Let's keep the tests cleaner
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterAll(() => {
      vi.mocked(execFileSync).mockImplementation(vi.fn());
    });

    it('should generate all required wiki files', async () => {
      vi.clearAllMocks();
      const files = await generateWikiFiles(terraformModules);

      // Get all expected file basenames from fixtures
      const fixturesDir = join(process.cwd(), '__tests__', 'fixtures');
      const expectedFiles = readdirSync(fixturesDir).map((file) => basename(file));
      expect(expectedFiles.length).equals(files.length);

      // Compare each generated file to its corresponding fixture
      for (const file of files) {
        const generatedContent = readFileSync(file, 'utf8');
        const expectedFilePath = join(fixturesDir, basename(file));
        const expectedContent = readFileSync(expectedFilePath, 'utf8');

        // Assert that the contents match
        expect(expectedContent).toEqual(generatedContent);
      }

      expect(startGroup).toHaveBeenCalledWith('Generating wiki ...');
      expect(endGroup).toHaveBeenCalled();

      const expectedCalls = [
        ['Removing existing wiki files...'],
        [`Removed contents of directory [${wikiDir}], preserving items: .git`],
        [`Using parallelism: ${cpus().length + 2}`],
        ['Generating tf-docs for: s3-bucket-object'],
        ['Generating tf-docs for: vpc-endpoint'],
        ['Finished tf-docs for: vpc-endpoint'],
        ['Generated: vpc‒endpoint.md'],
        ['Finished tf-docs for: s3-bucket-object'],
        ['Generated: s3‒bucket‒object.md'],
        ['Generated: Home.md'],
        ['Generated: _Sidebar.md'],
        ['Generated: _Footer.md'],
        ['Wiki files generated:'],
      ];
      for (const call of expectedCalls) {
        expect(info).toHaveBeenCalledWith(...call);
      }

      expect(vi.mocked(info).mock.calls).toHaveLength(expectedCalls.length);
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
  });

  describe('commitAndPushWikiChanges()', () => {
    it('should commit and push changes when changes are detected', () => {
      // Mock git status to indicate changes exist
      vi.mocked(execFileSync).mockImplementationOnce(() => Buffer.from('M  _Sidebar.md\n'));

      commitAndPushWikiChanges();

      // Verify git commands were called in correct order
      const gitCalls = vi.mocked(execFileSync).mock.calls.map((call) => call?.[1]?.join(' ') || '');

      expect(gitCalls).toEqual([
        'status --porcelain',
        'config --local user.name GitHub Actions',
        'config --local user.email 41898282+github-actions[bot]@users.noreply.github.com',
        'add .',
        'commit -m PR #123 - Test PR title\n\nTest PR body',
        'push origin',
      ]);

      expect(startGroup).toHaveBeenCalledWith('Committing and pushing changes to wiki');
      expect(info).toHaveBeenCalledWith('Checking for changes in wiki repository');
      expect(info).toHaveBeenCalledWith('git status output: M  _Sidebar.md');
      expect(info).toHaveBeenCalledWith('Changes committed and pushed to wiki repository');
      expect(endGroup).toHaveBeenCalled();
    });

    it('should skip commit and push when no changes are detected', () => {
      // Mock git status to indicate no changes
      vi.mocked(execFileSync).mockImplementationOnce(() => Buffer.from(''));

      commitAndPushWikiChanges();

      // Verify only status check was called
      const gitCalls = vi.mocked(execFileSync).mock.calls.map((call) => call?.[1]?.join(' ') || '');
      expect(gitCalls).toEqual(['status --porcelain']);

      expect(startGroup).toHaveBeenCalledWith('Committing and pushing changes to wiki');
      expect(info).toHaveBeenCalledWith('Checking for changes in wiki repository');
      expect(info).toHaveBeenCalledWith('git status output: ');
      expect(info).toHaveBeenCalledWith('No changes detected, skipping commit and push');
      expect(endGroup).toHaveBeenCalled();
    });

    it('should handle git command failures gracefully', () => {
      // Mock git status to indicate changes exist but make add command fail
      vi.mocked(execFileSync)
        .mockImplementationOnce(() => Buffer.from('M  _Sidebar.md\n'))
        .mockImplementationOnce(() => {
          throw new Error('Git command failed');
        });

      expect(() => commitAndPushWikiChanges()).toThrow('Git command failed');

      expect(startGroup).toHaveBeenCalledWith('Committing and pushing changes to wiki');
      expect(info).toHaveBeenCalledWith('Checking for changes in wiki repository');
      expect(info).toHaveBeenCalledWith('git status output: M  _Sidebar.md');
      expect(endGroup).toHaveBeenCalled();
    });

    it('should use complete PR information in commit message', () => {
      // Set up PR context with multiline body
      context.set({
        prBody: 'Line 1\nLine 2\nLine 3',
        prNumber: 456,
        prTitle: 'Complex PR title',
      });

      // Mock git status to indicate changes exist
      vi.mocked(execFileSync).mockImplementationOnce(() => Buffer.from('M  _Sidebar.md\n'));

      commitAndPushWikiChanges();

      // Verify commit message format
      const commitCall = vi.mocked(execFileSync).mock.calls.find((call) => call?.[1]?.includes('commit'));
      expect(commitCall?.[1]).toEqual(['commit', '-m', 'PR #456 - Complex PR title\n\nLine 1\nLine 2\nLine 3']);
    });
  });

  describe('formatModuleSource()', () => {
    beforeEach(() => {
      context.set({
        repo: { owner: 'techpivot', repo: 'terraform-module-releaser' },
        repoUrl: 'https://github.com/techpivot/terraform-module-releaser',
      });
    });

    it('should format source URL as HTTPS when useSSHSourceFormat is false', async () => {
      config.set({ useSSHSourceFormat: false });
      const files = await generateWikiFiles(terraformModules);

      // Read each generated .md file and verify it contains HTTPS format
      for (const file of files) {
        if (file.endsWith('.md')) {
          const content = readFileSync(file, 'utf8');
          if (content.includes('source =')) {
            expect(content).toContain('source = "git::https://github.com/techpivot/terraform-module-releaser.git?ref=');
            expect(content).not.toContain(
              'source = "git::ssh://git@github.com/techpivot/terraform-module-releaser.git?ref=',
            );
          }
        }
      }
    });

    it('should format source URL as SSH when useSSHSourceFormat is true', async () => {
      config.set({ useSSHSourceFormat: true });
      const files = await generateWikiFiles(terraformModules);

      // Read each generated .md file and verify it contains SSH format
      for (const file of files) {
        if (file.endsWith('.md')) {
          const content = readFileSync(file, 'utf8');
          if (content.includes('source =')) {
            expect(content).toContain(
              'source = "git::ssh://git@github.com/techpivot/terraform-module-releaser.git?ref=',
            );
            expect(content).not.toContain(
              'source = "git::https://github.com/techpivot/terraform-module-releaser.git?ref=',
            );
          }
        }
      }
    });
  });
});
