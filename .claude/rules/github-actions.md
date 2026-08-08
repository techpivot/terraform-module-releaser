---
paths:
  - ".github/workflows/**/*.yml"
  - "action.yml"
---

# Workflow and Action Metadata Rules

- Pin third-party actions in `uses:` to a full commit SHA with an adjacent `# vX.Y.Z` comment; resolve the SHA by
  fetching upstream tags and selecting the latest semantic version
- Keep least-privilege `permissions:`; broaden a scope only when the workflow requires it
- Don't assume runner-native CLIs (`jq`, `gh`, `curl`) exist — install them explicitly, or prefer `fetch`/Octokit in
  checked-in scripts
- Keep workflows portable across GitHub-hosted and self-hosted runners: explicit dependencies, paths, and working
  directories
- `action.yml` `runs.using` is the production runtime — changing it is a breaking major release; see the
  `node-versioning` skill
