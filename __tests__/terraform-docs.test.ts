import { execFile, execFileSync } from 'node:child_process';
import type { PromiseWithChild } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { context } from '@/mocks/context';
import { ensureTerraformDocsConfigDoesNotExist, generateTerraformDocs, installTerraformDocs } from '@/terraform-docs';
import type { TerraformModule } from '@/terraform-module';
import { createMockTerraformModule } from '@/tests/helpers/terraform-module';
import { info } from '@actions/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import which from 'which';

const execFilePromisified = promisify(execFile);
const realPlatform = process.platform;
const realArch = process.arch;

// Mock node:fs functions
vi.mock('node:fs', async () => ({
  ...(await vi.importActual('node:fs')),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// Mock node:child_process functions
vi.mock('node:child_process', async () => ({
  ...(await vi.importActual('node:child_process')),
  execFileSync: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('which', () => ({
  default: {
    sync: vi.fn(),
  },
}));

// Mocking the promisify method to return execFile as is
vi.mock('node:util', () => ({
  promisify: vi.fn((fn) => fn), // Return the function itself without wrapping
}));

describe('terraform-docs', async () => {
  const terraformDocsVersion = 'v0.20.0';
  const mockExecFileSync = vi.mocked(execFileSync);
  const mockWhichSync = vi.mocked(which.sync);
  const fsExistsSyncMock = vi.mocked(existsSync);
  const mockFsUnlinkSync = vi.mocked(unlinkSync);
  const mockExecFilePromisified = vi.mocked(execFilePromisified);

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform });
    Object.defineProperty(process, 'arch', { value: realArch });
  });

  describe('install terraform-docs (linux, darwin, freebsd)', () => {
    const commands = {
      curl: '/usr/bin/curl',
      tar: '/usr/bin/tar',
      chmod: '/usr/bin/chmod',
      sudo: '/usr/bin/sudo',
    };
    const expectedExtension = '.tar.gz';
    const validCombinations = [
      // Darwin combinations
      { platform: 'darwin', arch: 'x64' },
      { platform: 'darwin', arch: 'arm64' },
      // Linux combinations
      { platform: 'linux', arch: 'x64' },
      { platform: 'linux', arch: 'arm' },
      { platform: 'linux', arch: 'arm64' },
      // FreeBSD combinations
      { platform: 'freebsd', arch: 'x64' },
      { platform: 'freebsd', arch: 'arm' },
      { platform: 'freebsd', arch: 'arm64' },
    ];

    beforeEach(() => {
      mockExecFileSync.mockReturnValue('mocked output');
      mockWhichSync.mockImplementation((command) => commands[command as keyof typeof commands]);
    });

    for (const { platform, arch } of validCombinations) {
      it(`should successfully install on ${platform}-${arch}`, () => {
        Object.defineProperty(process, 'platform', { value: platform });
        Object.defineProperty(process, 'arch', { value: arch });

        expect(() => installTerraformDocs(terraformDocsVersion)).not.toThrow();

        const expectedArch = arch === 'x64' ? 'amd64' : arch;
        const expectedPlatform = platform;
        const expectedCalls = [
          [
            commands.curl,
            [
              '-sSLfo',
              './terraform-docs.tar.gz',
              `https://terraform-docs.io/dl/${terraformDocsVersion}/terraform-docs-${terraformDocsVersion}-${expectedPlatform}-${expectedArch}${expectedExtension}`,
            ],
          ],
          [commands.tar, ['-xzf', './terraform-docs.tar.gz']],
          [commands.chmod, ['+x', 'terraform-docs']],
          [commands.sudo, ['mv', 'terraform-docs', '/usr/local/bin/terraform-docs']],
          ['/usr/local/bin/terraform-docs', ['--version'], { stdio: 'inherit' }],
        ];

        expect(mockExecFileSync.mock.calls).toEqual(expectedCalls);
      });
    }
  });

  describe('install terraform-docs (windows)', () => {
    const expectedExtension = '.zip';
    const expectedPlatform = 'windows';
    const systemDir = 'C:\\Windows\\System32';

    const commands = {
      powershell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    };
    const validCombinations = [
      { platform: 'win32', arch: 'x64' },
      { platform: 'win32', arch: 'arm64' },
    ];

    beforeEach(() => {
      mockWhichSync.mockImplementation((command) => commands[command as keyof typeof commands]);
      mockExecFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
        // Check for 'GetFolderPath('System')' in args and return systemDir if found
        if (cmd === commands.powershell && args?.some((arg) => arg.includes("GetFolderPath('System')"))) {
          return Buffer.from(systemDir);
        }
        return Buffer.from('');
      });
    });

    for (const { platform, arch } of validCombinations) {
      it(`should successfully install on ${platform}-${arch}`, () => {
        Object.defineProperty(process, 'platform', { value: platform });
        Object.defineProperty(process, 'arch', { value: arch });

        expect(() => installTerraformDocs(terraformDocsVersion)).not.toThrow();

        const expectedArch = arch === 'x64' ? 'amd64' : arch;
        const downloadUrl = `https://terraform-docs.io/dl/${terraformDocsVersion}/terraform-docs-${terraformDocsVersion}-${expectedPlatform}-${expectedArch}${expectedExtension}`;

        const expectedCalls = [
          [
            commands.powershell,
            ['-Command', `Invoke-WebRequest -Uri "${downloadUrl}" -OutFile "./terraform-docs.zip"`],
          ],
          [
            commands.powershell,
            ['-Command', 'Expand-Archive -Path "./terraform-docs.zip" -DestinationPath "./terraform-docs" -Force'],
          ],
          [
            commands.powershell,
            ['-Command', `Write-Output ([System.IO.Path]::GetFullPath([System.Environment]::GetFolderPath('System')))`],
          ],
          [
            commands.powershell,
            [
              '-Command',
              `Move-Item -Path "./terraform-docs/terraform-docs.exe" -Destination "${systemDir}\\terraform-docs.exe"`,
            ],
          ],
          [`${systemDir}\\terraform-docs.exe`, ['--version'], { stdio: 'inherit' }],
        ];

        expect(mockExecFileSync.mock.calls).toEqual(expectedCalls);
      });
    }
  });

  describe('which.sync', () => {
    it('should throw error when binary doesn not exist', async () => {
      const realWhich = (await vi.importActual('which')) as typeof import('which');

      mockWhichSync.mockImplementation(() => {
        // For now, let's change the implementation from the valid
        // "curl" and other valid files to something completely invalid and
        // actually simulate the error bubbled from which.
        return realWhich.sync('invalid-non-existent-binary');
      });

      expect(() => installTerraformDocs(terraformDocsVersion)).toThrow('not found: invalid-non-existent-binary');
    });

    afterAll(() => {
      mockWhichSync.mockRestore();
    });
  });

  describe('terraform-docs version validation', () => {
    it('should accept valid version format', () => {
      expect(() => installTerraformDocs('v0.19.0')).not.toThrow();
    });

    it.each([
      ['0.19.0', 'missing v prefix'],
      ['v0.19', 'incomplete version'],
      ['v0.19.0.0', 'too many segments'],
      ['vabc.19.0', 'invalid major version'],
      ['v0.abc.0', 'invalid minor version'],
      ['v0.19.abc', 'invalid patch version'],
      ['', 'empty string'],
      ['v', 'only prefix'],
      ['v.0.0', 'missing major version'],
      ['v0..0', 'missing minor version'],
      ['v0.0.', 'missing patch version'],
    ])('should throw error for invalid version format: %s (%s)', (version, _description) => {
      expect(() => installTerraformDocs(version)).toThrow(
        `Invalid terraform-docs version format: ${version}. Version must match the format v#.#.# (e.g., v0.19.0)`,
      );
    });
  });

  describe('real system installation', () => {
    const cleanupFiles = [
      'terraform-docs',
      'terraform-docs.tar.gz',
      'terraform-docs.zip',
      // It appears that removing the actual installed binary causes isssues with other async tests
      // resulting in errors. Thus, we leave the actual installed binaries on the system.
      // join('/usr/local/bin', 'terraform-docs'),
      // join('C:\\Windows\\System32', 'terraform-docs.exe'),
    ];

    beforeAll(async () => {
      // Get real implementations
      const realChildProcess = (await vi.importActual('node:child_process')) as typeof import('node:child_process');
      const realFs = (await vi.importActual('node:fs')) as typeof import('node:fs');
      const realWhich = (await vi.importActual('which')) as typeof import('which');

      // Replace mock implementations with real ones
      mockExecFileSync.mockImplementation(realChildProcess.execFileSync);
      fsExistsSyncMock.mockImplementation(realFs.existsSync);
      mockFsUnlinkSync.mockImplementation(realFs.unlinkSync);
      mockWhichSync.mockImplementation(realWhich.sync);
    });

    afterAll(() => {
      // Restore original mock implementations
      mockExecFileSync.mockRestore();
      fsExistsSyncMock.mockRestore();
      mockFsUnlinkSync.mockRestore();
      mockWhichSync.mockRestore();
    });

    afterEach(() => {
      // Cleanup downloaded/installed files
      for (const file of cleanupFiles) {
        try {
          unlinkSync(file);
        } catch (_err) {
          // Ignore cleanup errors
        }
      }
    });

    it(`should install terraform-docs on the real system ${process.arch}/${process.platform}`, () => {
      installTerraformDocs(terraformDocsVersion);

      // Verify installation by checking version output
      const output = execFileSync(
        process.platform === 'win32' ? 'terraform-docs.exe' : 'terraform-docs',
        ['--version'],
        { encoding: 'utf8' },
      );

      // Verify version output format based on platform
      const expectedFormat =
        process.platform === 'win32'
          ? /terraform-docs version v\d+\.\d+\.\d+ [a-f0-9]+ windows\/(amd64|arm64)/
          : /terraform-docs version v\d+\.\d+\.\d+ [a-f0-9]+ (linux|darwin|freebsd)\/(amd64|arm|arm64)/;

      expect(output).toMatch(expectedFormat);
    });

    it('should fail when terraform docs version is valid but non-existent', () => {
      const invalidVersion = 'v99.99.99';
      Object.defineProperty(process, 'platform', { value: 'linux' });
      Object.defineProperty(process, 'arch', { value: 'x64' });

      expect(() => installTerraformDocs(invalidVersion)).toThrow(
        'Command failed: /usr/bin/curl -sSLfo ./terraform-docs.tar.gz ' +
          'https://terraform-docs.io/dl/v99.99.99/terraform-docs-v99.99.99-linux-amd64.tar.gz\n' +
          'curl: (22) The requested URL returned error: 404',
      );
    });
  });

  describe('invalid platforms/architectures', () => {
    it.each(['aix', 'sunos', 'android'])('should throw error for unsupported platform: %s', (platform) => {
      Object.defineProperty(process, 'platform', { value: platform });
      Object.defineProperty(process, 'arch', { value: 'x64' });
      expect(() => installTerraformDocs(terraformDocsVersion)).toThrow(/Unsupported platform: /);
    });

    it.each(['s390', 'ia32', 'ppc', 'x32'])('should throw error for unsupported architecture: %s', (arch) => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      Object.defineProperty(process, 'arch', { value: arch });
      expect(() => installTerraformDocs(terraformDocsVersion)).toThrow(/Unsupported architecture: /);
    });

    it('should throw error for valid platform with invalid arch (darwin/arm)', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      Object.defineProperty(process, 'arch', { value: 'arm' });
      expect(() => installTerraformDocs(terraformDocsVersion)).toThrow(
        'Architecture arm is not supported for platform darwin. Supported architectures for darwin are: amd64, arm64',
      );
    });
  });

  describe('generate terraform docs for terraform module', () => {
    let mockModule: TerraformModule;

    beforeEach(() => {
      mockModule = createMockTerraformModule({ directory: 'test-module' });
      fsExistsSyncMock.mockReturnValue(false);
      mockExecFilePromisified.mockReturnValue(
        Promise.resolve({
          stdout: '# Test Module\nThis is test documentation.',
          stderr: null,
        }) as unknown as PromiseWithChild<{ stdout: string; stderr: string }>,
      );
    });

    it('should remove existing ".terraform-docs.yml" config if present', async () => {
      fsExistsSyncMock.mockReturnValue(true);

      const terraformDocsFile = join(context.workspaceDir, '.terraform-docs.yml');

      ensureTerraformDocsConfigDoesNotExist();
      expect(fsExistsSyncMock).toHaveBeenCalledWith(terraformDocsFile);
      expect(mockFsUnlinkSync).toHaveBeenCalledWith(terraformDocsFile);
      expect(vi.mocked(info).mock.calls).toEqual([
        ['Ensuring .terraform-docs.yml does not exist'],
        ['Found .terraform-docs.yml file, removing.'],
      ]);
    });

    it('should not remove ".terraform-docs.yml" config if not present', async () => {
      fsExistsSyncMock.mockReturnValue(false);

      const terraformDocsFile = join(context.workspaceDir, '.terraform-docs.yml');

      ensureTerraformDocsConfigDoesNotExist();
      expect(fsExistsSyncMock).toHaveBeenCalledWith(terraformDocsFile);
      expect(mockFsUnlinkSync).not.toHaveBeenCalledWith(terraformDocsFile);
      expect(vi.mocked(info).mock.calls).toEqual([
        ['Ensuring .terraform-docs.yml does not exist'],
        ['No .terraform-docs.yml found.'],
      ]);
    });

    it('should generate documentation successfully', async () => {
      mockWhichSync.mockImplementation(() => '/usr/local/bin/terraform-docs2');

      const result = await generateTerraformDocs(mockModule);

      expect(result).toBe('# Test Module\nThis is test documentation.');
      expect(mockExecFilePromisified).toHaveBeenCalledWith(
        '/usr/local/bin/terraform-docs2',
        ['markdown', 'table', '--sort-by', 'required', mockModule.directory],
        { encoding: 'utf-8' },
      );
    });

    it('should throw error when terraform-docs command returns stderr', async () => {
      mockExecFilePromisified.mockReturnValue(
        Promise.resolve({
          stdout: '# Test Module\nThis is test documentation.',
          stderr: 'Invalid terraform directory',
        }) as PromiseWithChild<{ stdout: string; stderr: string }>,
      );

      await expect(generateTerraformDocs(mockModule)).rejects.toThrow(
        `Terraform-docs generation failed for module: ${mockModule.name}\nInvalid terraform directory`,
      );
    });

    it('should handle command execution errors', async () => {
      const execError = new Error('Core execSync execution failed');

      mockExecFilePromisified.mockImplementation(
        () =>
          Promise.reject({
            stdout: '',
            stderr: '',
            child: { pid: 1234, kill: () => true },
            message: execError.message,
          }) as PromiseWithChild<{ stdout: string; stderr: string }>,
      );
      await expect(generateTerraformDocs(mockModule)).rejects.toThrow(execError.message);
    });

    it('should call core.info with appropriate messages', async () => {
      await generateTerraformDocs(mockModule);

      expect(info).toHaveBeenCalledWith(`Generating tf-docs for: ${mockModule.name}`);
      expect(info).toHaveBeenCalledWith(`Finished tf-docs for: ${mockModule.name}`);
    });
  });
});
