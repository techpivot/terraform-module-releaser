# Terraform Module Releaser

<sup><b>A GitHub Action for managing Terraform modules in GitHub monorepos, automating versioning, releases, and
documentation.</b></sup>

![CI](https://github.com/techpivot/terraform-module-releaser/actions/workflows/ci.yml/badge.svg?event=pull_request)
[![Lint](https://github.com/techpivot/terraform-module-releaser/actions/workflows/lint.yml/badge.svg)][1]
[![Check dist](https://github.com/techpivot/terraform-module-releaser/actions/workflows/check-dist.yml/badge.svg)][2]
[![CodeQL](https://github.com/techpivot/terraform-module-releaser/actions/workflows/codeql-analysis.yml/badge.svg)][3]

[1]: https://github.com/techpivot/terraform-module-releaser/actions/workflows/lint.yml
[2]: https://github.com/techpivot/terraform-module-releaser/actions/workflows/check-dist.yml
[3]: https://github.com/techpivot/terraform-module-releaser/actions/workflows/codeql-analysis.yml

Simplify the management of Terraform modules in your monorepo with this **GitHub Action**, designed to automate
module-specific versioning and releases. By streamlining the Terraform module release process, this action allows you to
manage multiple modules in a single repository while still maintaining independence and flexibility. Additionally, it
generates a beautifully crafted wiki for each module, complete with readme information, usage examples, Terraform-docs
details, and a full changelog.

## Key Features

- **Efficient Module Tagging**: Module tags are specifically designed to only include the current Terraform module
  directory (and nothing else), thereby dramatically decreasing the size and improving Terraform performance.
- **Automated Release Management**: Identifies Terraform modules affected by changes in a pull request and determines
  the necessary release type (major, minor, or patch) based on commit messages.
- **Versioning and Tagging**: Calculates the next version tag for each module and commits, tags, and pushes new versions
  for each module individually.
- **Release Notes and Comments**: Generates a pull request comment summarizing module changes and release types, and
  creates a GitHub release for each module with a dynamically generated description.
- **Wiki Integration**: Updates the wiki with new release information, including:
  - README.md information for each module
  - Beautifully crafted module usage examples
  - `terraform-docs` details for each module
  - Full changelog for each module
- **Deletes Synced**: Automatically removes tags from deleted Terraform modules, keeping your repository organized and
  up-to-date.
- **Flexible Configuration**: Offers advanced input options for customization, allowing you to tailor the action to your
  specific needs.

## Demo

Check out our [Terraform Modules Demo](https://github.com/techpivot/terraform-modules-demo) repository for a practical
example of how to use this action in a monorepo setup. See real-world usage in action:

- [**Pull Request - Initial**](https://github.com/techpivot/terraform-modules-demo/pull/1)
- [**Pull Request - Module Changes**](https://github.com/techpivot/terraform-modules-demo/pull/2)
- [**Wiki**](https://github.com/techpivot/terraform-modules-demo/wiki)
- [**Releases**](https://github.com/techpivot/terraform-modules-demo/releases)
- [**_More Pull Request Examples_**](https://github.com/techpivot/terraform-modules-demo/pulls?q=is%3Apr+is%3Aclosed)

## Screenshots

<p float="left" align="center">
  <img src="screenshots/wiki-sidebar.jpg"
    alt="Wiki Sidebar" style="width: 299px; height: auto; " />
  <img src="screenshots/pr-initial-module-release.jpg"
    alt="PR Initial Module Release" style="width: 619px; height: auto;" />
  <img src="screenshots/pr-separate-modules-updating.jpg"
    alt="PR Separate Modules Updating" style="width: 504px; height: auto;" />
  <img src="screenshots/wiki-changelog.jpg"
    alt="Wiki Changelog" style="width: 500px; height: auto;" />
  <img src="screenshots/wiki-usage.jpg"
    alt="Wiki Usage" style="width: 500px; height: auto;" />
  <img src="screenshots/module-contents-explicit-dir-only.jpg"
    alt="Module Contents Explicit Dir Only" style="width: 500px;" />
  <img src="screenshots/release-details.jpg"
    alt="Release Details" style="width: 500px; height: auto;" />
  <img src="screenshots/wiki-module-example.jpg"
    alt="Wiki Module Example" style="width: 500px; height:" />
</p>

## Getting Started

### Step 1: Ensure GitHub Wiki is Enabled

Before using this action, make sure that the wiki is enabled and initialized for your repository:

1. Go to your repository's homepage.
1. Navigate to the **Settings** tab.
1. Under the **Features** section, ensure the **Wikis** option is checked to enable the GitHub Wiki.
1. Navigate to the **Wiki** tab on your repository.
1. Click the **Create the first page** button and add a basic title like **Home** to initialize the wiki with an initial
   commit.
1. Save the changes to ensure your wiki is not empty when the GitHub Action updates it with module information.

### Step 2: Configure the Action

Add the following YAML to your `.github/workflows` directory:

#### terraform-module-releaser.yml

```yml
name: Terraform Module Releaser
on:
  pull_request:
    types: [opened, reopened, synchronize, closed] # Closed required
    branches:
      - main

permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Terraform Module Releaser
        uses: techpivot/terraform-module-releaser@v1
```

## Permissions

Before executing the GitHub Actions workflow, ensure that you have the necessary permissions set for accessing pull
requests and creating releases.

- By default, this GitHub Action uses the
  [`GITHUB_TOKEN`](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication)
  associated with the workflow. To properly comment on pull requests and create tags/releases, the workflow permission
  for `pull-requests` must be set to `"write"`.
- Additionally, the workflow permission for `contents` must also be set to `"write"` to allow the action to create tags
  and releases.
- For security considerations and best practices when using the `github_token`, please refer to the
  [Security Documentation](./security.md).
- Ensure the **Restrict editing to users in teams with push access only** setting is enabled for public repositories, as
  the GitHub Actions Bot can write to the wiki by default.

If the permissions are insufficient, the action may fail with a 403 error, indicating a lack of access to the necessary
resources.

## Input Parameters

While the out-of-the-box defaults are suitable for most use cases, you can further customize the action's behavior by
configuring the following optional input parameters as needed.

| Input                        | Description                                                                                                                                 | Default                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `major-keywords`             | Keywords in commit messages that indicate a major release                                                                                   | `major change,breaking change` |
| `minor-keywords`             | Keywords in commit messages that indicate a minor release                                                                                   | `feat,feature`                 |
| `patch-keywords`             | Keywords in commit messages that indicate a patch release                                                                                   | `fix,chore,docs`               |
| `default-first-tag`          | Specifies the default tag version                                                                                                           | `v1.0.0`                       |
| `terraform-docs-version`     | Specifies the terraform-docs version used to generate documentation for the wiki                                                            | `v0.19.0`                      |
| `delete-legacy-tags`         | Specifies a boolean that determines whether tags and releases from Terraform modules that have been deleted should be automatically removed | `true`                         |
| `disable-wiki`               | Whether to disable wiki generation for Terraform modules                                                                                    | `false`                        |
| `wiki-sidebar-changelog-max` | An integer that specifies how many changelog entries are displayed in the sidebar per module                                                | `5`                            |
| `disable-branding`           | Controls whether a small branding link to the action's repository is added to PR comments. Recommended to leave enabled to support OSS.     | `false`                        |

### Example Usage with Inputs

```yml
name: Terraform Module Releaser
on:
  pull_request:
    types: [opened, reopened, synchronize, closed] # Closed required
    branches:
      - main

permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Terraform Module Releaser
        uses: techpivot/terraform-module-releaser@v1
        with:
          major-keywords: major update,breaking change
          minor-keywords: feat,feature
          patch-keywords: fix,chore,docs
          default-first-tag: v2.0.0
          github_token: ${{ secrets.GITHUB_TOKEN }}
          terraform-docs-version: v0.20.0
          delete-legacy-tags: true
          disable-wiki: false
          wiki-sidebar-changelog-max: 10
```

## Inspiration

This action was inspired by the blog post
[GitHub-Powered Terraform Modules Monorepo](https://cloudchronicles.blog/blog/GitHub-Powered-Terraform-Modules-Monorepo/)
by Piotr Krukowski.

## Notes

- This action uses [Conventional Commits](https://www.conventionalcommits.org/) to automatically determine the release
  type _(major, minor, or patch)_ based on commit messages. This behavior is configurable via
  [inputs](#input-parameters).
- Versioning is done using [Semantic Versioning (SemVer)](https://semver.org/), which provides a clear and consistent
  way to manage module versions.
- Commit messages are linked to the respective Terraform directories _(handling PRs that may have separate modules and
  changed files)_.
- Unlike the original inspiration, which relied on labels for tagging and versioning, this action leverages commit
  messages to determine the release type. This approach simplifies the process and eliminates the complexity introduced
  by labels, which were PR-specific and didn't account for individual commits per module. By using commit messages, we
  can now accurately tag and version only the relevant commits, providing a more precise and efficient release
  management process.
- **100% GitHub-based**: This action has no external dependencies, eliminating the need for additional authentication
  and complexity. Unlike earlier variations that stored built module assets in external services like Amazon S3, this
  action keeps everything within GitHub, providing a self-contained and streamlined solution for managing Terraform
  modules.
- **Pull Request-based workflow**: This action runs on the pull_request event, using pull request comments to track
  permanent releases tied to commits. This method ensures persistence, unlike Action Artifacts, which expire. As a
  result, the module does not support non-PR workflows, such as direct pushes to the default branch.

## License

The scripts and documentation in this project are released under the [MIT License](./LICENSE.md).

## Security

For detailed information about security practices and guidelines, check out the [Security Documentation](./security.md).
