#!/bin/bash

set -euxo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
git config --global --add safe.directory "${REPO_ROOT}"

# Named volumes mount root-owned on first create; hand them to the container user before npm touches them.
sudo chown "$(id -u):$(id -g)" node_modules "${HOME}/.npm"

# The npm cache volume persists across container rebuilds, so --prefer-offline makes npm ci mostly a local copy.
npm ci --no-fund --no-audit --prefer-offline
