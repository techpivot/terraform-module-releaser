import * as main from '@/main';
import { describe, expect, it, vi } from 'vitest';

// Mock the main module's run function
vi.spyOn(main, 'run').mockImplementation(async () => {});

describe('index', () => {
  it('calls run when imported', async () => {
    await import('@/index');
    expect(main.run).toHaveBeenCalled();
  });
});
