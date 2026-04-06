import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { context } from '@/context';
import type { TerraformModule } from '@/terraform-module';
import { findModuleTerraformDocsConfig } from '@/utils/file';
import { bufferedInfo } from '@/utils/log-buffer';
import { endGroup, info, startGroup } from '@actions/core';
import yaml from 'js-yaml';
import which from 'which';

const execFilePromisified = promisify(execFile);

type GoPlatform = 'darwin' | 'linux' | 'freebsd' | 'windows';
type GoArch = 'amd64' | 'arm' | 'arm64';
type NodeArch = 'x64' | 'arm' | 'arm64';
type NodePlatform = 'darwin' | 'linux' | 'freebsd' | 'win32';

interface PlatformConfig {
  platform: GoPlatform;
  supportedArch: GoArch[];
  extension: string;
}

const platformConfigs: Record<NodePlatform, PlatformConfig> = {
  darwin: {
    platform: 'darwin',
    supportedArch: ['amd64', 'arm64'],
    extension: '.tar.gz',
  },
  linux: {
    platform: 'linux',
    supportedArch: ['amd64', 'arm', 'arm64'],
    extension: '.tar.gz',
  },
  freebsd: {
    platform: 'freebsd',
    supportedArch: ['amd64', 'arm', 'arm64'],
    extension: '.tar.gz',
  },
  win32: {
    platform: 'windows',
    supportedArch: ['amd64', 'arm64'],
    extension: '.zip',
  },
};

const nodeArchToGoArch: Record<NodeArch, GoArch> = {
  x64: 'amd64',
  arm: 'arm',
  arm64: 'arm64',
};

/**
 * Type guard for NodePlatform
 */
function isNodePlatform(platform: string): platform is NodePlatform {
  return Object.keys(platformConfigs).includes(platform);
}

/**
 * Type guard for NodeArch
 */
function isNodeArch(arch: string): arch is NodeArch {
  return Object.keys(nodeArchToGoArch).includes(arch);
}

/**
 * Converts Node platform to Go platform
 */
function getGoPlatform(nodePlatform: NodePlatform): GoPlatform {
  return platformConfigs[nodePlatform].platform;
}

/**
 * Validates and returns the platform configuration for terraform-docs
 *
 * @param nodePlatform - The Node.js platform
 * @param nodeArch - The Node.js architecture
 * @returns The validated platform configuration and Go architecture
 * @throws {Error} If the platform or architecture combination is not supported
 */
function getValidatedPlatformConfig(
  nodePlatform: string,
  nodeArch: string,
): {
  goPlatform: GoPlatform;
  goArch: GoArch;
  extension: string;
} {
  // Validate platform
  if (!isNodePlatform(nodePlatform)) {
    throw new Error(
      `Unsupported platform: ${nodePlatform}. Supported platforms are: ${Object.keys(platformConfigs).join(', ')}`,
    );
  }

  // Validate architecture
  if (!isNodeArch(nodeArch)) {
    throw new Error(
      `Unsupported architecture: ${nodeArch}. Supported architectures are: ${Object.keys(nodeArchToGoArch).join(', ')}`,
    );
  }

  const platformConfig = platformConfigs[nodePlatform];
  const goPlatform = getGoPlatform(nodePlatform);
  const goArch = nodeArchToGoArch[nodeArch];

  // Validate platform-architecture combination
  if (!platformConfig.supportedArch.includes(goArch)) {
    throw new Error(
      `Architecture ${goArch} is not supported for platform ${goPlatform}. ` +
        `Supported architectures for ${goPlatform} are: ${platformConfig.supportedArch.join(', ')}`,
    );
  }

  return {
    goPlatform,
    goArch,
    extension: platformConfig.extension,
  };
}

/**
 * Validates that the terraform-docs version string matches the expected format (v#.#.#)
 * @param version - Version string to validate
 * @throws {Error} If the version string is invalid
 */
function validateTerraformDocsVersion(version: string): void {
  const versionPattern = /^v\d+\.\d+\.\d+$/;
  if (!versionPattern.test(version)) {
    throw new Error(
      `Invalid terraform-docs version format: ${version}. Version must match the format v#.#.# (e.g., v0.21.0)`,
    );
  }
}

/**
 * Installs the specified version of terraform-docs.
 *
 * @param {string} terraformDocsVersion - The version of terraform-docs to install.
 * @throws {Error} If the platform or architecture combination is not supported
 */
