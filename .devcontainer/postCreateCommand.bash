#!/bin/bash

set -euxo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
git config --global --add safe.directory "${REPO_ROOT}"
sudo chown "$(id -u):$(id -g)" node_modules
npm ci --no-fund
