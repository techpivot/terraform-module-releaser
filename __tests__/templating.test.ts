import { describe, it, expect } from 'vitest';
import { render } from '../src/templating';

describe('templating', () => {
  it('should replace a single placeholder', () => {
    const template = 'Hello, {{name}}!';
    const variables = { name: 'World' };
    const result = render(template, variables);
    expect(result).toBe('Hello, World!');
  });

  it('should replace multiple placeholders', () => {
    const template = '{{greeting}}, {{name}}!';
    const variables = { greeting: 'Hi', name: 'There' };
    const result = render(template, variables);
    expect(result).toBe('Hi, There!');
  });

  it('should handle templates with no placeholders', () => {
    const template = 'Just a plain string.';
    const variables = { name: 'World' };
    const result = render(template, variables);
    expect(result).toBe('Just a plain string.');
  });

  it('should handle empty string values', () => {
    const template = 'A{{key}}B';
    const variables = { key: '' };
    const result = render(template, variables);
    expect(result).toBe('AB');
  });

  it('should leave unmapped placeholders untouched', () => {
    const template = 'Hello, {{name}} and {{unmapped}}!';
    const variables = { name: 'World' };
    const result = render(template, variables);
    expect(result).toBe('Hello, World and {{unmapped}}!');
  });
});
