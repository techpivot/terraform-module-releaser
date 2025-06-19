import type { Config } from '@/types/config.types';

/**
 * Metadata definition for GitHub Action inputs that enables dynamic configuration mapping.
 *
 * This interface serves as the translation layer between GitHub Action inputs defined in
 * action.yml and our internal Config type. It provides the necessary metadata to:
 * - Parse input values according to their expected types
 * - Map action inputs to the corresponding config property names
 * - Enforce required/optional input validation
 * - Support dynamic config creation in createConfigFromInputs()
 *
 * The metadata is used by the ACTION_INPUTS constant in metadata.ts to create a
 * comprehensive mapping of all action inputs, which then drives the automatic
 * config generation process.
 *
 * @see {@link /workspaces/terraform-module-releaser/src/utils/metadata.ts} for usage
 * @see {@link https://docs.github.com/en/actions/reference/metadata-syntax-for-github-actions#inputs} GitHub Actions input reference
 */
export interface ActionInputMetadata {
  /**
   * The config property name this input maps to.
   * Must be a valid key from the Config interface.
   */
  configKey: keyof Config;

  /**
   * Whether this input is required by the GitHub Action.
   * When true, the action will fail if the input is not provided.
   */
  required: boolean;

  /**
   * The expected data type of the input for proper parsing and validation.
   * - 'string': Direct string value
   * - 'boolean': Parsed using getBooleanInput for proper true/false handling
   * - 'number': Parsed using parseInt for integer conversion
   * - 'array': Comma-separated string parsed into array with deduplication
   */
  type: 'string' | 'boolean' | 'number' | 'array';
}
