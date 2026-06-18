---
name: npm-versioning
description:
  Explains safe Node.js version management, upgrade workflows, local dev vs compilation target differences, and
  action-safe bundle requirements in the terraform-module-releaser project.
---

# Skill: Node.js and npm Versioning for GitHub Actions

This skill guides AI agents and developers in managing Node.js version alignment, dependency upgrades, and ecosystem
compatibility in the `terraform-module-releaser` project.

---

## 1. The GitHub Actions Runtime vs. Local Dev Dichotomy

A common pitfall in GitHub Actions development is conflating the **local development/compilation environment** with the
**GitHub Actions runtime environment**.

### How GitHub Actions Executes This Action

1. When a downstream repository consumes this action (e.g., `uses: techpivot/terraform-module-releaser@v2`), the GitHub
   Actions runner **does not** run `npm install`.
2. It entirely ignores `package.json`, `package-lock.json`, and standard dependency resolution.
3. Instead, the runner directly spins up the Node.js runtime specified in the action's standard metadata file
   (`action.yml`):
   ```yaml
   runs:
     using: "node24"
     main: "dist/index.js"
   ```
4. It executes the pre-compiled, bundled code at `dist/index.js` using its native Node 24 runtime environment.

### The Problem with Local-only Upgrades (Why we must be careful)

If a developer upgrades their local node environment to Node 26 (to gain performance improvements or
developer-experience features) and configures the build setup carelessly, several failure modes can manifest:

- **Missing Global / API Errors**: If the developer takes advantage of APIs introduced in Node 25 or 26 (such as new
  `fs`, `stream`, or `promise` methods or updated global objects) and TypeScript is configured to allow them, the
  compiler (`@vercel/ncc`) will bundle the code successfully. However, once deployed, the consumer's Node 24 runner will
  throw fatal, untraceable `ReferenceError` or `TypeError` crashes at runtime.
- **Transpilation Target Misalignment**: If `tsconfig.json` → `compilerOptions.target` is upgraded to use newer
  ECMAScript features supported ONLY by Node 26+, the compiled JS output may contain syntax elements that Node 24
  engines cannot parse, causing instant syntax/parsing errors on consumer runners.

---

## 2. Decoupled Versioning Map (4 Touchpoints)

We manage Node.js versions in **four separate targets**, each with a distinct purpose. Under no circumstances should
they be blindly bumped to the same version.

| Target File / Tool                    | Purpose                                                                                                      | Locked / Target                | Alignment Rules                                                                                                                           |
| :------------------------------------ | :----------------------------------------------------------------------------------------------------------- | :----------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| **`.node-version`**                   | Local Node Version manager. Used by `nvm`, `fnm`, and GitHub Actions setup workflows (`actions/setup-node`). | **`26`** (Latest LTS / Active) | Safe to bump to the latest Node version for development, testing, and bundling speed.                                                     |
| **`.devcontainer/devcontainer.json`** | Container feature definition for Visual Studio Code Remote Containers.                                       | **`26`**                       | **Must match `.node-version`** exactly. Sets feature `version` and the optional workspace name label.                                     |
| **`action.yml`**                      | Production GitHub Actions runner specification.                                                              | **`node24`**                   | **Strictly pinned to Node 24**. Change ONLY when making a breaking **major version release** with a community announcement.               |
| **`package.json` → `engines.node`**   | Package install compatibility range limit.                                                                   | **`">=24"`** (or `">=24 <27"`) | **MUST maintain Node 24 compatibility**. Changing this to `>=26` is forbidden as it breaks backward installation compatibility and types. |

---

## 3. Why `package.json` → `engines.node` Must Remain Pinned to Node 24 Compat

You must **NEVER** casually bump `package.json` → `engines.node` to `>=26` just because `.node-version` is 26. Doing so
causes major architectural regression:

1. **Type Safety Erasure (Extremely Dangerous)**: If `engines.node` requires `>=26`, the `@types/node` dependency can be
   safely upgraded to version `26`. Once updated, TypeScript will happily compile code using Node 25 or 26 specific
   globals/methods. Since the compiler doesn't compile away standard library functions, this results in code that builds
   fine locally but crashes instantly in production workflows.
2. **Contributor Friction**: Many enterprise, local, or self-hosted environments run Node 24 or Node 25. Enforcing
   `engines.node: ">=26"` prevents contributors using those runtimes from installing packages or running testing suites
   locally, even though the action itself is built to execute fine on those runtimes.
3. **Internal Tools / CLI validation**: Self-hosted execution of helper tools or scripts (e.g., local module
   parsers/tests) must still be executable on standard Node 24 machines.

---

## 4. Node Upgrade Protocol (Bumping local dev 25 → 26)

When updating the repo's development environment, execute the following protocol strictly:

### Step 1: Bump Local Dev / CI Environment

1. Update `.node-version` to `26`.
2. Update `.devcontainer/devcontainer.json` `"name"` or metadata to match `node:26`.
3. Update `.devcontainer/devcontainer.json` → `features` → `ghcr.io/devcontainers/features/node:1` → `version` to
   `"26"`.

### Step 2: Enforce Node 24 Compilation / Type Boundaries

1. **DO NOT** touch the `action.yml` `runs.using` property (must remain `node24`).
2. **DO NOT** set `engines.node` to require anything higher than Node 24. It must remain `">=24"` to enforce
   compatibility checks.
3. **DO NOT** upgrade `@types/node` past version `24` (or any types containing post-Node 24 APIs) unless strictly
   necessary. Keeping `@types/node` constrained to Node 24 compatibility (e.g. `@types/node@^24.x.x` or lower)
   guarantees that TypeScript will throw compilation errors if a developer mistakenly uses post-Node 24 APIs (such as
   Node 25/26 specific components) in the codebase. If the project already has a newer `@types/node`, consider
   downgrading or strictly audit any reference to Node 25/26 global additions.

### Step 3: Bundle and Validate

- Compile the output using `npm run package`.
- Run tests (`npm run test`) to ensure the compiled output works perfectly across all mock scenarios.
- Run linters (`npm run check` and `npm run textlint`) to verify pristine formatting.
