import {
  getExecErrorMessage,
  getModuleSource,
  removeLeadingCharacters,
  removeTrailingCharacters,
  renderTemplate,
} from '@/utils/string';
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
    const renderTemplateCases: Array<{
      name: string;
      template: string;
      variables: Record<string, string | undefined | null>;
      expected: string;
    }> = [
      // Basic replacement
      {
        name: 'replaces a single placeholder',
        template: 'Hello, {{name}}!',
        variables: { name: 'World' },
        expected: 'Hello, World!',
      },
      {
        name: 'replaces multiple placeholders',
        template: '{{greeting}}, {{name}}!',
        variables: { greeting: 'Hi', name: 'There' },
        expected: 'Hi, There!',
      },
      {
        name: 'handles templates with no placeholders',
        template: 'Just a plain string.',
        variables: { name: 'World' },
        expected: 'Just a plain string.',
      },
      { name: 'handles empty string values', template: 'A{{key}}B', variables: { key: '' }, expected: 'AB' },
      {
        name: 'leaves unmapped placeholders untouched',
        template: 'Hello, {{name}} and {{unmapped}}!',
        variables: { name: 'World' },
        expected: 'Hello, World and {{unmapped}}!',
      },
      {
        name: 'handles complex templates with multiple variables',
        template: 'Module: {{module}}, Version: {{version}}, Author: {{author}}',
        variables: { module: 'vpc-endpoint', version: '1.0.0', author: 'TechPivot' },
        expected: 'Module: vpc-endpoint, Version: 1.0.0, Author: TechPivot',
      },
      {
        name: 'handles numeric values as strings',
        template: 'Port: {{port}}, Count: {{count}}',
        variables: { port: '8080', count: '3' },
        expected: 'Port: 8080, Count: 3',
      },
      {
        name: 'handles special characters in values',
        template: 'Path: {{path}}, Command: {{cmd}}',
        variables: { path: '/opt/bin/terraform', cmd: 'terraform init -backend=false' },
        expected: 'Path: /opt/bin/terraform, Command: terraform init -backend=false',
      },
      { name: 'handles empty template', template: '', variables: { name: 'World' }, expected: '' },
      {
        name: 'handles empty variables object',
        template: 'Hello, {{name}}!',
        variables: {},
        expected: 'Hello, {{name}}!',
      },
      {
        name: 'handles placeholders with different casing',
        template: 'Hello, {{Name}} and {{NAME}}!',
        variables: { Name: 'World', NAME: 'UNIVERSE' },
        expected: 'Hello, World and UNIVERSE!',
      },
      {
        name: 'handles placeholders with numbers',
        template: 'Item {{item1}} and {{item2}}',
        variables: { item1: 'first', item2: 'second' },
        expected: 'Item first and second',
      },
      // Undefined and null values leave placeholders unchanged
      {
        name: 'leaves placeholders with undefined values unchanged',
        template: 'Hello, {{name}} and {{greeting}}!',
        variables: { name: 'World', greeting: undefined },
        expected: 'Hello, World and {{greeting}}!',
      },
      {
        name: 'leaves all placeholders unchanged when every value is undefined',
        template: '{{greeting}}, {{name}}!',
        variables: { greeting: undefined, name: undefined },
        expected: '{{greeting}}, {{name}}!',
      },
      {
        name: 'handles mixed defined and undefined values',
        template: 'Module: {{module}}, Version: {{version}}, Author: {{author}}',
        variables: { module: 'vpc-endpoint', version: undefined, author: 'TechPivot' },
        expected: 'Module: vpc-endpoint, Version: {{version}}, Author: TechPivot',
      },
      {
        name: 'distinguishes empty string from undefined',
        template: 'A{{key1}}B{{key2}}C',
        variables: { key1: '', key2: undefined },
        expected: 'AB{{key2}}C',
      },
      {
        name: 'handles undefined values in complex templates',
        template: 'Path: {{path}}, Command: {{cmd}}, Options: {{opts}}',
        variables: { path: '/opt/bin/terraform', cmd: undefined, opts: '--verbose' },
        expected: 'Path: /opt/bin/terraform, Command: {{cmd}}, Options: --verbose',
      },
      {
        name: 'leaves placeholders with null values unchanged',
        template: 'Hello, {{name}} and {{greeting}}!',
        variables: { name: 'World', greeting: null },
        expected: 'Hello, World and {{greeting}}!',
      },
      {
        name: 'leaves all placeholders unchanged when every value is null',
        template: '{{greeting}}, {{name}}!',
        variables: { greeting: null, name: null },
        expected: '{{greeting}}, {{name}}!',
      },
      {
        name: 'handles mixed null, undefined, and defined values',
        template: 'Module: {{module}}, Version: {{version}}, Author: {{author}}, License: {{license}}',
        variables: { module: 'vpc-endpoint', version: null, author: 'TechPivot', license: undefined },
        expected: 'Module: vpc-endpoint, Version: {{version}}, Author: TechPivot, License: {{license}}',
      },
      {
        name: 'distinguishes empty string from null and undefined',
        template: 'A{{key1}}B{{key2}}C{{key3}}D',
        variables: { key1: '', key2: null, key3: undefined },
        expected: 'AB{{key2}}C{{key3}}D',
      },
    ];

    it.each(renderTemplateCases)('$name', ({ template, variables, expected }) => {
      expect(renderTemplate(template, variables)).toBe(expected);
    });
  });

  describe('getModuleSource()', () => {
    it('should return HTTPS format with git:: prefix', () => {
      expect(getModuleSource('https://github.com/owner/repo', false)).toBe('git::https://github.com/owner/repo.git');
    });

    it('should return SSH format with git:: prefix', () => {
      expect(getModuleSource('https://github.com/owner/repo', true)).toBe('git::ssh://git@github.com/owner/repo.git');
    });

    it('should handle custom GitHub Enterprise hostnames for SSH', () => {
      expect(getModuleSource('https://github.techpivot.com/owner/repo', true)).toBe(
        'git::ssh://git@github.techpivot.com/owner/repo.git',
      );
    });

    it('should handle custom GitHub Enterprise hostnames for HTTPS', () => {
      expect(getModuleSource('https://github.techpivot.com/owner/repo', false)).toBe(
        'git::https://github.techpivot.com/owner/repo.git',
      );
    });
  });

  describe('getExecErrorMessage()', () => {
    it('should return message from an Error instance', () => {
      expect(getExecErrorMessage(new Error('git clone failed'))).toBe('git clone failed');
    });

    it('should coerce non-Error values to string', () => {
      expect(getExecErrorMessage('string error')).toBe('string error');
      expect(getExecErrorMessage(42)).toBe('42');
    });

    it('should append stderr string when present', () => {
      const err = Object.assign(new Error('Command failed'), { stderr: 'fatal: not a git repo' });
      expect(getExecErrorMessage(err)).toBe('Command failed\nfatal: not a git repo');
    });

    it('should decode stderr Buffer and append it', () => {
      const err = Object.assign(new Error('Command failed'), { stderr: Buffer.from('fatal: repository not found') });
      expect(getExecErrorMessage(err)).toBe('Command failed\nfatal: repository not found');
    });

    it('should omit stderr when it is an empty string', () => {
      const err = Object.assign(new Error('Command failed'), { stderr: '' });
      expect(getExecErrorMessage(err)).toBe('Command failed');
    });

    it('should omit stderr when it is an empty Buffer', () => {
      const err = Object.assign(new Error('Command failed'), { stderr: Buffer.from('') });
      expect(getExecErrorMessage(err)).toBe('Command failed');
    });

    it('should handle errors with no stderr property', () => {
      const err = new Error('Repository not found');
      expect(getExecErrorMessage(err)).toBe('Repository not found');
    });

    it('should trim the resulting message', () => {
      const err = Object.assign(new Error('Command failed'), { stderr: Buffer.from('  stderr output  ') });
      expect(getExecErrorMessage(err)).toBe('Command failed\n  stderr output');
    });
  });
});
