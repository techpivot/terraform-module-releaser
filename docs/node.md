# Node.js Version Policy

**One Node major everywhere — the GitHub Actions runtime major (currently 24).**

| Reference                                        | Value                       |
| ------------------------------------------------ | --------------------------- |
| `action.yml` → `runs.using` (production runtime) | `node24`                    |
| `package.json` → `engines.node`                  | `>=24`                      |
| `@types/node`                                    | `^24`                       |
| `tsconfig.json` → `target`                       | `ES2024`                    |
| `.node-version` (local dev + CI)                 | `24`                        |
| Devcontainer image                               | `javascript-node:24-trixie` |

The runtime declared in `action.yml` is the anchor: it is what GitHub actually executes, so every other reference pins
to its major. Development, CI, and consumers all run the same Node line — what you test is exactly what ships — chosen
for simplicity and dev/prod parity over chasing the newest line. The whole set moves together, as a breaking major
release, only when GitHub ships a new runtime. `__tests__/devcontainer.test.ts` enforces the alignment; the upgrade
checklist lives in the [node-versioning skill](../.claude/skills/node-versioning/SKILL.md).

## How GitHub executes this action

When a downstream repository uses `techpivot/terraform-module-releaser@v2`, the GitHub Actions runner:

1. Never runs `npm install` — `package.json`, `package-lock.json`, and dependency resolution are ignored entirely
1. Reads `action.yml` and boots the runtime declared there (`runs.using: node24`), a Node build shipped with the runner
   itself
1. Executes the pre-compiled bundle at `dist/index.js` directly on that runtime

Everything a consumer runs was decided at bundle time (`npm run package` via `@vercel/ncc`). The runner's `node24` is
the single hard requirement the published artifact must satisfy, and `package.json` → `engines.node: ">=24"` mirrors it.

## Runtime background (facts as of August 2026)

- The runner ships its own Node builds under `<runner_root>/externals/` — runner v2.336.0 bundles Node 24.18 for
  `node24`. `runs.using` accepts only `node20` and `node24`, and **`node24` is the only non-deprecated choice**: Node 20
  actions were default-migrated onto Node 24 on 2026-06-16, with full removal planned for fall 2026
- GitHub adopts every other even Node LTS line for action runtimes (`node12` → `node16` → `node20` → `node24`). No
  `node26` runtime exists or has been announced; by cadence the next runtime is likely `node28` around Node 24's 2028
  end-of-life. This project cannot move past 24 until GitHub ships a newer runtime
- Node release lines: **24 "Krypton"** — Active LTS, maintenance from 2026-10, end-of-life 2028-04 (the line everything
  here runs); **26 "Lithium"** — Current since 2026-05, enters LTS 2026-10 (no Actions runtime exists for it); 25 — odd
  line, already end-of-life
- The official [@tsconfig/node24](https://github.com/tsconfig/bases) base sets `target: "es2024"` — this repository's
  tsconfig matches it (module settings differ deliberately because `@vercel/ncc` bundles the output)
- GHES: `node24` actions require GitHub Enterprise Server 3.16+ with runners v2.327.1 or newer; GHES 3.19+ already
  enforces a compatible minimum runner version

## Failure modes the policy prevents

When development runs a newer Node than the production runtime, two silent failures become possible:

- **Missing globals / API errors**: Code using APIs the runtime doesn't have bundles cleanly and passes every test on
  the newer local Node, then throws fatal `ReferenceError`/`TypeError` on consumers' runners
- **Syntax errors**: A tsconfig `target` past what the runtime's V8 parses fails instantly at load time on every
  consumer

Parity closes both twice over: `npm run lint:types` rejects post-runtime APIs statically (the `@types/node` pin), and
the test suite executes on the runtime's own line anyway.

## The guards

1. **`@types/node` pinned to the runtime major (`^24`)** — the compiler only knows the API surface the runner actually
   has, so post-runtime APIs fail `npm run lint:types` the moment they are written
1. **`engines.node` floor equals the runtime major (`>=24`)** — declares the true support floor to contributors and
   tooling, and keeps the `@types/node` pin honest (a higher floor would legitimize newer typings)
1. **tsconfig `target` bounded by the runtime** — `ES2024`, per the official `@tsconfig/node24` base; raise it only when
   the runtime moves
1. **`__tests__/devcontainer.test.ts`** — asserts the whole set shares the runtime major (`runs.using` ↔ `engines` ↔
   `@types/node` ↔ `.node-version` ↔ devcontainer image tag) and that the devcontainers `node` feature is absent
1. **Dependabot ignore for `@types/node` majors** (`.github/dependabot.yml`) — the exclusion that keeps parity
   low-maintenance: minor/patch type updates flow automatically; the major only moves with the runtime bump

## Why `engines.node` must not exceed the runtime major

- **Type-safety erasure**: A floor above the runtime major invites matching newer `@types/node`, letting the compiler
  accept APIs that crash on the runner — silently converting compile-time errors into production crashes
- **Contributor friction**: A floor above the runtime major blocks `npm ci` and local test runs for contributors whose
  machines can build and run this project fine

## Development environment

- **`.node-version`** holds a bare major (`24`). `actions/setup-node` (`node-version-file:`), `nvm`, and `fnm` all
  resolve a bare major to the newest release of that line, so dev and CI stay current within 24.x with zero churn in
  this file
- **Devcontainer** uses `mcr.microsoft.com/devcontainers/javascript-node:24-trixie` — Node is baked into the image (no
  install step at container build). The runtime-major tag is also the image line's default (`latest` points at the
  24-trixie variant), so its base layers are the most commonly cached — the fastest pull in the tag set. Patch level
  advances when Microsoft rebuilds the image
- **npm cache volume**: both `node_modules/` and `~/.npm` live in named volumes, so `npm ci --prefer-offline` after a
  rebuild is mostly a local copy instead of a full re-download
- **All other dependencies** float to latest through dependabot's weekly minor/patch groups; only the `@types/node`
  major is held to the runtime

### Do not add the devcontainers `node` feature

The `javascript-node` image ships Node via nvm and puts `/usr/local/share/nvm/current/bin` first on `PATH`. Adding
`ghcr.io/devcontainers/features/node` installs a second Node that silently shadows the image's — matching neither the
image tag nor `.node-version`, with no error anywhere. The guard test fails the build if the feature reappears.

## Changing versions

There is exactly one upgrade path: when GitHub ships a new action runtime (likely `node28`, around 2028), every
reference in the version map moves together in a breaking major release — full protocol in the
[node-versioning skill](../.claude/skills/node-versioning/SKILL.md).
