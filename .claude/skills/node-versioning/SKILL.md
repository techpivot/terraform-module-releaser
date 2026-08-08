---
name: node-versioning
description:
  Aligns Node.js versions across .node-version, devcontainer, engines.node, @types/node, and the action.yml runtime. Use
  before bumping Node or changing the Actions runtime.
---

# Node.js Versioning

The GitHub Actions runner never runs `npm install` for consumers of this action — it ignores `package.json` entirely and
executes the pre-bundled `dist/index.js` on the runtime declared in `action.yml` (`runs.using`). Local dev can track the
latest Node, but shipped code must stay compatible with the production runtime. APIs newer than that runtime bundle
cleanly and then crash on consumers' runners. Full rationale:
[references/runtime-boundary.md](references/runtime-boundary.md).

## Version Map

| Reference                                        | Value    | Rule                                                                |
| ------------------------------------------------ | -------- | ------------------------------------------------------------------- |
| `.node-version`                                  | `26`     | Local dev + CI (`node-version-file:`). Safe to bump to latest.      |
| `.devcontainer/devcontainer.json` node `version` | `"26"`   | Must match `.node-version` exactly.                                 |
| `action.yml` → `runs.using`                      | `node24` | Production runtime. Changing it is a breaking major release.        |
| `package.json` → `engines.node`                  | `>=24`   | Floor stays at the production runtime major. Never raise past it.   |
| `@types/node`                                    | `^26`    | Currently newer than the runtime — see the accepted-deviation note. |

`@types/node` ideally matches the runtime major (24) so the compiler flags post-Node-24 APIs. The repository currently
accepts `^26`, which removes that guard — the burden shifts to review: no post-Node-24 APIs in `src/`.

## Bumping Local Dev (e.g., 26 → 28)

1. Update `.node-version`
2. Update `.devcontainer/devcontainer.json` — the node feature `version` and any version label in `name`
3. Leave `action.yml` `runs.using` and `engines.node` untouched
4. Validate: `npm run package && npm run test && npm run check && npm run textlint`

## Bumping the Production Runtime (breaking change)

Requires a new major release with an announcement.

1. Confirm the target runtime is supported:
   <https://docs.github.com/en/actions/creating-actions/metadata-syntax-for-github-actions#runs-for-javascript-actions>
2. Review `tsconfig.json` `target`/`lib` so emitted syntax is valid for the new runtime
3. Update `action.yml` `runs.using`, then raise the `engines.node` floor to match
4. Rebuild (`npm run package`), run the full validation suite, and update `README.md`, `CONTRIBUTING.md`,
   `docs/development.md`, and this skill's version map
5. Release as a major version and call out the runtime change in the notes

## Guardrails

- Never raise `engines.node` above the production runtime major — it breaks contributors on standard runtimes and
  invites type bleed from newer `@types/node`
- Never use Node APIs newer than the `action.yml` runtime in `src/` — the bundle won't fail, consumers will
- Version drift between `.node-version` and the devcontainer is a bug; fix both together
