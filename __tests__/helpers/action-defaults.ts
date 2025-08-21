import * as fs from 'node:fs';
import * as path from 'node:path';
import { ACTION_INPUTS } from '@/utils/metadata';
import * as yaml from 'js-yaml';

/**
 * Interface for action.yml structure
 */
interface ActionYml {
  inputs: Record<
    string,
    {
      description: string;
      required: boolean;
      default?: string;
    }
  >;
}

/**
 * Gets action defaults from action.yml file.
 * Returns a record of all input names to their default values (or undefined if no default).
 */
/**
 * Extracts default values for GitHub Action inputs from action.yml file.
 *
 * This function reads the action.yml file from the current working directory,
 * parses its content, and retrieves the default values for all inputs defined
 * in ACTION_INPUTS.
 *
 * @returns A record mapping each input name to its default value from the action.yml file.
 *          If an input has no default value, its entry will contain undefined.
 */
export function getActionDefaults(): Record<string, string | undefined> {
  const actionYmlPath = path.join(process.cwd(), 'action.yml');
  const actionYmlContent = fs.readFileSync(actionYmlPath, 'utf8');
  const actionYml = yaml.load(actionYmlContent) as ActionYml;

  const defaults: Record<string, string | undefined> = {};

  // Process all inputs from ACTION_INPUTS to ensure we have entries for all inputs
  for (const [inputName] of Object.entries(ACTION_INPUTS)) {
    const actionInput = actionYml.inputs[inputName];
    defaults[inputName] = actionInput?.default;
  }

  return defaults;
}
