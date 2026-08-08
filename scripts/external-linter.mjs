#!/usr/bin/env node

/**
 * Runs a linter that is not distributed through npm.
 *
 * `actionlint` is a Go binary with no first-party npm package — the one published under that name on the registry
 * is an unaffiliated wasm build last updated in 2022, so it is deliberately not used as a dependency. That leaves
 * the binary itself, which a contributor may not have installed.
 *
 * Locally, a missing binary is a skip with an install hint: `npm run lint` must stay usable immediately after
 * `npm ci`, or nobody runs it. In CI it is a hard failure, because a check that silently passes when its tool is
 * absent is worse than no check at all — the workflow installs the binary before linting, so a miss there means
 * the install step regressed.
 *
 * Secret scanning deliberately does not go through here: it runs as its own CI-only step so that contributors
 * never need `gitleaks` locally.
 *
 * @example
 * ```bash
 * node scripts/external-linter.mjs actionlint
 * ```
 */

import { spawnSync } from 'node:child_process';
import which from 'which';

/** How to install each supported binary, shown when it is missing. */
const INSTALL_HINTS = {
  actionlint: 'brew install actionlint  |  go install github.com/rhysd/actionlint/cmd/actionlint@latest',
};

const [binary, ...args] = process.argv.slice(2);

if (!binary) {
  console.error('Usage: node scripts/external-linter.mjs <binary> [args...]');
  process.exit(1);
}

const resolved = which.sync(binary, { nothrow: true });

if (resolved === null) {
  const hint = INSTALL_HINTS[binary] ?? `Install '${binary}' and ensure it is on your PATH.`;

  // GitHub Actions sets CI=true. Never let an absent binary look like a passing check there.
  if (process.env.CI) {
    console.error(`::error::'${binary}' is required in CI but was not found on PATH. Install it: ${hint}`);
    process.exit(1);
  }

  console.warn(`⚠ Skipping ${binary}: not installed. CI still enforces it.`);
  console.warn(`  Install with: ${hint}`);
  process.exit(0);
}

const { status, error } = spawnSync(resolved, args, { stdio: 'inherit' });

if (error) {
  console.error(`Failed to run ${binary}: ${error.message}`);
  process.exit(1);
}

// A signal-terminated child reports status === null; treat that as a failure rather than success.
process.exit(status ?? 1);
