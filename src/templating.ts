/**
 * Renders a template string by replacing placeholders with provided values.
 *
 * @param template The template string containing placeholders in the format `{{key}}`.
 * @param variables An object where keys correspond to placeholder names and values are their replacements.
 * @returns The rendered string with placeholders replaced.
 */
export const render = (template: string, variables: Record<string, any>): string => {
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, key) => {
    return variables.hasOwnProperty(key) ? variables[key] : placeholder;
  });
};
