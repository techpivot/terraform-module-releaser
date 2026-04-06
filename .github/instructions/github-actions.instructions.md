---
description:
  "Use when editing GitHub Actions workflows or action metadata, especially for API calls, runner dependencies, HTTP
  integrations, or third-party action updates."
applyTo: ".github/workflows/**/*.yml,action.yml"
---

## GitHub Actions Guidelines

- Do not assume runner-native tools are available just because they are common on GitHub-hosted runners. If a workflow
  depends on a CLI, runtime, or package, install or configure it explicitly in the workflow.
- Prefer HTTP-based integrations or JavaScript `fetch` in action code and checked-in scripts over ad hoc reliance on
  `curl`, `wget`, `gh`, `jq`, or other optional binaries.
- When calling the GitHub API, prefer authenticated HTTPS requests and documented environment variables over shelling
  out to GitHub-specific CLIs.
- Keep workflows portable across GitHub-hosted and self-hosted runners by making dependencies, working directories, and
  paths explicit.
- For third-party actions in `uses:` steps, pin to a full commit SHA and keep an adjacent version comment.
- Avoid assuming repository source always lives under `src`; set workflow paths such as `working-directory`, checkout
  paths, and CodeQL `source-root` to match the actual target files.
- Preserve least-privilege `permissions:` settings and only add broader scopes when the workflow requires them.
