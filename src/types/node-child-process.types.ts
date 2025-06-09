/**
 * Error type for command execution failures
 */
export interface ExecSyncError extends Error {
  /**
   * Pid of the child process.
   */
  pid: number;

  /**
   * The exit code of the subprocess, or null if the subprocess terminated due to a signal.
   */
  status: number | null;

  /**
   * The contents of output[1].
   */
  stdout: Buffer | string;

  /**
   * The contents of output[2].
   */
  stderr: Buffer | string;

  /**
   * The signal used to kill the subprocess, or null if the subprocess did not terminate due to a signal.
   */
  signal: string | null;

  /**
   * The error object if the child process failed or timed out.
   */
  error: Error;
}
