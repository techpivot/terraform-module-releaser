#!/usr/bin/env bash
#
# Update Major Version Tag
#
# This script updates the major version tag (e.g., v1, v2) to point to the current
# commit on the main branch. It's designed for GitHub Actions to enable users to
# reference stable major versions (e.g., uses: owner/repo@v1).
#
# The script:
# 1. Ensures we're on the main branch with up-to-date commits
# 2. Fetches the latest tags from remote
# 3. Determines the highest major version from existing tags
# 4. Deletes the existing major tag locally (if it exists)
# 5. Creates a new major tag pointing to the current commit (HEAD)
# 6. Displays the command to push the tag with force
#
# Usage: ./scripts/update-major-tag.sh
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
error() {
    echo -e "${RED}ERROR: $1${NC}" >&2
    exit 1
}

info() {
    echo -e "${BLUE}INFO: $1${NC}"
}

success() {
    echo -e "${GREEN}SUCCESS: $1${NC}"
}

warning() {
    echo -e "${YELLOW}WARNING: $1${NC}"
}

# Ensure we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    error "Not in a git repository"
fi

# Fetch latest from remote (force to update any existing tags)
info "Fetching latest from remote..."
git fetch --tags --force origin || error "Failed to fetch from remote"

# Ensure we're on the main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "main" ]]; then
    error "Current branch is '$CURRENT_BRANCH'. Must be on 'main' branch to update major tags."
fi

# Ensure main branch is up to date
info "Ensuring main branch is up to date..."
git fetch origin main || error "Failed to fetch main branch"

LOCAL_COMMIT=$(git rev-parse main)
REMOTE_COMMIT=$(git rev-parse origin/main)

if [[ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]]; then
    error "Local main branch is not up to date with origin/main. Please pull latest changes."
fi

# Get all version tags (format: v1.2.3)
info "Finding all version tags..."
ALL_TAGS=$(git tag -l 'v*.*.*' | sort -V)

if [[ -z "$ALL_TAGS" ]]; then
    error "No version tags found matching pattern v*.*.*"
fi

# Find the latest tag (highest semantic version)
LATEST_TAG=$(echo "$ALL_TAGS" | tail -n 1)
info "Latest version tag: $LATEST_TAG"

# Extract major version from latest tag
if [[ "$LATEST_TAG" =~ ^v([0-9]+)\. ]]; then
    MAJOR_VERSION="${BASH_REMATCH[1]}"
    MAJOR_TAG="v${MAJOR_VERSION}"
else
    error "Could not extract major version from tag: $LATEST_TAG"
fi

info "Major version: $MAJOR_TAG"

# Get all tags with this major version
MAJOR_VERSION_TAGS=$(git tag -l "v${MAJOR_VERSION}.*.*" | sort -V)
LATEST_IN_MAJOR=$(echo "$MAJOR_VERSION_TAGS" | tail -n 1)

info "Latest tag in v${MAJOR_VERSION}.x series: $LATEST_IN_MAJOR"

# Get the commit hash for the latest tag in this major version
TARGET_COMMIT=$(git rev-list -n 1 "$LATEST_IN_MAJOR")
CURRENT_COMMIT=$(git rev-parse HEAD)

if [[ "$TARGET_COMMIT" != "$CURRENT_COMMIT" ]]; then
    warning "Current commit ($CURRENT_COMMIT) does not match latest tag commit ($TARGET_COMMIT)"
    warning "The major tag will point to the current commit, not the latest versioned tag"
fi

# Check if major tag already exists
if git rev-parse "$MAJOR_TAG" >/dev/null 2>&1; then
    EXISTING_COMMIT=$(git rev-list -n 1 "$MAJOR_TAG")

    if [[ "$EXISTING_COMMIT" == "$CURRENT_COMMIT" ]]; then
        success "Major tag $MAJOR_TAG already points to current commit"
        echo ""
        info "No action needed. Tag is already up to date."
        exit 0
    fi
    
    info "Deleting existing major tag: $MAJOR_TAG (was pointing to $EXISTING_COMMIT)"
    git tag -d "$MAJOR_TAG" || error "Failed to delete local tag $MAJOR_TAG"
else
    info "Major tag $MAJOR_TAG does not exist yet"
fi

# Create new major tag pointing to current commit
info "Creating major tag $MAJOR_TAG pointing to current commit ($CURRENT_COMMIT)"
git tag -a "$MAJOR_TAG" -m "Update $MAJOR_TAG to $LATEST_IN_MAJOR" || error "Failed to create tag $MAJOR_TAG"

success "Major tag $MAJOR_TAG created successfully"

# Display push command
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✓${NC} Major tag updated locally"
echo ""
echo "To push the tag to remote, run:"
echo ""
echo -e "  ${YELLOW}git push origin $MAJOR_TAG --force${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
