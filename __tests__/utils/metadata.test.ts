import { createConfigFromInputs } from '@/utils/metadata';
import { getInput } from '@actions/core';
import { describe, expect, it, vi } from 'vitest';

describe('utils/metadata', () => {
  it('should throw a custom error if getInput fails', () => {
    const errorMessage = 'Input retrieval failed';
    vi.mocked(getInput).mockImplementation(() => {
      throw new Error(errorMessage);
    });

    expect(() => createConfigFromInputs()).toThrow(`Failed to process input 'major-keywords': ${errorMessage}`);
  });

  it('should handle non-Error objects thrown during input processing', () => {
    const errorObject = 'A plain string error';
    vi.mocked(getInput).mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw errorObject;
    });

    expect(() => createConfigFromInputs()).toThrow(`Failed to process input 'major-keywords': ${String(errorObject)}`);
  });
});
