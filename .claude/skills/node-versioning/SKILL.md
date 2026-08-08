---
name: node-versioning
description:
  Keeps every Node.js version reference — .node-version, devcontainer image, engines.node, @types/node, and the
  action.yml runtime — pinned to the same major. Use before touching any of them.
---

# Node.js Versioning

Canonical knowledge lives in [docs/node.md](../../../docs/node.md) — read it first. Alignment is enforced by
`__tests__/devcontainer.test.ts`; if that test fails, versions drifted.

Parity policy: every Node reference pins to the GitHub Actions runtime major (currently 24). Nothing moves independently
— the whole set advances together, as a breaking major release, when GitHub ships a new runtime.

## Version Map

| Reference                               | Value                    | Notes                                                 |
| --------------------------------------- | ------------------------ | ----------------------------------------------------- |
| `action.yml` → `runs.using`             | `node24`                 | The anchor — GitHub executes `dist/` on this          |
| `package.json` → `engines.node`         | `>=24`                   | Floor equals the runtime major                        |
| `@types/node`                           | `^24`                    | Same major — the compile-time guard                   |
| `tsconfig.json` → `target`              | `ES2024`                 | Bounded by the runtime's V8 (`@tsconfig/node24` base) |
| `.node-version`                         | `24`                     | Same major; bare major floats to the latest 24.x      |
| `.devcontainer/devcontainer.json` image | `javascript-node:24-...` | Tag major matches `.node-version`; update `name` too  |

## Staying Fresh Within the Line

No manual maintenance:

- `.node-version` holds a bare major, so `actions/setup-node`, nvm, and fnm resolve the newest 24.x automatically
- `@types/node` minors/patches arrive through dependabot's weekly dev group; only its semver-major is excluded
  (`.github/dependabot.yml`) until the runtime moves
- The devcontainer image tag picks up new Node patches whenever Microsoft rebuilds the image

## Bumping Node (only when GitHub ships a new runtime — breaking major release)

1. Confirm the new `nodeXX` runtime exists and is supported:
   <https://docs.github.com/en/actions/creating-actions/metadata-syntax-for-github-actions#runs-for-javascript-actions>
1. Move everything in one change: `action.yml` `runs.using`, `engines.node` floor, `@types/node` major, `.node-version`,
   and the devcontainer `image` tag + `name` label (verify the `javascript-node:<major>-<distro>` tag exists on
   mcr.microsoft.com first)
1. Review `tsconfig.json` `target`/`lib` against the new runtime's V8 — check the official `@tsconfig/nodeXX` base
1. Rebuild and validate: `npm run package && npm run test && npm run check && npm run textlint` — the guard test fails
   until every reference agrees
1. Update `docs/node.md` (version map, runtime background, GHES minimums), `README.md` (GHES requirements),
   `CONTRIBUTING.md`, and `docs/development.md`
1. Ship as a major release; call out the runtime change and minimum GHES version in the notes

## Guardrails

- Never bump `.node-version` or the devcontainer image ahead of the runtime — parity is the policy, and the guard test
  fails on drift
- Never add the `ghcr.io/devcontainers/features/node` feature — the image ships Node via nvm first on `PATH`, so a
  feature-installed Node silently shadows it
- Keep the dependabot `@types/node` semver-major exclusion; removing it reopens silent post-runtime API risk