export function installTerraformDocs(terraformDocsVersion: string): void {
  console.time('Elapsed time installing terraform-docs');
  startGroup(`Installing terraform-docs ${terraformDocsVersion}`);

  const cwd = process.cwd();
  let tmpDir = null;

  try {
    validateTerraformDocsVersion(terraformDocsVersion);

    const { goPlatform, goArch, extension } = getValidatedPlatformConfig(process.platform, process.arch);
    const downloadFilename = `terraform-docs-${terraformDocsVersion}-${goPlatform}-${goArch}${extension}`;
    const downloadUrl = `https://terraform-docs.io/dl/${terraformDocsVersion}/${downloadFilename}`;

    // Create a temp directory to handle the extraction so this doesn't clobber our
    // current working directory.
    tmpDir = mkdtempSync(join(tmpdir(), 'terraform-docs-'));
    process.chdir(tmpDir);

    if (goPlatform === 'windows') {
      const powershellPath = which.sync('powershell');

      info('Downloading terraform-docs...');
      execFileSync(powershellPath, [
        '-Command',
        `Invoke-WebRequest -Uri "${downloadUrl}" -OutFile "./terraform-docs.zip"`,
      ]);
      info('Unzipping terraform-docs...');
      execFileSync(powershellPath, [
        '-Command',
        `Expand-Archive -Path "./terraform-docs.zip" -DestinationPath "./terraform-docs" -Force`,
      ]);
      info('Getting Windows system dir...');
      const systemDir = execFileSync(powershellPath, [
        '-Command',
        `Write-Output ([System.IO.Path]::GetFullPath([System.Environment]::GetFolderPath('System')))`,
      ])
        .toString()
        .trim();

      info(`Copying executable to system dir (${systemDir})...`);
      execFileSync(powershellPath, [
        '-Command',
        `Move-Item -Path "./terraform-docs/terraform-docs.exe" -Destination "${systemDir}\\terraform-docs.exe"`,
      ]);

      // terraform-docs version v0.21.0 af31cc6 windows/amd64
      execFileSync(`${systemDir}\\terraform-docs.exe`, ['--version'], { stdio: 'inherit' });
    } else {
      const commands = ['curl', 'tar', 'chmod', 'sudo'];
      const paths: Record<string, string> = {};

      for (const command of commands) {
        paths[command] = which.sync(command);
        info(`Found ${command} at: ${paths[command]}`);
      }

      execFileSync(paths.curl, ['-sSLfo', './terraform-docs.tar.gz', downloadUrl]);
      execFileSync(paths.tar, ['-xzf', './terraform-docs.tar.gz']);
      execFileSync(paths.chmod, ['+x', 'terraform-docs']);
      execFileSync(paths.sudo, ['mv', 'terraform-docs', '/usr/local/bin/terraform-docs']);

      // terraform-docs version v0.21.0 af31cc6 linux/amd64
      execFileSync('/usr/local/bin/terraform-docs', ['--version'], { stdio: 'inherit' });
    }
  } finally {
    if (tmpDir !== null) {
      info(`Removing temp dir ${tmpDir}`);
      rmSync(tmpDir, { recursive: true });
    }
    process.chdir(cwd);
    console.timeEnd('Elapsed time installing terraform-docs');
    endGroup();
  }
}

/**
 * Generates Terraform documentation for a given module.
 *
 * Discovers any module-level `.terraform-docs.yml`, merges user settings with our required
 * overrides (`formatter`, `output`), writes a temp config, runs terraform-docs,
 * and cleans up automatically. Fully async and safe for parallel invocation.
 *
 * Uses `bufferedInfo()` for logging — when called inside `withBufferedLogs()`,
 * output is buffered and flushed as a contiguous block per module.
 *
 * @param {TerraformModule} terraformModule - The module to generate docs for.
 * @returns {Promise<string>} The generated Terraform documentation in Markdown format.
 * @throws {Error} If `terraform-docs` fails or produces stderr output.
 */
export async function generateTerraformDocs({ name, directory }: TerraformModule): Promise<string> {
  const startTime = performance.now();
  const prefix = `[${name}] `;
  const log = (msg: string) => bufferedInfo(`${prefix}${msg}`);

  log('Generating tf-docs...');

  // Discover and parse user config
  const userConfigPath = findModuleTerraformDocsConfig(directory, context.workspaceDir);
  let userConfig: Record<string, unknown> = {};

  if (userConfigPath) {
    log(`Using config: ${userConfigPath}`);
    try {
      const rawContent = await readFile(userConfigPath, 'utf-8');
      const parsed = yaml.load(rawContent);
      if (parsed && typeof parsed === 'object') {
        userConfig = parsed as Record<string, unknown>;
      }
    } catch (error) {
      log(
        `WARNING: Failed to parse ${userConfigPath}, using defaults: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  // Merge: spread all user settings, then override the keys we control
  const mergedConfig: Record<string, unknown> = {
    ...userConfig,
    formatter: 'markdown table',
    output: { file: '', mode: 'inject' },
  };

  log(`Effective config: ${JSON.stringify(mergedConfig)}`);

  // Write merged config to a temp file, run terraform-docs, then clean up
  const tmpDir = await mkdtemp(join(tmpdir(), 'tfdocs-'));
  const configPath = join(tmpDir, '.terraform-docs.yml');

  try {
    await writeFile(configPath, yaml.dump(mergedConfig, { lineWidth: -1 }), 'utf-8');

    const terraformDocsPath = which.sync('terraform-docs');
    const { stdout, stderr } = await execFilePromisified(terraformDocsPath, ['-c', configPath, directory], {
      encoding: 'utf-8',
    });

    if (stderr) {
      throw new Error(`Terraform-docs generation failed for module: ${name}\n${stderr}`);
    }

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    log(`Finished tf-docs (${elapsed}s)`);

    return stdout;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
