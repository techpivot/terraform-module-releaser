import { AsyncLocalStorage } from 'node:async_hooks';
import { error, info } from '@actions/core';

type BufferedMessage = { msg: string; level: 'info' | 'error' };

const logStorage = new AsyncLocalStorage<BufferedMessage[]>();

/**
 * Logs a message via `core.info()`. If called inside `withBufferedLogs()`,
 * the message is buffered and flushed when the async scope completes.
 * Otherwise, it writes immediately.
 */
export function bufferedInfo(msg: string): void {
  const buffer = logStorage.getStore();
  if (buffer) {
    buffer.push({ msg, level: 'info' });
  } else {
    info(msg);
  }
}

/**
 * Logs an error via `core.error()`. If called inside `withBufferedLogs()`,
 * the message is buffered and flushed as a red error annotation when the
 * async scope completes. Otherwise, it writes immediately.
 */
export function bufferedError(msg: string): void {
  const buffer = logStorage.getStore();
  if (buffer) {
    buffer.push({ msg, level: 'error' });
  } else {
    error(msg);
  }
}

/**
 * Runs `fn` with log buffering enabled. All `bufferedInfo()` and
 * `bufferedError()` calls inside `fn` (including nested async calls)
 * are collected and flushed after `fn` resolves. Each async invocation
 * gets its own isolated buffer, so parallel calls don't interleave.
 */
export async function withBufferedLogs<T>(fn: () => Promise<T>): Promise<T> {
  const buffer: BufferedMessage[] = [];
  let success = false;
  try {
    const result = await logStorage.run(buffer, fn);
    success = true;
    return result;
  } finally {
    for (const { msg, level } of buffer) {
      if (level === 'error') {
        error(msg);
      } else {
        info(msg);
      }
    }
    // Trailing blank line separates each module's output — skip when the buffer
    // contains errors since GitHub Actions already adds spacing after ::error:: lines.
    const hasErrors = buffer.some((entry) => entry.level === 'error');
    if (buffer.length > 0 && success && !hasErrors) {
      info('');
    }
  }
}
