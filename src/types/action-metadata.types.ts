import type { Config } from '@/types/config.types';

/**
 * Metadata about GitHub Action inputs, including their types, defaults, and mapping to config properties.
 * This serves as the single source of truth for action configuration.
 *
 * @todo update doc - defaults at runtime come from action.yml, testing see helpers/inputs.ts
 */
export interface ActionInputMetadata {
  /** The config property name this input maps to */
  configKey: keyof Config;

  /** Whether this input is required */
  required: boolean;

  /** The input type for proper parsing */
  type: 'string' | 'boolean' | 'number' | 'array';
}
