import { execFile, execFileSync } from 'node:child_process';
import type { PromiseWithChild } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { context } from '@/mocks/context';
import { generateTerraformDocs, installTerraformDocs } from '@/terraform-docs';
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
  mkdtempSync: vi.fn(),
  rmSync: vi.fn(),
}));

// Mock node:fs/promises
vi.mock('node:fs/promises', async () => ({
  ...(await vi.importActual('node:fs/promises')),
  mkdtemp: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
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
  const terraformDocsVersion = 'v0.21.0';
  const mockExecFileSync = vi.mocked(execFileSync);
  const mockWhichSync = vi.mocked(which.sync);
  const fsExistsSyncMock = vi.mocked(existsSync);
  const mockFsUnlinkSync = vi.mocked(unlinkSync);
  const mockFsMkdtempSync = vi.mocked(mkdtempSync);
  const mockFsRmSync = vi.mocked(rmSync);
  const mockMkdtemp = vi.mocked(mkdtemp);
  const mockReadFile = vi.mocked(readFile);
  const mockWriteFile = vi.mocked(writeFile);
  const mockRm = vi.mocked(rm);
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
      mockFsMkdtempSync.mockReturnValue('/tmp');
      mockFsRmSync.mockReturnValue(undefined);
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
      mockFsMkdtempSync.mockReturnValue('/tmp');
      mockFsRmSync.mockReturnValue(undefined);
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
    beforeEach(() => {
      mockFsMkdtempSync.mockReturnValue('/tmp');
      mockFsRmSync.mockReturnValue(undefined);
    });

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
    beforeEach(() => {
      mockExecFileSync.mockReturnValue('mocked output');
      mockWhichSync.mockReturnValue('/usr/bin/mock');
      mockFsMkdtempSync.mockReturnValue('/tmp');
      mockFsRmSync.mockReturnValue(undefined);
    });

    it('should accept valid version format', () => {
      expect(() => installTerraformDocs('v0.21.0')).not.toThrow();
    });

    it.each([
      ['0.21.0', 'missing v prefix'],
      ['v0.21', 'incomplete version'],
      ['v0.21.0.0', 'too many segments'],
      ['vabc.19.0', 'invalid major version'],
      ['v0.abc.0', 'invalid minor version'],
      ['v0.21.abc', 'invalid patch version'],
      ['', 'empty string'],
      ['v', 'only prefix'],
      ['v.0.0', 'missing major version'],
      ['v0..0', 'missing minor version'],
      ['v0.0.', 'missing patch version'],
    ])('should throw error for invalid version format: %s (%s)', (version, _description) => {
      expect(() => installTerraformDocs(version)).toThrow(
        `Invalid terraform-docs version format: ${version}. Version must match the format v#.#.# (e.g., v0.21.0)`,
      );
    });
  });

  describe('real system installation', () => {
    const cleanupFiles = [
      'terraform-docs',
      'terraform-docs.tar.gz',
      'terraform-docs.zip',
      // It appears that removing the actual installed binary causes issues with other async tests
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
      mockFsMkdtempSync.mockImplementation(realFs.mkdtempSync);
      mockFsRmSync.mockImplementation(realFs.rmSync);
      mockWhichSync.mockImplementation(realWhich.sync);
    });

    afterAll(() => {
      // Restore original mock implementations
      mockExecFileSync.mockRestore();
      fsExistsSyncMock.mockRestore();
      mockFsUnlinkSync.mockRestore();
      mockFsMkdtempSync.mockRestore();
      mockFsRmSync.mockRestore();
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

  describe('generateTerraformDocs', () => {
    let mockModule: TerraformModule;
    const tmpDir = '/tmp/tfdocs-abc123';

    beforeEach(() => {
      context.set({ workspaceDir: '/workspace' });
      mockModule = createMockTerraformModule({ directory: '/workspace/modules/vpc' });
      fsExistsSyncMock.mockReturnValue(false);
      mockMkdtemp.mockResolvedValue(tmpDir);
      mockWriteFile.mockResolvedValue();
      mockRm.mockResolvedValue();
      mockWhichSync.mockReturnValue('/usr/local/bin/terraform-docs');
      mockExecFilePromisified.mockReturnValue(
        Promise.resolve({
          stdout: '# Test Module\nThis is test documentation.',
          stderr: null,
        }) as unknown as PromiseWithChild<{ stdout: string; stderr: string }>,
      );
    });

    it('should generate documentation successfully', async () => {
      const result = await generateTerraformDocs(mockModule);

      expect(result).toBe('# Test Module\nThis is test documentation.');
      expect(mockExecFilePromisified).toHaveBeenCalledWith(
        '/usr/local/bin/terraform-docs',
        ['-c', join(tmpDir, '.terraform-docs.yml'), mockModule.directory],
        { encoding: 'utf-8' },
      );
    });

    it('should write merged config with required overrides', async () => {
      await generateTerraformDocs(mockModule);

      expect(mockWriteFile).toHaveBeenCalledWith(
        join(tmpDir, '.terraform-docs.yml'),
        expect.stringContaining('formatter: markdown table'),
        'utf-8',
      );

      const writtenConfig = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenConfig).toContain('formatter: markdown table');
      expect(writtenConfig).toContain("file: ''");
    });

    it('should merge user config with required overrides', async () => {
      const userYaml = [
        'formatter: markdown document',
        'sections:',
        '  hide:',
        '    - providers',
        'settings:',
        '  anchor: false',
        '  hide-empty: true',
      ].join('\n');

      fsExistsSyncMock.mockImplementation((path) => path === join('/workspace/modules/vpc', '.terraform-docs.yml'));
      mockReadFile.mockResolvedValue(userYaml);

      await generateTerraformDocs(mockModule);

      const writtenConfig = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenConfig).toContain('formatter: markdown table');
      expect(writtenConfig).toContain("file: ''");
      expect(writtenConfig).toContain('providers');
      expect(writtenConfig).toContain('anchor: false');
      expect(writtenConfig).toContain('hide-empty: true');
    });

    it('should override user formatter setting', async () => {
      const userYaml = 'formatter: asciidoc table\n';
      fsExistsSyncMock.mockImplementation((path) => path === join('/workspace/modules/vpc', '.terraform-docs.yml'));
      mockReadFile.mockResolvedValue(userYaml);

      await generateTerraformDocs(mockModule);

      const writtenConfig = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenConfig).toContain('formatter: markdown table');
      expect(writtenConfig).not.toContain('asciidoc');
      expect(info).toHaveBeenCalledWith(expect.stringContaining('"formatter":"markdown table"'));
    });

    it('should override user output.file setting', async () => {
      const userYaml = 'formatter: markdown table\noutput:\n  file: README.md\n  mode: replace\n';
      fsExistsSyncMock.mockImplementation((path) => path === join('/workspace/modules/vpc', '.terraform-docs.yml'));
      mockReadFile.mockResolvedValue(userYaml);

      await generateTerraformDocs(mockModule);

      const writtenConfig = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenConfig).toContain("file: ''");
      expect(writtenConfig).not.toContain('README.md');
      expect(info).toHaveBeenCalledWith(expect.stringContaining('"file":""'));
    });

    it('should preserve user content template', async () => {
      const userYaml = [
        'formatter: markdown table',
        'content: |-',
        '  {{ .Header }}',
        '  {{ .Inputs }}',
        '  {{ .Outputs }}',
      ].join('\n');
      fsExistsSyncMock.mockImplementation((path) => path === join('/workspace/modules/vpc', '.terraform-docs.yml'));
      mockReadFile.mockResolvedValue(userYaml);

      await generateTerraformDocs(mockModule);

      const writtenConfig = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenConfig).toContain('{{ .Header }}');
      expect(writtenConfig).toContain('{{ .Inputs }}');
      expect(writtenConfig).toContain('{{ .Outputs }}');
    });

    it('should preserve user header-from and footer-from', async () => {
      const userYaml = 'formatter: markdown table\nheader-from: README.md\nfooter-from: FOOTER.md\n';
      fsExistsSyncMock.mockImplementation((path) => path === join('/workspace/modules/vpc', '.terraform-docs.yml'));
      mockReadFile.mockResolvedValue(userYaml);

      await generateTerraformDocs(mockModule);

      const writtenConfig = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenConfig).toContain('header-from: README.md');
      expect(writtenConfig).toContain('footer-from: FOOTER.md');
    });

    it('should preserve user output-values', async () => {
      const userYaml = 'formatter: markdown table\noutput-values:\n  enabled: true\n  from: output.json\n';
      fsExistsSyncMock.mockImplementation((path) => path === join('/workspace/modules/vpc', '.terraform-docs.yml'));
      mockReadFile.mockResolvedValue(userYaml);

      await generateTerraformDocs(mockModule);

      const writtenConfig = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenConfig).toContain('enabled: true');
      expect(writtenConfig).toContain('from: output.json');
    });

    it('should warn and use defaults on YAML parse failure', async () => {
      fsExistsSyncMock.mockImplementation((path) => path === join('/workspace/modules/vpc', '.terraform-docs.yml'));
      mockReadFile.mockResolvedValue('invalid: yaml: [[[');

      await generateTerraformDocs(mockModule);

      const writtenConfig = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenConfig).toContain('formatter: markdown table');
    });

    it('should warn with non-Error throw on YAML parse failure', async () => {
      fsExistsSyncMock.mockImplementation((path) => path === join('/workspace/modules/vpc', '.terraform-docs.yml'));
      mockReadFile.mockRejectedValue('string error');

      await generateTerraformDocs(mockModule);

      expect(info).toHaveBeenCalledWith(expect.stringContaining('WARNING: Failed to parse'));
      expect(info).toHaveBeenCalledWith(expect.stringContaining('string error'));
    });

    it('should log effective config as JSON', async () => {
      await generateTerraformDocs(mockModule);

      expect(info).toHaveBeenCalledWith(expect.stringContaining('Effective config:'));
      expect(info).toHaveBeenCalledWith(expect.stringContaining('"formatter":"markdown table"'));
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

    it('should clean up temp directory even on error', async () => {
      mockExecFilePromisified.mockReturnValue(
        Promise.reject(new Error('failed')) as PromiseWithChild<{ stdout: string; stderr: string }>,
      );

      await expect(generateTerraformDocs(mockModule)).rejects.toThrow('failed');

      expect(mockRm).toHaveBeenCalledWith(tmpDir, { recursive: true, force: true });
    });

    it('should log messages with module name prefix', async () => {
      await generateTerraformDocs(mockModule);

      expect(info).toHaveBeenCalledWith(expect.stringContaining(`[${mockModule.name}] Generating tf-docs...`));
      expect(info).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`\\[${mockModule.name}\\] Finished tf-docs \\(\\d+\\.\\d+s\\)`)),
      );
    });
  });
});
