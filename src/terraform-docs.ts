import { execFile as execFileCallback, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { endGroup, error, info, startGroup } from '@actions/core';
import type { TerraformModule } from './terraform-module';

const execFile = promisify(execFileCallback);

type SupportedArchitectures = 'x64' | 'arm' | 'arm64';

const nodeToGoArchMap: { [key in SupportedArchitectures]: string } = {
  x64: 'amd64',
  arm: 'arm',
  arm64: 'arm64',
};

/**
 * Returns the Go architecture name corresponding to the given Node.js architecture.
 *
 * @param nodeArch - The Node.js architecture (e.g. 'x64', 'arm', 'arm64')
 * @returns The Go architecture name (e.g. 'amd64', 'arm', 'arm64')
 * @throws {Error} If the Node.js architecture is not supported
 */
function getGoArch(nodeArch: string): string {
  switch (nodeArch) {
    case 'x64':
    case 'arm':
    case 'arm64':
      return nodeToGoArchMap[nodeArch as SupportedArchitectures];
    default:
      throw new Error(`Unsupported architecture: ${nodeArch}`);
  }
}

/**
 * Installs the specified version of terraform-docs.
 *
 * Note: We don't check if already installed as we want to ensure we have the specified version
 *
 * @param {string} terraformDocsVersion - The version of terraform-docs to install.
 */
export function installTerraformDocs(terraformDocsVersion: string): void {
  startGroup(`Installing terraform-docs ${terraformDocsVersion}`);

  const platform = process.platform;
  const goArch = getGoArch(process.arch);

  execFileSync('curl', [
    '-sSLo',
    './terraform-docs.tar.gz',
    `https://terraform-docs.io/dl/${terraformDocsVersion}/terraform-docs-${terraformDocsVersion}-${platform}-${goArch}.tar.gz`,
  ]);

  execFileSync('tar', ['-xzf', 'terraform-docs.tar.gz']);
  execFileSync('chmod', ['+x', 'terraform-docs']);
  execFileSync('sudo', ['mv', 'terraform-docs', '/usr/local/bin/terraform-docs']); // Alternatively, use custom non elevated path
  execFileSync('/usr/local/bin/terraform-docs', ['--version'], { stdio: 'inherit' });
  endGroup();
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

  const { stdout, stderr } = await execFile('/usr/local/bin/terraform-docs', [
    'markdown',
    'table',
    '--sort-by',
    'required',
    directory,
  ]);

  if (stderr) {
    error(`Error generating tf-docs for ${moduleName}: ${stderr}`);
    throw new Error(`Terraform-docs generation failed for module: ${moduleName}\n${stderr}`);
  }

  info(`Finished tf-docs for: ${moduleName}`);

  return stdout;
}
