import type { AnnotationProperties, ExitCode, InputOptions } from 'node_modules/@actions/core';
import { vi } from 'vitest';
import type { Mock } from 'vitest';

// Import the actual module
const actual = await vi.importActual<typeof import('node_modules/@actions/core')>('@actions/core');

// Strictly typed MockedFunction helper that only applies to function types
type MockedFunction<TFunc> = TFunc extends (...args: infer TArgs) => infer TReturn
  ? Mock<(...args: TArgs) => TReturn> & TFunc
  : never;

/**
 * Writes a debug message to the user log.
 * @param message - The debug message to log.
 */
export const debug: MockedFunction<(message: string) => void> = vi.fn((message: string): void => {});

/**
 * Writes an informational message to the log.
 * @param message - The info message to log.
 */
export const info: MockedFunction<(message: string) => void> = vi.fn((message: string): void => {});

/**
 * Adds a warning issue with optional annotation properties.
 * @param message - The warning message or error.
 * @param properties - Optional properties to add to the annotation.
 */
export const warning: MockedFunction<(message: string | Error, properties?: AnnotationProperties) => void> = vi.fn(
  (message: string | Error, properties?: AnnotationProperties): void => {},
);

/**
 * Adds a notice issue with optional annotation properties.
 * @param message - The notice message or error.
 * @param properties - Optional properties to add to the annotation.
 */
export const notice: MockedFunction<(message: string | Error, properties?: AnnotationProperties) => void> = vi.fn(
  (message: string | Error, properties?: AnnotationProperties): void => {},
);

/**
 * Adds an error issue with optional annotation properties.
 * @param message - The error message or error.
 * @param properties - Optional properties to add to the annotation.
 */
export const error: MockedFunction<(message: string | Error, properties?: AnnotationProperties) => void> = vi.fn(
  (message: string | Error, properties?: AnnotationProperties): void => {},
);

/**
 * Sets the action status to failed.
 * When the action exits it will be with an exit code of 1.
 * @param message - The error message or object.
 * @throws An error with the specified message.
 */
export const setFailed: MockedFunction<(message: string | Error) => void> = vi.fn((message: string | Error) => {});

/**
 * Begins a new output group. Output until the next `endGroup` will be foldable in this group.
 * @param name - The name of the output group.
 */
export const startGroup: MockedFunction<(name: string) => void> = vi.fn((name: string): void => {});

/**
 * Ends the current output group.
 */
export const endGroup: MockedFunction<() => void> = vi.fn((): void => {});

/**
 * Gets the value of an input. Will return an empty string if the input is not defined.
 * @param name - Name of the input to get
 * @param options - Optional. See InputOptions.
 * @returns string
 */
export const getInput: MockedFunction<(name: string, options?: InputOptions) => string> = vi.fn(
  (name: string, options?: InputOptions): string => {
    return actual.getInput(name, options);
  },
);

/**
 * Gets the input value of the boolean type in the YAML 1.2 "core schema" specification.
 * Supported boolean input list: `true | True | TRUE | false | False | FALSE`
 * @param name - Name of the input to get
 * @param options - Optional. See InputOptions.
 * @returns boolean
 */
export const getBooleanInput: MockedFunction<(name: string, options?: InputOptions) => boolean> = vi.fn(
  (name: string, options?: InputOptions): boolean => {
    return actual.getBooleanInput(name, options);
  },
);

/**
 * Gets the values of an multiline input. Each value will be trimmed.
 * @param name - Name of the input to get
 * @param options - Optional. See InputOptions.
 * @returns string[]
 */
export const getMultilineInput: MockedFunction<(name: string, options?: InputOptions) => string[]> = vi.fn(
  (name: string, options?: InputOptions): string[] => {
    return actual.getMultilineInput(name, options);
  },
);

/**
 * Masks a value in the log. When the masked value appears in the log, it is replaced with asterisks.
 * @param secret - Value to mask
 */
export const setSecret: MockedFunction<(secret: string) => void> = vi.fn((secret: string): void => {});

/**
 * Prepends the given path to the PATH environment variable.
 * @param inputPath - Path to prepend
 */
export const addPath: MockedFunction<(inputPath: string) => void> = vi.fn((inputPath: string): void => {});

/**
 * Sets env variable for this action and future actions in the job.
 * @param name - Name of the variable to set
 * @param val - Value of the variable
 */
export const exportVariable: MockedFunction<(name: string, val: string) => void> = vi.fn(
  (name: string, val: string): void => {},
);

/**
 * Enables or disables the echoing of commands into stdout for the rest of the step.
 * @param enabled - True to enable echoing, false to disable
 */
export const setCommandEcho: MockedFunction<(enabled: boolean) => void> = vi.fn((enabled: boolean): void => {});

/**
 * Begin an output group.
 * @param name - Name of the output group
 * @param fn - Function to execute within the output group
 */
export const group: MockedFunction<(name: string, fn: () => Promise<void>) => Promise<void>> = vi.fn(
  async (name: string, fn: () => Promise<void>): Promise<void> => {
    await fn();
  },
);

/**
 * Saves state for current action.
 * The state can only be retrieved by this action's post job execution.
 * @param name - Name of the state to store
 * @param value - Value to store. Non-string values will be converted to a string via JSON.stringify
 */
export const saveState: MockedFunction<(name: string, value: string) => void> = vi.fn(
  (name: string, value: string): void => {},
);

/**
 * Gets the value of an state set by this action's main execution.
 * @param name - Name of the state to get
 * @returns string
 */
export const getState: MockedFunction<(name: string) => string> = vi.fn((name: string): string => '');

/**
 * Gets whether Actions Step Debug is on or not
 * @returns boolean
 */
export const isDebug: MockedFunction<() => boolean> = vi.fn((): boolean => false);

/**
 * Gets the value of an OIDC token from the GitHub Actions runtime
 * @param audience - Optional audience for the token
 * @returns string
 */
export const getIDToken: MockedFunction<(audience?: string) => Promise<string>> = vi.fn(
  async (audience?: string): Promise<string> => '',
);

/**
 * Sets the value of an output.
 * @param name - Name of the output to set
 * @param value - Value to store. Non-string values will be converted to a string via JSON.stringify
 */
export const setOutput: MockedFunction<(name: string, value: string) => void> = vi.fn(
  (name: string, value: string): void => {},
);

// Re-export types
export type { InputOptions, AnnotationProperties };
export type { ExitCode };
