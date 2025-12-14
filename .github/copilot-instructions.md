# Terraform Module Releaser

A GitHub Action written in TypeScript that automates versioning, releases, and documentation for Terraform modules in
monorepos. Creates module-specific Git tags, GitHub releases, PR comments, and comprehensive wiki documentation.

## Tech Stack

- **TypeScript 5.9+** with strict mode
- **Node.js 22+** for local development (`.node-version`); compiles to Node.js 20+ compatible output
- **Vitest** for testing with V8 coverage
- **Biome** for linting/formatting (not ESLint/Prettier)
- **@actions/core** and **@octokit** for GitHub integration

## Essential Commands

```bash
# Format and lint (run before every commit)
npm run check:fix
npm run textlint:fix

# Type checking
npm run typecheck

# Testing
npm run test          # Full test suite (requires GITHUB_TOKEN)
npm run test:watch    # Watch mode for development
```

## GITHUB_TOKEN Setup

Integration tests require a valid GitHub token. Set it in your environment:

```bash
# For current session
export GITHUB_TOKEN="ghp_your_token_here"

# Or create .env file (add to .gitignore)
echo "GITHUB_TOKEN=ghp_your_token_here" > .env
```

Get a token at: https://github.com/settings/tokens (needs `repo` scope for tests)

## Project Structure

```
src/                    # TypeScript source
├── index.ts           # Entry point
├── ...                # Core logic and utilities
└── types/             # Type definitions
__tests__/             # Tests (mirror src/)
tf-modules/            # Example Terraform modules for testing
dist/                  # Compiled output (auto-generated)
```

## Code Standards

**Naming:**

- Functions/variables: `camelCase` (`parseModules`, `tagName`)
- Types/interfaces: `PascalCase` (`TerraformModule`, `WikiConfig`)
- Constants: `UPPER_SNAKE_CASE` (`WIKI_HOME_FILENAME`)

**Style:** Biome enforces all formatting automatically via `npm run check:fix`

## Development Workflow

1. Make changes in `src/`
2. Run `npm run check:fix && npm run textlint:fix` (autofix formatting)
3. Run `npm run typecheck` (verify compilation)
4. Run `npm run test` (ensure tests pass)
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/) format (e.g., `feat:`, `fix:`, `chore:`)

**Commit Format:** We follow Conventional Commits with semantic versioning. Examples: `feat: add new feature`,
`fix: resolve bug`, `chore: update dependencies`

## Testing Notes

- Path aliases: `@/` → `src/`, `@/tests/` → `__tests__/`
- Some tests download terraform-docs binary (requires internet)
- Tests without GITHUB_TOKEN are automatically skipped
- Test modules in `tf-modules/` directory

## Boundaries

✅ **Always do:**

- Run `npm run check:fix` before committing
- Add/update tests for code changes
- Follow TypeScript strict mode
- Use existing patterns in codebase

⚠️ **Ask first:**

- Adding new dependencies
- Changing build configuration
- Modifying GitHub Actions workflows

🚫 **Never do:**

- Commit without running lint/tests
- Modify `dist/` manually (auto-generated)
- Bypass TypeScript strict checks
