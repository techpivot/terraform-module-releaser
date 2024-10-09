import { exec as execCallback, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { endGroup, info, startGroup } from '@actions/core';
import type { TerraformModule } from './terraform-module';

const exec = promisify(execCallback);

/**
 * Installs the specified version of terraform-docs.
 *
 * Note: We don't check if already installed as we want to ensure we have the specified version
 *
 * @param {string} terraformDocsVersion - The version of terraform-docs to install.
 */
export const installTerraformDocs = (terraformDocsVersion: string): void => {
  startGroup(`Installing terraform-docs ${terraformDocsVersion}`);

  execSync(
    `curl -sSLo ./terraform-docs.tar.gz https://terraform-docs.io/dl/${terraformDocsVersion}/terraform-docs-${terraformDocsVersion}-$(uname)-$(dpkg --print-architecture).tar.gz`,
  );
  execSync('tar -xzf terraform-docs.tar.gz');
  execSync('chmod +x terraform-docs');
  execSync('sudo mv terraform-docs /usr/local/bin/terraform-docs');
  execSync('terraform-docs --version', { stdio: 'inherit' });

  endGroup();
};

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
export const generateTerraformDocs = async ({ moduleName, directory }: TerraformModule) => {
  info(`Generating tf-docs for: ${moduleName}`);

  const { stdout, stderr } = await exec(`terraform-docs markdown table --sort-by required "${directory}"`);

  if (stderr) {
    console.error(`Error generating tf-docs for ${moduleName}: ${stderr}`);
    throw new Error(`Terraform-docs generation failed for module: ${moduleName}\n${stderr}`);
  }

  info(`Finished tf-docs for: ${moduleName}`);

  return stdout;
};
