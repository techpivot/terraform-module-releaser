---
name: action-inputs
description:
  Add, rename, remove, or change a GitHub Action input. Keeps action.yml, input metadata, config types, README, and
  tests in sync.
---

# Changing Action Inputs

Action inputs are defined in `action.yml` and flow through a metadata registry into the typed config singleton. Every
input change touches these files in the same commit — a missed one fails `metadata.test.ts` or ships an input that
silently does nothing.

## Checklist

1. `action.yml` — add/update the input: description, `required`, `default`
2. `src/utils/metadata.ts` — `ACTION_INPUTS` entry mapping the kebab-case input name to its camelCase config key; use
   the factory helpers (`requiredString`, `requiredBoolean`, `requiredArray`, `requiredNumber`, `optionalArray`)
3. `src/types/config.types.ts` — add the camelCase key to the `Config` interface (re-exported via `src/types/index.ts`)
4. `src/config.ts` — add validation if the input has constrained values (e.g., allowed separators, enum-like modes)
5. Wire the value into the consuming code path
6. `README.md` — update the Input Parameters table; extend the example configuration if the input is worth showcasing
7. Tests:
   - `__tests__/utils/metadata.test.ts` — update the expected input registry
   - `__tests__/helpers/inputs.ts` — update the categorized input arrays (`booleanInputs`, `arrayInputs`, …) if the
     input's type category changed
   - Defaults flow automatically from `action.yml` via `__tests__/helpers/action-defaults.ts` — no hardcoding
   - Add behavior tests for the new code path

## Removing or renaming

Same checklist in reverse — plus search for the old kebab-case and camelCase names across `src/`, `__tests__/`,
`README.md`, and `docs/` to catch stragglers. Renames are breaking for consumers; call them out in release notes.

## Validate

```bash
npm run typecheck && npm run test && npm run check:fix
```
