import { removeLeadingCharacters, removeTrailingCharacters, renderTemplate } from '@/utils/string';
import { describe, expect, it } from 'vitest';

describe('utils/string', () => {
  describe('removeLeadingCharacters', () => {
    it('should remove leading dots', () => {
      expect(removeLeadingCharacters('...hello', ['.'])).toBe('hello');
      expect(removeLeadingCharacters('..module-name', ['.'])).toBe('module-name');
      expect(removeLeadingCharacters('.....test', ['.'])).toBe('test');
    });

    it('should remove leading hyphens and underscores', () => {
      expect(removeLeadingCharacters('--module-name', ['-'])).toBe('module-name');
      expect(removeLeadingCharacters('__module_name', ['_'])).toBe('module_name');
      expect(removeLeadingCharacters('-_module-name', ['-', '_'])).toBe('module-name');
    });

    it('should remove multiple leading character types', () => {
      expect(removeLeadingCharacters('._-module-name', ['.', '-', '_'])).toBe('module-name');
      expect(removeLeadingCharacters('.--__test', ['.', '-', '_'])).toBe('test');
      expect(removeLeadingCharacters('___...---example', ['.', '-', '_'])).toBe('example');
    });

    it('should preserve internal characters', () => {
      expect(removeLeadingCharacters('.hello.world', ['.'])).toBe('hello.world');
      expect(removeLeadingCharacters('.-module-name.test', ['.', '-'])).toBe('module-name.test');
      expect(removeLeadingCharacters('_test_module_name', ['_'])).toBe('test_module_name');
    });

    it('should handle edge cases', () => {
      expect(removeLeadingCharacters('', ['.'])).toBe('');
      expect(removeLeadingCharacters('...', ['.'])).toBe('');
      expect(removeLeadingCharacters('---', ['-'])).toBe('');
      expect(removeLeadingCharacters('hello', ['.', '-', '_'])).toBe('hello');
      expect(removeLeadingCharacters('module', [])).toBe('module');
    });

    it('should handle complex terraform module names', () => {
      expect(removeLeadingCharacters('._-aws-vpc-module', ['.', '-', '_'])).toBe('aws-vpc-module');
      expect(removeLeadingCharacters('--tf-modules/vpc-endpoint', ['-', '_'])).toBe('tf-modules/vpc-endpoint');
      expect(removeLeadingCharacters('__modules/networking/vpc', ['_'])).toBe('modules/networking/vpc');
    });

    it('should handle forward slashes in leading characters', () => {
      expect(removeLeadingCharacters('/./module-name', ['/', '.'])).toBe('module-name');
      expect(removeLeadingCharacters('/./_-example', ['/', '.', '_', '-'])).toBe('example');
    });
  });

  describe('removeTrailingCharacters', () => {
    it('should remove trailing dots', () => {
      expect(removeTrailingCharacters('hello...', ['.'])).toBe('hello');
      expect(removeTrailingCharacters('module-name..', ['.'])).toBe('module-name');
      expect(removeTrailingCharacters('test.....', ['.'])).toBe('test');
    });

    it('should remove trailing hyphens and underscores', () => {
      expect(removeTrailingCharacters('module-name--', ['-'])).toBe('module-name');
      expect(removeTrailingCharacters('module_name__', ['_'])).toBe('module_name');
      expect(removeTrailingCharacters('module-name-_', ['-', '_'])).toBe('module-name');
    });

    it('should remove multiple trailing character types', () => {
      expect(removeTrailingCharacters('module-name-_.', ['.', '-', '_'])).toBe('module-name');
      expect(removeTrailingCharacters('test.--__..', ['.', '-', '_'])).toBe('test');
      expect(removeTrailingCharacters('example___...---', ['.', '-', '_'])).toBe('example');
    });

    it('should preserve internal characters', () => {
      expect(removeTrailingCharacters('hello.world', ['.'])).toBe('hello.world');
      expect(removeTrailingCharacters('module-name.test', ['.', '-'])).toBe('module-name.test');
      expect(removeTrailingCharacters('test_module_name', ['_'])).toBe('test_module_name');
    });

    it('should handle edge cases', () => {
      expect(removeTrailingCharacters('', ['.'])).toBe('');
      expect(removeTrailingCharacters('...', ['.'])).toBe('');
      expect(removeTrailingCharacters('---', ['-'])).toBe('');
      expect(removeTrailingCharacters('hello', ['.', '-', '_'])).toBe('hello');
      expect(removeTrailingCharacters('module', [])).toBe('module');
    });

    it('should handle complex terraform module names', () => {
      expect(removeTrailingCharacters('aws-vpc-module-_.', ['.', '-', '_'])).toBe('aws-vpc-module');
      expect(removeTrailingCharacters('tf-modules/vpc-endpoint--', ['-', '_'])).toBe('tf-modules/vpc-endpoint');
      expect(removeTrailingCharacters('modules/networking/vpc__', ['_'])).toBe('modules/networking/vpc');
    });

    it('should handle forward slashes in trailing characters', () => {
      expect(removeTrailingCharacters('module-name/.', ['/', '.'])).toBe('module-name');
      expect(removeTrailingCharacters('example-_./', ['/', '.', '_', '-'])).toBe('example');
    });
  });

  describe('renderTemplate', () => {
    it('should replace a single placeholder', () => {
      const template = 'Hello, {{name}}!';
      const variables = { name: 'World' };
      const result = renderTemplate(template, variables);
      expect(result).toBe('Hello, World!');
    });

    it('should replace multiple placeholders', () => {
      const template = '{{greeting}}, {{name}}!';
      const variables = { greeting: 'Hi', name: 'There' };
      const result = renderTemplate(template, variables);
      expect(result).toBe('Hi, There!');
    });

    it('should handle templates with no placeholders', () => {
      const template = 'Just a plain string.';
      const variables = { name: 'World' };
      const result = renderTemplate(template, variables);
      expect(result).toBe('Just a plain string.');
    });

    it('should handle empty string values', () => {
      const template = 'A{{key}}B';
      const variables = { key: '' };
      const result = renderTemplate(template, variables);
      expect(result).toBe('AB');
    });

    it('should leave unmapped placeholders untouched', () => {
      const template = 'Hello, {{name}} and {{unmapped}}!';
      const variables = { name: 'World' };
      const result = renderTemplate(template, variables);
      expect(result).toBe('Hello, World and {{unmapped}}!');
    });

    it('should handle complex templates with multiple variables', () => {
      const template = 'Module: {{module}}, Version: {{version}}, Author: {{author}}';
      const variables = { module: 'vpc-endpoint', version: '1.0.0', author: 'TechPivot' };
      const result = renderTemplate(template, variables);
      expect(result).toBe('Module: vpc-endpoint, Version: 1.0.0, Author: TechPivot');
    });

    it('should handle numeric values as strings', () => {
      const template = 'Port: {{port}}, Count: {{count}}';
      const variables = { port: '8080', count: '3' };
      const result = renderTemplate(template, variables);
      expect(result).toBe('Port: 8080, Count: 3');
    });

    it('should handle special characters in values', () => {
      const template = 'Path: {{path}}, Command: {{cmd}}';
      const variables = { path: '/opt/bin/terraform', cmd: 'terraform init -backend=false' };
      const result = renderTemplate(template, variables);
      expect(result).toBe('Path: /opt/bin/terraform, Command: terraform init -backend=false');
    });

    it('should handle empty template', () => {
      const template = '';
      const variables = { name: 'World' };
      const result = renderTemplate(template, variables);
      expect(result).toBe('');
    });

    it('should handle empty variables object', () => {
      const template = 'Hello, {{name}}!';
      const variables = {};
      const result = renderTemplate(template, variables);
      expect(result).toBe('Hello, {{name}}!');
    });

    it('should handle placeholders with different casing', () => {
      const template = 'Hello, {{Name}} and {{NAME}}!';
      const variables = { Name: 'World', NAME: 'UNIVERSE' };
      const result = renderTemplate(template, variables);
      expect(result).toBe('Hello, World and UNIVERSE!');
    });

    it('should handle placeholders with numbers', () => {
      const template = 'Item {{item1}} and {{item2}}';
      const variables = { item1: 'first', item2: 'second' };
      const result = renderTemplate(template, variables);
      expect(result).toBe('Item first and second');
    });
  });
});
