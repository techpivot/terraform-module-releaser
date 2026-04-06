import type { WIKI_STATUS } from '@/utils/constants';

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
 * Represents the result of a wiki status check for a Terraform module release.
 *
 * Provides the overall status plus optional error details for rendering in PR comments
 * and for failing the action when appropriate.
 */
export interface WikiStatusResult {
  /** The status of the wiki operation. */
  status: WikiStatus;

  /**
   * Human-readable error message set for any failure status.
   * Present when status is `FAILURE_CHECKOUT` or `FAILURE_TERRAFORM_DOCS`.
   * Used to fail the GitHub Action after posting the PR comment.
   */
  errorMessage?: string;

  /**
   * Map of module names to terraform-docs errors for display in the PR comment.
   * Only present when status is `FAILURE_TERRAFORM_DOCS`.
   */
  terraformDocsErrors?: Map<string, string>;
}

/**
 * Represents the result of wiki file generation.
 *
 * Contains both the list of successfully generated files and a map of
 * per-module errors for modules where terraform-docs generation failed.
 */
export interface WikiGenerationResult {
  /** Paths of all successfully generated wiki files. */
  updatedFiles: string[];

  /** Map of moduleName → error message for modules that failed terraform-docs generation. */
  moduleErrors: Map<string, string>;
}
