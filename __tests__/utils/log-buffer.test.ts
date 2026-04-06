import { bufferedError, bufferedInfo, withBufferedLogs } from '@/utils/log-buffer';
import { error, info } from '@actions/core';
import { describe, expect, it, vi } from 'vitest';

describe('log-buffer', () => {
  describe('bufferedInfo()', () => {
    it('should call info() immediately when not inside withBufferedLogs', () => {
      bufferedInfo('direct message');
      expect(info).toHaveBeenCalledWith('direct message');
    });

    it('should buffer messages when inside withBufferedLogs', async () => {
      vi.mocked(info).mockClear();

      await withBufferedLogs(async () => {
        bufferedInfo('buffered message');
        // Should NOT have been called yet — still buffered
        expect(info).not.toHaveBeenCalledWith('buffered message');
      });

      // After withBufferedLogs completes, message should be flushed
      expect(info).toHaveBeenCalledWith('buffered message');
    });
  });

  describe('bufferedError()', () => {
    it('should call error() immediately when not inside withBufferedLogs', () => {
      bufferedError('direct error');
      expect(error).toHaveBeenCalledWith('direct error');
    });

    it('should buffer error messages when inside withBufferedLogs', async () => {
      vi.mocked(error).mockClear();

      await withBufferedLogs(async () => {
        bufferedError('buffered error');
        expect(error).not.toHaveBeenCalledWith('buffered error');
      });

      expect(error).toHaveBeenCalledWith('buffered error');
    });
  });

  describe('withBufferedLogs()', () => {
    it('should flush all buffered messages in order after fn resolves', async () => {
      vi.mocked(info).mockClear();

      await withBufferedLogs(async () => {
        bufferedInfo('first');
        bufferedInfo('second');
        bufferedInfo('third');
      });

      const calls = vi.mocked(info).mock.calls.map((c) => c[0]);
      expect(calls).toEqual(['first', 'second', 'third', '']);
    });

    it('should return the value from the wrapped function', async () => {
      const result = await withBufferedLogs(async () => {
        bufferedInfo('log line');
        return 42;
      });

      expect(result).toBe(42);
    });

    it('should append trailing blank line for readability', async () => {
      vi.mocked(info).mockClear();

      await withBufferedLogs(async () => {
        bufferedInfo('message');
      });

      const calls = vi.mocked(info).mock.calls.map((c) => c[0]);
      // Last call should be the trailing blank line
      expect(calls.at(-1)).toBe('');
    });

    it('should not append trailing blank line when buffer is empty', async () => {
      vi.mocked(info).mockClear();

      await withBufferedLogs(async () => {
        // No bufferedInfo calls
      });

      expect(info).not.toHaveBeenCalled();
    });

    it('should isolate buffers between parallel invocations', async () => {
      vi.mocked(info).mockClear();

      const callOrder: string[] = [];
      vi.mocked(info).mockImplementation((msg: string | Error) => {
        callOrder.push(String(msg));
      });

      await Promise.all([
        withBufferedLogs(async () => {
          bufferedInfo('A-1');
          // Simulate async work to allow interleaving
          await Promise.resolve();
          bufferedInfo('A-2');
        }),
        withBufferedLogs(async () => {
          bufferedInfo('B-1');
          await Promise.resolve();
          bufferedInfo('B-2');
        }),
      ]);

      // Each group's messages should be contiguous (not interleaved)
      const aStart = callOrder.indexOf('A-1');
      const aEnd = callOrder.indexOf('A-2');
      const bStart = callOrder.indexOf('B-1');
      const bEnd = callOrder.indexOf('B-2');

      // A's messages should be consecutive (with trailing blank)
      expect(aEnd).toBe(aStart + 1);
      // B's messages should be consecutive (with trailing blank)
      expect(bEnd).toBe(bStart + 1);

      // Groups should not overlap: either A finishes before B starts, or vice versa
      const aGroupEnd = aEnd + 1; // trailing blank line
      const bGroupEnd = bEnd + 1;
      const aBeforeB = aGroupEnd <= bStart;
      const bBeforeA = bGroupEnd <= aStart;
      expect(aBeforeB || bBeforeA).toBe(true);
    });

    it('should flush messages even when fn throws', async () => {
      vi.mocked(info).mockClear();

      await expect(
        withBufferedLogs(async () => {
          bufferedInfo('before error');
          throw new Error('test error');
        }),
      ).rejects.toThrow('test error');

      // Buffer is flushed even on error so diagnostic logs are visible
      expect(info).toHaveBeenCalledWith('before error');
      // No trailing blank line on error — keeps error grouped with its module's output
      expect(info).not.toHaveBeenCalledWith('');
    });

    it('should flush error-level messages via core.error()', async () => {
      vi.mocked(info).mockClear();
      vi.mocked(error).mockClear();

      await withBufferedLogs(async () => {
        bufferedInfo('info line');
        bufferedError('error line');
      });

      expect(info).toHaveBeenCalledWith('info line');
      expect(error).toHaveBeenCalledWith('error line');
      // No trailing blank when buffer contains errors (Actions adds spacing after ::error::)
      expect(info).not.toHaveBeenCalledWith('');
    });

    it('should support nested withBufferedLogs with separate buffers', async () => {
      vi.mocked(info).mockClear();

      const callOrder: string[] = [];
      vi.mocked(info).mockImplementation((msg: string | Error) => {
        callOrder.push(String(msg));
      });

      await withBufferedLogs(async () => {
        bufferedInfo('outer-1');

        await withBufferedLogs(async () => {
          bufferedInfo('inner-1');
          bufferedInfo('inner-2');
        });

        bufferedInfo('outer-2');
      });

      // Inner flushes first (within outer's execution), then outer flushes
      // Inner messages go to the outer buffer since AsyncLocalStorage.run creates a new store
      // that shadows the outer one — inner flush calls info() which the outer buffer captures
      expect(callOrder).toContain('inner-1');
      expect(callOrder).toContain('inner-2');
      expect(callOrder).toContain('outer-1');
      expect(callOrder).toContain('outer-2');
    });
  });
});
