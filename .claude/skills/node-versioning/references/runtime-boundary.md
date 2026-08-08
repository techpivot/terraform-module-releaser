# The Runtime Boundary: Local Dev vs. GitHub Actions Execution

## How consumers execute this action

When a downstream repository uses `techpivot/terraform-module-releaser@v2`, the runner:

1. Does not run `npm install` — `package.json`, `package-lock.json`, and dependency resolution are ignored
2. Reads `action.yml` and spins up the declared runtime (`runs.using: node24`)
3. Executes the pre-compiled bundle at `dist/index.js` directly on that runtime

Everything a consumer runs was decided at bundle time (`npm run package` via `@vercel/ncc`). The local Node version only
affects development, testing, and bundling speed — never consumer execution.

## Failure modes when the boundary is ignored

- **Missing globals / API errors**: Code using APIs introduced after the runtime major (new `fs`, `stream`, or promise
  methods, new globals) bundles successfully, then throws `ReferenceError`/`TypeError` on consumers' runners — fatal and
  hard to trace back
- **Syntax errors**: Raising `tsconfig.json` `target` to emit syntax the runtime can't parse fails instantly at load
  time on every consumer

## Why `engines.node` stays at the runtime major

- **Type-safety erasure**: An `engines.node: ">=26"` floor legitimizes `@types/node@26`, letting the compiler accept
  post-Node-24 APIs that crash in production. Keeping the floor (and ideally `@types/node`) at the runtime major turns
  those mistakes into compile errors
- **Contributor friction**: Enterprise and self-hosted environments commonly run the current LTS. A floor above the
  runtime major blocks `npm install` and local test runs for contributors whose machines could run this project fine

## Current accepted deviation

`@types/node` is `^26` (newer than the `node24` runtime) and has been since the project started. That trades away the
compile-time guard, so the discipline is behavioral: treat any API newer than Node 24 as unavailable in `src/`.
Downgrading `@types/node` to `^24` would restore the guard and is the preferred direction if type conflicts don't block
it.
