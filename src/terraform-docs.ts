import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { endGroup, info, startGroup } from '@actions/core';
import which from 'which';
import { context } from './context';
import type { TerraformModule } from './terraform-module';

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
      `Invalid terraform-docs version format: ${version}. Version must match the format v#.#.# (e.g., v0.19.0)`,
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
  let tempDir = null;

  try {
    validateTerraformDocsVersion(terraformDocsVersion);

    const { goPlatform, goArch, extension } = getValidatedPlatformConfig(process.platform, process.arch);
    const downloadFilename = `terraform-docs-${terraformDocsVersion}-${goPlatform}-${goArch}${extension}`;
    const downloadUrl = `https://terraform-docs.io/dl/${terraformDocsVersion}/${downloadFilename}`;

    // Create a temp directory to handle the extraction so this doesn't clobber our
    // current working directory.
    tempDir = mkdtempSync(path.join(tmpdir(), 'terraform-docs-'));
    process.chdir(tempDir);

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

      // terraform-docs version v0.19.0 af31cc6 windows/amd64
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

      // terraform-docs version v0.19.0 af31cc6 linux/amd64
      execFileSync('/usr/local/bin/terraform-docs', ['--version'], { stdio: 'inherit' });
    }
  } finally {
    if (tempDir !== null) {
      info(`Removing temp dir ${tempDir}`);
      rmSync(tempDir, { recursive: true });
    }
    process.chdir(cwd);
    console.timeEnd('Elapsed time installing terraform-docs');
    endGroup();
  }
}

/**
 * Ensures that the .terraform-docs.yml configuration file does not exist in the workspace directory.
 * If the file exists, it will be removed to prevent conflicts during Terraform documentation generation.
 *
 * @returns {void} This function does not return a value.
 */
export function ensureTerraformDocsConfigDoesNotExist(): void {
  info('Ensuring .terraform-docs.yml does not exist');

  const terraformDocsFile = path.join(context.workspaceDir, '.terraform-docs.yml');
  if (existsSync(terraformDocsFile)) {
    info('Found .terraform-docs.yml file, removing.');
    unlinkSync(terraformDocsFile);
  } else {
    info('No .terraform-docs.yml found.');
  }
}

/**
 * Generates Terraform documentation for a given module.
 *
 * This function runs the `terraform-docs` CLI tool to generate a Markdown table format of the Terraform documentation
 * for the specified module. It will sort the output by required fields.
 *
 * @param {TerraformModule} terraformModule - An object containing the module details, including:
 *   - `moduleName`: The name of the Terraform module.
 *   - `directory`: The directory path where the Terraform module is located.
 * @returns {Promise<string>} A promise that resolves with the generated Terraform documentation in Markdown format.
 * @throws {Error} Throws an error if the `terraform-docs` command fails or produces an error in the `stderr` output.
 */
export async function generateTerraformDocs({ moduleName, directory }: TerraformModule) {
  info(`Generating tf-docs for: ${moduleName}`);

  const terraformDocsPath = which.sync('terraform-docs');

  const { stdout, stderr } = await execFilePromisified(
    terraformDocsPath,
    ['markdown', 'table', '--sort-by', 'required', directory],
    { encoding: 'utf-8' },
  );

  if (stderr) {
    throw new Error(`Terraform-docs generation failed for module: ${moduleName}\n${stderr}`);
  }

  info(`Finished tf-docs for: ${moduleName}`);

  return stdout;
}
