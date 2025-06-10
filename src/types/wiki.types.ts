import type { WIKI_STATUS } from '@/utils/constants';
import type { ExecSyncError } from './node-child-process.types';

/**
 * Represents the status of wiki operations.
 *
 * This type is derived from the `WIKI_STATUS` constant object,
 * ensuring that only valid predefined wiki statuses can be used.
 *
 * @see {@link WIKI_STATUS} for the available wiki status values
 */
export type WikiStatus = (typeof WIKI_STATUS)[keyof typeof WIKI_STATUS];

/**
 * Represents the result of a wiki checkout status operation for a Terraform module.
 *
 * Provides details about the outcome of a wiki update or check, including status,
 * error information, and a human-readable error summary if applicable.
 */
export interface WikiStatusResult {
  /**
   * The status of the wiki operation (e.g., 'success', 'skipped', 'failed').
   */
  status: WikiStatus;

  /**
   * Optional ExecSyncError object if the operation failed during git operations.
   *
   * This error is specifically from execFileSync calls in the wiki checkout process.
   */
  error?: ExecSyncError;

  /**
   * Optional human-readable summary of the error, if present (First line).
   */
  errorSummary?: string;
}
