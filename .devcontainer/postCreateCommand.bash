#!/bin/bash

set -eux pipefail

git config --global --add safe.directory /workspaces/terraform-module-releaser
sudo chown "$(id -u):$(id -g)" node_modules
npm ci --no-fund
