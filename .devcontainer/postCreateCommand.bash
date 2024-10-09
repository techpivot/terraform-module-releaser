#!/bin/bash

set -eux pipefail

git config --global --add safe.directory /workspaces/terraform-modules-releaser
sudo chown node:node node_modules
npm install --no-fund
