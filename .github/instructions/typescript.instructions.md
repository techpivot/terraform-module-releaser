---
applyTo: "src/**/*.ts"
---

## TypeScript Source Guidelines

This project uses TypeScript 5.9+ with strict mode and ES modules (`"type": "module"`).

### Module Patterns

- Use ES module imports/exports exclusively (`import`/`export`, never `require`)
- Path aliases: `@/` maps to `src/` — use `@/config`, `@/context`, etc. for internal imports
- Reexport types through `src/types/index.ts`

### Config and Context Singletons

- `config` and `context` are Proxy-based singletons with lazy initialization
- Import them at module scope: `import { config } from '@/config'` — safe because Proxy defers init
- Config must initialize before Context (Context reads `config.githubToken`)
- Both expose `clearForTesting()` for test cleanup

### Coding Standards

- Functions/variables: `camelCase` — Types/interfaces: `PascalCase` — Constants: `UPPER_SNAKE_CASE`
- All constants live in `src/utils/constants.ts`
- Use `@actions/core` for logging (`core.info()`, `core.debug()`, `core.warning()`)
- Use `@actions/core` for action outputs (`core.setOutput()`) and failure (`core.setFailed()`)
- Prefer async/await over raw promises
- Error handling: catch and wrap with `core.setFailed()` at top level only

### Formatting

- **Biome** enforces all TS/JS formatting — run `npm run check:fix` to autoformat
- 120-char line width, 2-space indent, LF line endings
- Single quotes, trailing commas, semicolons always
