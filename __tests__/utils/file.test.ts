import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { context } from '@/mocks/context';
import {
  copyModuleContents,
  findTerraformModuleDirectories,
  getRelativeTerraformModulePathFromFilePath,
  isTerraformDirectory,
  removeDirectoryContents,
  shouldExcludeFile,
  shouldIgnoreModulePath,
} from '@/utils/file';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('utils/file', () => {
  let tmpDir: string;

  beforeEach(() => {
    // Create a temporary directory before each test
    tmpDir = mkdtempSync(join(tmpdir(), 'file-test-dir-'));
  });

  afterEach(() => {
    // Remove temporary directory
    rmSync(tmpDir, { recursive: true });
  });

  describe('isTerraformDirectory()', () => {
    it('should return true for a directory that has .tf files', () => {
      writeFileSync(join(tmpDir, 'main.tf'), '# terraform code');
      expect(isTerraformDirectory(tmpDir)).toBe(true);
    });

    it('should return false for a directory that has .tf files', () => {
      writeFileSync(join(tmpDir, 'README.md'), '# README');
      expect(isTerraformDirectory(tmpDir)).toBe(false);
    });

    it('should return false for invalid directory', () => {
      expect(isTerraformDirectory('/invalid-directory')).toBe(false);
    });
  });

  describe('shouldIgnoreModulePath()', () => {
    it('should return false when ignore patterns are empty', () => {
      expect(shouldIgnoreModulePath('path/to/module', [])).toEqual({ shouldIgnore: false });
    });

    it('should return false when path does not match any pattern', () => {
      expect(shouldIgnoreModulePath('path/to/module', ['other/path', 'different/*'])).toEqual({ shouldIgnore: false });
    });

    it('should return true when path exactly matches a pattern', () => {
      expect(shouldIgnoreModulePath('path/to/module', ['path/to/module'])).toEqual({
        shouldIgnore: true,
        matchedPattern: 'path/to/module',
      });
    });

    it('should handle /** pattern correctly', () => {
      // Test the exact directory with the pattern "dir/**"
      // With minimatch, this does NOT match the exact directory itself without trailing slash
      expect(
        shouldIgnoreModulePath('tf-modules/kms/examples/complete', ['tf-modules/kms/examples/complete/**']),
      ).toEqual({ shouldIgnore: false });

      // But it DOES match the directory with trailing slash (as a directory)
      // Note: This won't ever happen as we only call this function with directory paths which won't have trailing
      // slash, but it's good to know how minimatch works.
      expect(
        shouldIgnoreModulePath('tf-modules/kms/examples/complete/', ['tf-modules/kms/examples/complete/**']),
      ).toEqual({ shouldIgnore: true, matchedPattern: 'tf-modules/kms/examples/complete/**' });

      // Files directly inside the directory
      expect(
        shouldIgnoreModulePath('tf-modules/kms/examples/complete/file.txt', ['tf-modules/kms/examples/complete/**']),
      ).toEqual({ shouldIgnore: true, matchedPattern: 'tf-modules/kms/examples/complete/**' });

      // Subdirectories inside the directory
      expect(
        shouldIgnoreModulePath('tf-modules/kms/examples/complete/subfolder', ['tf-modules/kms/examples/complete/**']),
      ).toEqual({ shouldIgnore: true, matchedPattern: 'tf-modules/kms/examples/complete/**' });

      // Nested files inside subdirectories
      expect(
        shouldIgnoreModulePath('tf-modules/kms/examples/complete/subfolder/nested.txt', [
          'tf-modules/kms/examples/complete/**',
        ]),
      ).toEqual({ shouldIgnore: true, matchedPattern: 'tf-modules/kms/examples/complete/**' });

      // To match both the directory and its contents, use both patterns
      expect(
        shouldIgnoreModulePath('tf-modules/kms/examples/complete', [
          'tf-modules/kms/examples/complete',
          'tf-modules/kms/examples/complete/**',
        ]),
      ).toEqual({ shouldIgnore: true, matchedPattern: 'tf-modules/kms/examples/complete' });
    });

    it('should return true when path matches a pattern with wildcards', () => {
      expect(shouldIgnoreModulePath('path/to/module', ['path/to/*'])).toEqual({
        shouldIgnore: true,
        matchedPattern: 'path/to/*',
      });
      expect(shouldIgnoreModulePath('path/to/another', ['path/to/*'])).toEqual({
        shouldIgnore: true,
        matchedPattern: 'path/to/*',
      });
      expect(shouldIgnoreModulePath('path/to/dir/file', ['path/to/*'])).toEqual({ shouldIgnore: false });
    });

    it('should return true when path matches a globstar pattern', () => {
      expect(shouldIgnoreModulePath('path/to/deep/nested/module', ['**/nested/**'])).toEqual({
        shouldIgnore: true,
        matchedPattern: '**/nested/**',
      });
      expect(shouldIgnoreModulePath('path/nested/file', ['**/nested/**'])).toEqual({
        shouldIgnore: true,
        matchedPattern: '**/nested/**',
      });
      expect(shouldIgnoreModulePath('nested/file', ['**/nested/**'])).toEqual({
        shouldIgnore: true,
        matchedPattern: '**/nested/**',
      });
      expect(shouldIgnoreModulePath('path/almost/file', ['**/nested/**'])).toEqual({ shouldIgnore: false });
    });

    it('should handle paths with file extensions properly', () => {
      // Important: With minimatch, 'examples/**' DOES match 'examples/complete'
      expect(shouldIgnoreModulePath('examples/complete', ['examples/**'])).toEqual({
        shouldIgnore: true,
        matchedPattern: 'examples/**',
      });
      expect(shouldIgnoreModulePath('examples/complete/file.js', ['examples/**'])).toEqual({
        shouldIgnore: true,
        matchedPattern: 'examples/**',
      });
      expect(shouldIgnoreModulePath('module/examples/complete', ['examples/**'])).toEqual({ shouldIgnore: false });
    });

    it('should handle matchBase=false behavior correctly', () => {
      // With matchBase: false, patterns without slashes must match the full path
      expect(shouldIgnoreModulePath('deep/path/module.js', ['module.js'])).toEqual({ shouldIgnore: false });
      expect(shouldIgnoreModulePath('module.js', ['module.js'])).toEqual({
        shouldIgnore: true,
        matchedPattern: 'module.js',
      });
    });

    it('should handle multiple patterns correctly', () => {
      const patterns = ['ignore/this/path', 'also/ignore/*', '**/node_modules/**'];

      expect(shouldIgnoreModulePath('ignore/this/path', patterns)).toEqual({
        shouldIgnore: true,
        matchedPattern: 'ignore/this/path',
      });
      expect(shouldIgnoreModulePath('also/ignore/something', patterns)).toEqual({
        shouldIgnore: true,
        matchedPattern: 'also/ignore/*',
      });
      expect(shouldIgnoreModulePath('deep/path/node_modules/package', patterns)).toEqual({
        shouldIgnore: true,
        matchedPattern: '**/node_modules/**',
      });
      expect(shouldIgnoreModulePath('keep/this/path', patterns)).toEqual({ shouldIgnore: false });
    });
  });

  describe('findTerraformModuleDirectories', () => {
    let tmpDir: string;

    beforeEach(() => {
      // Create a temporary directory with a random suffix
      tmpDir = mkdtempSync(join(tmpdir(), 'terraform-test-'));
    });

    afterEach(() => {
      // Clean up the temporary directory and all its contents
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should find basic terraform module directories', () => {
      // Create module structure
      const moduleDir1 = join(tmpDir, 'modules', 'vpc');
      const moduleDir2 = join(tmpDir, 'modules', 's3');
      mkdirSync(moduleDir1, { recursive: true });
      mkdirSync(moduleDir2, { recursive: true });

      // Create .tf files
      writeFileSync(join(moduleDir1, 'main.tf'), 'resource "aws_vpc" "main" {}');
      writeFileSync(join(moduleDir2, 'main.tf'), 'resource "aws_s3_bucket" "main" {}');

      // Create non-terraform directory
      const nonTfDir = join(tmpDir, 'docs');
      mkdirSync(nonTfDir, { recursive: true });
      writeFileSync(join(nonTfDir, 'README.md'), '# Documentation');

      const result = findTerraformModuleDirectories(tmpDir);

      expect(result).toHaveLength(2);
      expect(result).toContain(moduleDir1);
      expect(result).toContain(moduleDir2);
      expect(result).not.toContain(nonTfDir);
    });

    it('should handle nested terraform module directories', () => {
      // Create nested module structure
      const moduleDir1 = join(tmpDir, 'aws', 'vpc');
      const moduleDir2 = join(tmpDir, 'aws', 'ec2', 'instance');
      const moduleDir3 = join(tmpDir, 'azure', 'storage');
      mkdirSync(moduleDir1, { recursive: true });
      mkdirSync(moduleDir2, { recursive: true });
      mkdirSync(moduleDir3, { recursive: true });

      // Create .tf files
      writeFileSync(join(moduleDir1, 'main.tf'), 'resource "aws_vpc" "main" {}');
      writeFileSync(join(moduleDir1, 'variables.tf'), 'variable "name" {}');
      writeFileSync(join(moduleDir2, 'main.tf'), 'resource "aws_instance" "main" {}');
      writeFileSync(join(moduleDir3, 'main.tf'), 'resource "azurerm_storage_account" "main" {}');

      const result = findTerraformModuleDirectories(tmpDir);

      expect(result).toHaveLength(3);
      expect(result).toContain(moduleDir1);
      expect(result).toContain(moduleDir2);
      expect(result).toContain(moduleDir3);
    });

    it('should skip .terraform directories', () => {
      // Create module with .terraform directory
      const moduleDir = join(tmpDir, 'modules', 'vpc');
      const terraformDir = join(moduleDir, '.terraform');
      const terraformProviderDir = join(terraformDir, 'providers');
      mkdirSync(moduleDir, { recursive: true });
      mkdirSync(terraformProviderDir, { recursive: true });

      // Create .tf files in module
      writeFileSync(join(moduleDir, 'main.tf'), 'resource "aws_vpc" "main" {}');

      // Create files in .terraform directory that would normally make it a "terraform directory"
      writeFileSync(join(terraformDir, 'terraform.tfstate'), '{}');

      // Create the deep directory structure for terraform provider
      const providerPath = join(
        terraformProviderDir,
        'registry.terraform.io',
        'hashicorp',
        'aws',
        '5.0.0',
        'linux_amd64',
      );
      mkdirSync(providerPath, { recursive: true });
      writeFileSync(join(providerPath, 'terraform-provider-aws_v5.0.0_x5'), 'binary');

      const result = findTerraformModuleDirectories(tmpDir);

      expect(result).toHaveLength(1);
      expect(result).toContain(moduleDir);
      expect(result).not.toContain(terraformDir);
      expect(result).not.toContain(terraformProviderDir);
    });

    it('should respect modulePathIgnore patterns for exact matches', () => {
      // Create module structure
      const moduleDir1 = join(tmpDir, 'modules', 'vpc');
      const moduleDir2 = join(tmpDir, 'examples', 'basic');
      const moduleDir3 = join(tmpDir, 'test', 'integration');
      mkdirSync(moduleDir1, { recursive: true });
      mkdirSync(moduleDir2, { recursive: true });
      mkdirSync(moduleDir3, { recursive: true });

      // Create .tf files
      writeFileSync(join(moduleDir1, 'main.tf'), 'resource "aws_vpc" "main" {}');
      writeFileSync(join(moduleDir2, 'main.tf'), 'module "vpc" { source = "../../modules/vpc" }');
      writeFileSync(join(moduleDir3, 'main.tf'), 'module "vpc" { source = "../../modules/vpc" }');

      const result = findTerraformModuleDirectories(tmpDir, ['examples/basic', 'test/integration']);

      expect(result).toHaveLength(1);
      expect(result).toContain(moduleDir1);
      expect(result).not.toContain(moduleDir2);
      expect(result).not.toContain(moduleDir3);
    });

    it('should respect modulePathIgnore patterns with wildcards', () => {
      // Create module structure with examples and test directories
      const moduleDir1 = join(tmpDir, 'modules', 'vpc');
      const moduleDir2 = join(tmpDir, 'modules', 's3');
      const exampleDir1 = join(tmpDir, 'modules', 'vpc', 'examples', 'basic');
      const exampleDir2 = join(tmpDir, 'modules', 's3', 'examples', 'complete');
      const testDir1 = join(tmpDir, 'test', 'vpc');
      const testDir2 = join(tmpDir, 'test', 'integration', 's3');

      mkdirSync(moduleDir1, { recursive: true });
      mkdirSync(moduleDir2, { recursive: true });
      mkdirSync(exampleDir1, { recursive: true });
      mkdirSync(exampleDir2, { recursive: true });
      mkdirSync(testDir1, { recursive: true });
      mkdirSync(testDir2, { recursive: true });

      // Create .tf files
      writeFileSync(join(moduleDir1, 'main.tf'), 'resource "aws_vpc" "main" {}');
      writeFileSync(join(moduleDir2, 'main.tf'), 'resource "aws_s3_bucket" "main" {}');
      writeFileSync(join(exampleDir1, 'main.tf'), 'module "vpc" { source = "../.." }');
      writeFileSync(join(exampleDir2, 'main.tf'), 'module "s3" { source = "../.." }');
      writeFileSync(join(testDir1, 'main.tf'), 'module "vpc" { source = "../../modules/vpc" }');
      writeFileSync(join(testDir2, 'main.tf'), 'module "s3" { source = "../../../modules/s3" }');

      const result = findTerraformModuleDirectories(tmpDir, ['**/examples/**', '**/test/**']);

      expect(result).toHaveLength(2);
      expect(result).toContain(moduleDir1);
      expect(result).toContain(moduleDir2);
      expect(result).not.toContain(exampleDir1);
      expect(result).not.toContain(exampleDir2);
      expect(result).not.toContain(testDir1);
      expect(result).not.toContain(testDir2);
    });

    it('should handle multiple ignore patterns', () => {
      // Create diverse module structure
      const moduleDir1 = join(tmpDir, 'modules', 'vpc');
      const moduleDir2 = join(tmpDir, 'infrastructure', 'networking');
      const exampleDir = join(tmpDir, 'examples', 'complete');
      const testDir = join(tmpDir, 'test', 'unit');
      const docsDir = join(tmpDir, 'docs', 'terraform');
      const rootModuleDir = join(tmpDir, 'root-modules', 'staging');

      mkdirSync(moduleDir1, { recursive: true });
      mkdirSync(moduleDir2, { recursive: true });
      mkdirSync(exampleDir, { recursive: true });
      mkdirSync(testDir, { recursive: true });
      mkdirSync(docsDir, { recursive: true });
      mkdirSync(rootModuleDir, { recursive: true });

      // Create .tf files
      writeFileSync(join(moduleDir1, 'main.tf'), 'resource "aws_vpc" "main" {}');
      writeFileSync(join(moduleDir2, 'main.tf'), 'resource "aws_subnet" "main" {}');
      writeFileSync(join(exampleDir, 'main.tf'), 'module "vpc" { source = "../../modules/vpc" }');
      writeFileSync(join(testDir, 'main.tf'), 'module "vpc" { source = "../../modules/vpc" }');
      writeFileSync(join(docsDir, 'main.tf'), 'resource "null_resource" "example" {}');
      writeFileSync(join(rootModuleDir, 'main.tf'), 'module "vpc" { source = "../../modules/vpc" }');

      const result = findTerraformModuleDirectories(tmpDir, [
        '**/examples/**',
        '**/test/**',
        '**/docs/**',
        'root-modules/**',
      ]);

      expect(result).toHaveLength(2);
      expect(result).toContain(moduleDir1);
      expect(result).toContain(moduleDir2);
      expect(result).not.toContain(exampleDir);
      expect(result).not.toContain(testDir);
      expect(result).not.toContain(docsDir);
      expect(result).not.toContain(rootModuleDir);
    });

    it('should handle empty workspace directory', () => {
      const result = findTerraformModuleDirectories(tmpDir);

      expect(result).toHaveLength(0);
    });

    it('should handle workspace with only non-terraform directories', () => {
      // Create non-terraform directories
      const srcDir = join(tmpDir, 'src');
      const docsDir = join(tmpDir, 'docs');
      const configDir = join(tmpDir, 'config');
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(docsDir, { recursive: true });
      mkdirSync(configDir, { recursive: true });

      // Create non-.tf files
      writeFileSync(join(srcDir, 'main.py'), 'print("Hello, World!")');
      writeFileSync(join(docsDir, 'README.md'), '# Documentation');
      writeFileSync(join(configDir, 'config.json'), '{}');

      const result = findTerraformModuleDirectories(tmpDir);

      expect(result).toHaveLength(0);
    });

    it('should handle directories with mixed file types', () => {
      // Create module with mixed file types
      const moduleDir = join(tmpDir, 'modules', 'mixed');
      mkdirSync(moduleDir, { recursive: true });

      // Create various file types including .tf
      writeFileSync(join(moduleDir, 'main.tf'), 'resource "aws_vpc" "main" {}');
      writeFileSync(join(moduleDir, 'variables.tf'), 'variable "name" {}');
      writeFileSync(join(moduleDir, 'README.md'), '# Module Documentation');
      writeFileSync(join(moduleDir, 'test.py'), 'import unittest');
      writeFileSync(join(moduleDir, '.gitignore'), '*.tfstate');

      // Create directory without .tf files
      const nonTfDir = join(tmpDir, 'scripts');
      mkdirSync(nonTfDir, { recursive: true });
      writeFileSync(join(nonTfDir, 'deploy.sh'), '#!/bin/bash');
      writeFileSync(join(nonTfDir, 'config.yaml'), 'key: value');

      const result = findTerraformModuleDirectories(tmpDir);

      expect(result).toHaveLength(1);
      expect(result).toContain(moduleDir);
      expect(result).not.toContain(nonTfDir);
    });

    it('should handle deeply nested module structures', () => {
      // Create deeply nested module structure
      const deepModuleDir = join(tmpDir, 'company', 'platform', 'aws', 'networking', 'vpc', 'modules', 'main');
      mkdirSync(deepModuleDir, { recursive: true });
      writeFileSync(join(deepModuleDir, 'main.tf'), 'resource "aws_vpc" "main" {}');

      // Create another deep module
      const anotherDeepDir = join(tmpDir, 'environments', 'prod', 'us-east-1', 'storage', 's3');
      mkdirSync(anotherDeepDir, { recursive: true });
      writeFileSync(join(anotherDeepDir, 'bucket.tf'), 'resource "aws_s3_bucket" "main" {}');

      const result = findTerraformModuleDirectories(tmpDir);

      expect(result).toHaveLength(2);
      expect(result).toContain(deepModuleDir);
      expect(result).toContain(anotherDeepDir);
    });

    it('should ignore patterns using relative paths from workspace root', () => {
      // Create module structure
      const moduleDir1 = join(tmpDir, 'terraform', 'modules', 'vpc');
      const moduleDir2 = join(tmpDir, 'terraform', 'examples', 'vpc');
      const moduleDir3 = join(tmpDir, 'other', 'examples', 'test');

      mkdirSync(moduleDir1, { recursive: true });
      mkdirSync(moduleDir2, { recursive: true });
      mkdirSync(moduleDir3, { recursive: true });

      // Create .tf files
      writeFileSync(join(moduleDir1, 'main.tf'), 'resource "aws_vpc" "main" {}');
      writeFileSync(join(moduleDir2, 'main.tf'), 'module "vpc" { source = "../modules/vpc" }');
      writeFileSync(join(moduleDir3, 'main.tf'), 'resource "null_resource" "test" {}');

      const result = findTerraformModuleDirectories(tmpDir, ['terraform/examples/**']);

      expect(result).toHaveLength(2);
      expect(result).toContain(moduleDir1);
      expect(result).toContain(moduleDir3);
      expect(result).not.toContain(moduleDir2);
    });

    it('should handle case sensitivity in ignore patterns', () => {
      // Create module structure with different cases
      const moduleDir1 = join(tmpDir, 'Modules', 'VPC');
      const moduleDir2 = join(tmpDir, 'modules', 'vpc');
      const exampleDir1 = join(tmpDir, 'Examples', 'Basic');
      const exampleDir2 = join(tmpDir, 'examples', 'basic');

      mkdirSync(moduleDir1, { recursive: true });
      mkdirSync(moduleDir2, { recursive: true });
      mkdirSync(exampleDir1, { recursive: true });
      mkdirSync(exampleDir2, { recursive: true });

      // Create .tf files
      writeFileSync(join(moduleDir1, 'main.tf'), 'resource "aws_vpc" "main" {}');
      writeFileSync(join(moduleDir2, 'main.tf'), 'resource "aws_vpc" "main" {}');
      writeFileSync(join(exampleDir1, 'main.tf'), 'module "vpc" { source = "../../Modules/VPC" }');
      writeFileSync(join(exampleDir2, 'main.tf'), 'module "vpc" { source = "../../modules/vpc" }');

      const result = findTerraformModuleDirectories(tmpDir, ['examples/**']);

      expect(result).toHaveLength(3);
      expect(result).toContain(moduleDir1);
      expect(result).toContain(moduleDir2);
      expect(result).toContain(exampleDir1); // Should not be ignored due to case difference
      expect(result).not.toContain(exampleDir2);
    });

    it('should return absolute paths', () => {
      // Create module structure
      const moduleDir = join(tmpDir, 'modules', 'vpc');
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(join(moduleDir, 'main.tf'), 'resource "aws_vpc" "main" {}');

      const result = findTerraformModuleDirectories(tmpDir);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(moduleDir);
      expect(result[0]).toMatch(/^[\\/]/); // Should start with / or \ (absolute path)
    });

    it('should handle symlinks gracefully', () => {
      // Note: This test may behave differently on different operating systems
      // Create module structure
      const realModuleDir = join(tmpDir, 'real-modules', 'vpc');
      mkdirSync(realModuleDir, { recursive: true });
      writeFileSync(join(realModuleDir, 'main.tf'), 'resource "aws_vpc" "main" {}');

      // This test is more about ensuring the function doesn't crash with symlinks
      // The actual behavior with symlinks may vary by OS

      expect(() => {
        const result = findTerraformModuleDirectories(tmpDir);
        expect(Array.isArray(result)).toBe(true);
      }).not.toThrow();
    });
  });

  describe('getRelativeTerraformModulePathFromFilePath()', () => {
    // const originalWorkspaceDir = context.workspaceDir;

    beforeEach(() => {
      context.workspaceDir = tmpDir; // Set workspaceDir to tmpDir for tests
    });

    afterEach(() => {
      // Restore original context
      //context.workspaceDir = originalWorkspaceDir;
    });

    it('should return relative path for file in terraform module directory', () => {
      // Create module structure
      const moduleDir = join(tmpDir, 'modules', 'vpc');
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(join(moduleDir, 'main.tf'), 'resource "aws_vpc" "main" {}');
      writeFileSync(join(moduleDir, 'variables.tf'), 'variable "name" {}');

      // Test with absolute path
      const absoluteFilePath = join(moduleDir, 'main.tf');
      const result = getRelativeTerraformModulePathFromFilePath(absoluteFilePath);

      expect(result).toBe('modules/vpc');
    });

    it('should return relative path for file in nested terraform module directory', () => {
      // Create nested module structure
      const moduleDir = join(tmpDir, 'terraform', 'aws', 'networking', 'vpc');
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(join(moduleDir, 'main.tf'), 'resource "aws_vpc" "main" {}');

      const filePath = join(moduleDir, 'outputs.tf');
      writeFileSync(filePath, 'output "vpc_id" { value = aws_vpc.main.id }');

      const result = getRelativeTerraformModulePathFromFilePath(filePath);

      expect(result).toBe('terraform/aws/networking/vpc');
    });

    it('should traverse upward to find terraform module directory', () => {
      // Create module with subdirectories
      const moduleDir = join(tmpDir, 'modules', 'complex');
      const subDir = join(moduleDir, 'templates', 'userdata');
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(moduleDir, 'main.tf'), 'resource "aws_instance" "main" {}');

      // Create file in subdirectory
      const scriptFile = join(subDir, 'init.sh');
      writeFileSync(scriptFile, '#!/bin/bash\necho "Hello World"');

      const result = getRelativeTerraformModulePathFromFilePath(scriptFile);

      expect(result).toBe('modules/complex');
    });

    it('should handle relative file paths', () => {
      // Create module structure
      const moduleDir = join(tmpDir, 'modules', 'storage');
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(join(moduleDir, 'main.tf'), 'resource "aws_s3_bucket" "main" {}');

      // Use relative path from tmpDir
      const relativeFilePath = 'modules/storage/main.tf';

      const result = getRelativeTerraformModulePathFromFilePath(relativeFilePath);

      expect(result).toBe('modules/storage');
    });

    it('should return null when no terraform module directory is found', () => {
      // Create non-terraform directory structure
      const docsDir = join(tmpDir, 'docs', 'guides');
      mkdirSync(docsDir, { recursive: true });
      const readmeFile = join(docsDir, 'README.md');
      writeFileSync(readmeFile, '# Documentation');

      const result = getRelativeTerraformModulePathFromFilePath(readmeFile);

      expect(result).toBeNull();
    });

    it('should return null when file is in workspace root without terraform files', () => {
      // Create file directly in tmpDir (workspace root) without .tf files
      const packageFile = join(tmpDir, 'package.json');
      writeFileSync(packageFile, '{"name": "test"}');

      const result = getRelativeTerraformModulePathFromFilePath(packageFile);

      expect(result).toBeNull();
    });

    it('should prevent file in workspace root with terraform files', () => {
      // Create terraform files directly in tmpDir (workspace root)
      writeFileSync(join(tmpDir, 'main.tf'), 'terraform { required_version = ">= 1.0" }');
      writeFileSync(join(tmpDir, 'providers.tf'), 'provider "aws" {}');

      const configFile = join(tmpDir, 'terraform.tfvars');
      writeFileSync(configFile, 'region = "us-east-1"');

      const result = getRelativeTerraformModulePathFromFilePath(configFile);

      expect(result).toBeNull();
    });

    it('should stop traversal at workspace root boundary', () => {
      // Create a structure where terraform files exist above the workspace
      const parentDir = dirname(tmpDir);
      const terraformFileAbove = join(parentDir, 'main.tf');

      // Create terraform file above workspace (if possible)
      try {
        writeFileSync(terraformFileAbove, 'resource "test" "example" {}');
      } catch (_error) {
        // Skip this test if we can't write above tmpDir
        return;
      }

      // Create non-terraform file in workspace
      const testFile = join(tmpDir, 'test.txt');
      writeFileSync(testFile, 'test content');

      const result = getRelativeTerraformModulePathFromFilePath(testFile);

      expect(result).toBeNull();

      // Cleanup
      try {
        rmSync(terraformFileAbove);
      } catch (_error) {
        // Ignore cleanup errors
      }
    });

    it('should handle deeply nested file structures', () => {
      // Create deeply nested module
      const moduleDir = join(tmpDir, 'infrastructure', 'aws', 'services', 'compute', 'ec2');
      const deepSubDir = join(moduleDir, 'templates', 'user-data', 'scripts', 'init');
      mkdirSync(deepSubDir, { recursive: true });

      writeFileSync(join(moduleDir, 'main.tf'), 'resource "aws_instance" "main" {}');
      writeFileSync(join(moduleDir, 'variables.tf'), 'variable "instance_type" {}');

      const deepFile = join(deepSubDir, 'bootstrap.sh');
      writeFileSync(deepFile, '#!/bin/bash\necho "Bootstrapping..."');

      const result = getRelativeTerraformModulePathFromFilePath(deepFile);

      expect(result).toBe('infrastructure/aws/services/compute/ec2');
    });

    it('should handle files with various extensions', () => {
      // Create module structure
      const moduleDir = join(tmpDir, 'modules', 'database');
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(join(moduleDir, 'main.tf'), 'resource "aws_db_instance" "main" {}');

      // Test different file types
      const files = ['schema.sql', 'config.yaml', 'script.py', 'README.md', 'Dockerfile', '.gitignore'];

      for (const fileName of files) {
        const filePath = join(moduleDir, fileName);
        writeFileSync(filePath, `# ${fileName} content`);

        const result = getRelativeTerraformModulePathFromFilePath(filePath);
        expect(result).toBe('modules/database');
      }
    });
  });

  describe('shouldExcludeFile()', () => {
    it('should exclude file when pattern matches', () => {
      const baseDirectory = tmpDir;
      const filePath = join(tmpDir, 'file.txt');
      const excludePatterns = ['*.txt'];
      const relativeFilePath = relative(baseDirectory, filePath);

      expect(shouldExcludeFile(relativeFilePath, excludePatterns)).toEqual({
        shouldExclude: true,
        matchedPattern: '*.txt',
      });
    });

    it('should not exclude file when pattern does not match', () => {
      const baseDirectory = tmpDir;
      const filePath = join(tmpDir, 'file.txt');
      const excludePatterns = ['*.js'];
      const relativeFilePath = relative(baseDirectory, filePath);

      expect(shouldExcludeFile(relativeFilePath, excludePatterns)).toEqual({ shouldExclude: false });
    });

    it('should handle relative paths correctly', () => {
      const baseDirectory = tmpDir;
      const filePath = join(tmpDir, 'subdir', 'file.txt');
      const excludePatterns = ['subdir/*.txt'];
      const relativeFilePath = relative(baseDirectory, filePath);

      expect(shouldExcludeFile(relativeFilePath, excludePatterns)).toEqual({
        shouldExclude: true,
        matchedPattern: 'subdir/*.txt',
      });
    });

    it('should handle exclusion pattern: *.md', () => {
      const baseDirectory = tmpDir;
      const filePath1 = join(tmpDir, 'README.md');
      const filePath2 = join(tmpDir, 'nested', 'README.md');
      const excludePatterns = ['*.md'];
      const relativeFilePath1 = relative(baseDirectory, filePath1);
      const relativeFilePath2 = relative(baseDirectory, filePath2);

      expect(shouldExcludeFile(relativeFilePath1, excludePatterns)).toEqual({
        shouldExclude: true,
        matchedPattern: '*.md',
      });
      expect(shouldExcludeFile(relativeFilePath2, excludePatterns)).toEqual({
        shouldExclude: true,
        matchedPattern: '*.md',
      });
    });

    it('should handle exclusion pattern: **/*.md', () => {
      const baseDirectory = tmpDir;
      const filePath1 = join(tmpDir, 'README.md');
      const filePath2 = join(tmpDir, 'nested', 'README.md');
      const excludePatterns = ['**/*.md'];
      const relativeFilePath1 = relative(baseDirectory, filePath1);
      const relativeFilePath2 = relative(baseDirectory, filePath2);

      expect(shouldExcludeFile(relativeFilePath1, excludePatterns)).toEqual({
        shouldExclude: true,
        matchedPattern: '**/*.md',
      });
      expect(shouldExcludeFile(relativeFilePath2, excludePatterns)).toEqual({
        shouldExclude: true,
        matchedPattern: '**/*.md',
      });
    });

    it('should handle exclusion pattern: tests/**', () => {
      const baseDirectory = tmpDir;
      const filePath1 = join(tmpDir, 'tests/config.test.ts');
      const filePath2 = join(tmpDir, 'tests2/config.test.ts');
      const filePath3 = join(tmpDir, 'tests2/tests/config.test.ts');
      const excludePatterns = ['tests/**'];
      const relativeFilePath1 = relative(baseDirectory, filePath1);
      const relativeFilePath2 = relative(baseDirectory, filePath2);
      const relativeFilePath3 = relative(baseDirectory, filePath3);

      expect(shouldExcludeFile(relativeFilePath1, excludePatterns)).toEqual({
        shouldExclude: true,
        matchedPattern: 'tests/**',
      });
      expect(shouldExcludeFile(relativeFilePath2, excludePatterns)).toEqual({ shouldExclude: false });
      expect(shouldExcludeFile(relativeFilePath3, excludePatterns)).toEqual({ shouldExclude: false });
    });

    it('should handle exclusion pattern: **/tests/**', () => {
      const baseDirectory = tmpDir;
      const filePath1 = join(tmpDir, 'tests/config.test.ts');
      const filePath2 = join(tmpDir, 'tests2/config.test.ts');
      const filePath3 = join(tmpDir, 'tests2/tests/config.test.ts');
      const excludePatterns = ['**/tests/**'];
      const relativeFilePath1 = relative(baseDirectory, filePath1);
      const relativeFilePath2 = relative(baseDirectory, filePath2);
      const relativeFilePath3 = relative(baseDirectory, filePath3);

      expect(shouldExcludeFile(relativeFilePath1, excludePatterns)).toEqual({
        shouldExclude: true,
        matchedPattern: '**/tests/**',
      });
      expect(shouldExcludeFile(relativeFilePath2, excludePatterns)).toEqual({ shouldExclude: false });
      expect(shouldExcludeFile(relativeFilePath3, excludePatterns)).toEqual({
        shouldExclude: true,
        matchedPattern: '**/tests/**',
      });
    });
  });

  describe('copyModuleContents()', () => {
    beforeEach(() => {
      // Create src and dest directories for every test in this suite
      mkdirSync(join(tmpDir, 'src'), { recursive: true });
      mkdirSync(join(tmpDir, 'dest'), { recursive: true });
    });

    it('should copy directory contents excluding files that match patterns', () => {
      const srcDirectory = join(tmpDir, 'src');
      const destDirectory = join(tmpDir, 'dest');
      const excludePatterns = ['*.txt'];

      // Create files in src directory
      writeFileSync(join(srcDirectory, 'file.txt'), 'Hello World!');
      writeFileSync(join(srcDirectory, 'file.js'), 'console.log("Hello World!");');

      // Now perform the copy operation
      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      // Check that the file was copied
      expect(existsSync(join(destDirectory, 'file.txt'))).toBe(false);
      expect(existsSync(join(destDirectory, 'file.js'))).toBe(true);
    });

    it('should handle recursive directory copying', () => {
      const srcDirectory = join(tmpDir, 'src');
      const destDirectory = join(tmpDir, 'dest');
      const excludePatterns: string[] = [];

      // Create source structure
      mkdirSync(join(srcDirectory, 'subdir'), { recursive: true });
      writeFileSync(join(srcDirectory, 'file.txt'), 'Hello World!');
      writeFileSync(join(srcDirectory, 'subdir', 'file.js'), 'console.log("Hello World!");');

      // Perform the copy operation
      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      // Validate the destination contents
      expect(existsSync(join(destDirectory, 'file.txt'))).toBe(true);
      expect(existsSync(join(destDirectory, 'subdir', 'file.js'))).toBe(true);
    });

    it('should copy files excluding multiple patterns', () => {
      const srcDirectory = join(tmpDir, 'src');
      const destDirectory = join(tmpDir, 'dest');
      const excludePatterns = ['*.txt', '*.js'];

      writeFileSync(join(srcDirectory, 'file.txt'), 'Hello World!');
      writeFileSync(join(srcDirectory, 'file.js'), 'console.log("Hello World!");');
      writeFileSync(join(srcDirectory, 'file.md'), 'This is a markdown file.');

      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      expect(existsSync(join(destDirectory, 'file.txt'))).toBe(false);
      expect(existsSync(join(destDirectory, 'file.js'))).toBe(false);
      expect(existsSync(join(destDirectory, 'file.md'))).toBe(true);
    });

    it('should handle copying from an empty directory', () => {
      const srcDirectory = join(tmpDir, 'src');
      const destDirectory = join(tmpDir, 'dest');
      const excludePatterns = ['*.txt'];

      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      // Validate that the destination directory is still empty
      expect(readdirSync(destDirectory).length).toBe(0);
    });

    it('should throw an error if the source directory does not exist', () => {
      const nonExistentSrcDirectory = join(tmpDir, 'non-existent-src');
      const destDirectory = join(tmpDir, 'dest');
      const excludePatterns = ['*.txt'];

      expect(() => {
        copyModuleContents(nonExistentSrcDirectory, destDirectory, excludePatterns);
      }).toThrow(); // Assuming your implementation throws an error for non-existent directories
    });

    it('should copy files that do not match any exclusion patterns', () => {
      const srcDirectory = join(tmpDir, 'src');
      const destDirectory = join(tmpDir, 'dest');
      const excludePatterns = ['*.js'];

      writeFileSync(join(srcDirectory, 'file.txt'), 'Hello World!');
      writeFileSync(join(srcDirectory, 'file.js'), 'console.log("Hello World!");');

      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      expect(existsSync(join(destDirectory, 'file.txt'))).toBe(true);
      expect(existsSync(join(destDirectory, 'file.js'))).toBe(false);
    });

    it('should overwrite files in the destination if they have the same name and do not match exclusion patterns', () => {
      const srcDirectory = join(tmpDir, 'src');
      const destDirectory = join(tmpDir, 'dest');
      const excludePatterns: string[] = [];

      writeFileSync(join(srcDirectory, 'file.txt'), 'Hello World from source!');
      writeFileSync(join(destDirectory, 'file.txt'), 'Hello World from destination!');

      copyModuleContents(srcDirectory, destDirectory, excludePatterns);

      const destContent = readFileSync(join(destDirectory, 'file.txt'), 'utf-8');
      expect(destContent).toBe('Hello World from source!');
    });
  });

  describe('removeDirectoryContents()', () => {
    it('should remove directory contents except for specified exceptions', () => {
      const directory = join(tmpDir, 'dir');
      const exceptions = ['file.txt'];

      mkdirSync(directory);
      writeFileSync(join(directory, 'file.txt'), 'Hello World!');
      writeFileSync(join(directory, 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory, exceptions);

      expect(existsSync(join(directory, 'file.txt'))).toBe(true);
      expect(existsSync(join(directory, 'file.js'))).toBe(false);
    });

    it('should handle recursive directory removal', () => {
      const directory = join(tmpDir, 'dir');
      const exceptions: string[] = [];

      mkdirSync(directory);
      mkdirSync(join(directory, 'subdir'));
      writeFileSync(join(directory, 'file.txt'), 'Hello World!');
      writeFileSync(join(directory, 'subdir', 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory, exceptions);

      expect(existsSync(join(directory, 'file.txt'))).toBe(false);
      expect(existsSync(join(directory, 'subdir', 'file.js'))).toBe(false);
    });

    it('should handle exceptions correctly', () => {
      const directory = join(tmpDir, 'dir');
      const exceptions = ['file.txt', 'subdir'];

      mkdirSync(directory);
      mkdirSync(join(directory, 'subdir'));
      writeFileSync(join(directory, 'file.txt'), 'Hello World!');
      writeFileSync(join(directory, 'file.js'), 'console.log("Hello World!");');
      writeFileSync(join(directory, 'subdir', 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory, exceptions);

      expect(existsSync(join(directory, 'file.txt'))).toBe(true);
      expect(existsSync(join(directory, 'file.js'))).toBe(false);
      expect(existsSync(join(directory, 'subdir', 'file.js'))).toBe(true);
    });

    it('should handle an empty directory', () => {
      const directory = join(tmpDir, 'dir');
      const exceptions: string[] = [];

      mkdirSync(directory); // Create an empty directory
      removeDirectoryContents(directory, exceptions);

      // Validate that the directory is still empty
      expect(readdirSync(directory).length).toBe(0);
    });

    it('should not remove if only exceptions are present', () => {
      const directory = join(tmpDir, 'dir');
      const exceptions = ['file.txt'];

      mkdirSync(directory);
      writeFileSync(join(directory, 'file.txt'), 'Hello World!');

      removeDirectoryContents(directory, exceptions);

      expect(existsSync(join(directory, 'file.txt'))).toBe(true);
      expect(readdirSync(directory).length).toBe(1); // Only the exception should exist
    });

    it('should handle nested exceptions correctly', () => {
      const directory = join(tmpDir, 'dir');
      const exceptions = ['subdir'];

      mkdirSync(directory);
      mkdirSync(join(directory, 'subdir'));
      writeFileSync(join(directory, 'file.txt'), 'Hello World!');
      writeFileSync(join(directory, 'subdir', 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory, exceptions);

      expect(existsSync(join(directory, 'subdir'))).toBe(true);
      expect(existsSync(join(directory, 'file.txt'))).toBe(false);
      expect(existsSync(join(directory, 'subdir', 'file.js'))).toBe(true);
    });

    it('should not throw an error if the directory does not exist', () => {
      const nonExistentDirectory = join(tmpDir, 'non-existent-dir');
      const exceptions = ['file.txt'];

      expect(() => {
        removeDirectoryContents(nonExistentDirectory, exceptions);
      }).not.toThrow(); // Ensure no error is thrown
    });

    it('should handle exceptions that do not exist in the directory', () => {
      const directory = join(tmpDir, 'dir');
      const exceptions = ['file.txt'];

      mkdirSync(directory);
      writeFileSync(join(directory, 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory, exceptions);

      expect(existsSync(join(directory, 'file.js'))).toBe(false);
    });

    it('should remove directory contents when no exceptions specified', () => {
      const directory = join(tmpDir, 'dir');

      mkdirSync(directory);
      writeFileSync(join(directory, 'file.txt'), 'Hello World!');
      writeFileSync(join(directory, 'file.js'), 'console.log("Hello World!");');

      removeDirectoryContents(directory);

      expect(existsSync(join(directory, 'file.txt'))).toBe(false);
      expect(existsSync(join(directory, 'file.js'))).toBe(false);
    });
  });
});
