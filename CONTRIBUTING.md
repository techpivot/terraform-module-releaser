# Contributing to Terraform Module Releaser

Thank you for your interest in contributing to the **Terraform Module Releaser**! This document provides guidelines and
information for contributors to help ensure a smooth and effective collaboration experience.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Environment Setup](#development-environment-setup)
- [Development Workflow](#development-workflow)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Testing](#testing)
- [Code Style and Linting](#code-style-and-linting)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)
- [Community Guidelines](#community-guidelines)
- [Release Process](#release-process)

## Getting Started

Before contributing, please:

1. Read the [README.md](./README.md) to understand the project's purpose and functionality
2. Review the [Security Policy](./SECURITY.md) for security-related guidelines
3. Check existing [issues](https://github.com/techpivot/terraform-module-releaser/issues) and
   [pull requests](https://github.com/techpivot/terraform-module-releaser/pulls) to avoid duplication
4. Consider opening an issue first to discuss significant changes or new features

## Development Environment Setup

### Prerequisites

- **Node.js**: Version 20 or higher (see [.node-version](./.node-version) for the exact version)
- **npm**: Comes with Node.js
- **Git**: For version control

### Initial Setup

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/terraform-module-releaser.git
   cd terraform-module-releaser
   ```
3. **Install dependencies**:
   ```bash
   npm ci --no-fund
   ```
4. **Verify the setup** by running tests:
   ```bash
   npm test
   ```

## Development Workflow

### Making Changes

1. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. **Make your changes** following the coding standards
3. **Add or update tests** as needed
4. **Run linting and tests** to ensure quality:
   ```bash
   npm run check:fix  # Fix linting issues
   npm test           # Run tests
   ```
5. **Commit your changes** following our commit message guidelines

### Key npm Scripts

- `npm test` - Run the test suite with coverage
- `npm run check` - Run code linting and style checks
- `npm run check:fix` - Automatically fix linting issues where possible
- `npm run test:watch` - Run tests in watch mode during development

> [!WARNING]
> Do not check in any build/distribution assets (e.g., outputs from `npm run bundle`). These are handled automatically during the release process. For development and testing, running `npm test` is sufficient.

## Commit Message Guidelines

This project uses [Conventional Commits](https://www.conventionalcommits.org/) to automatically determine release types
and generate changelogs. Please follow the conventional commits specification for all commit messages.

For detailed information about the format, types, and examples, please refer to the
[Conventional Commits site](https://www.conventionalcommits.org/).

## Testing

### Running Tests

```bash
# Run all tests with coverage
npm test

# Run tests in watch mode during development
npm run test:watch
```

### Test Guidelines

- Write tests for all new functionality
- Ensure existing tests pass
- Aim for high test coverage
- Use descriptive test names that explain the expected behavior
- Follow the existing test patterns in the `__tests__` directory

### Test Types

- **Unit Tests**: Test individual functions and components
- **Integration Tests**: Test interactions between components
- **API Tests**: Some tests require `GITHUB_TOKEN` environment variable for real API calls

## Code Style and Linting

This project uses [Biome](https://biomejs.dev/) for linting and code formatting.

### Running Linting

```bash
# Check for linting issues
npm run check

# Automatically fix linting issues
npm run check:fix
```

### Style Guidelines

- Follow TypeScript best practices
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions small and focused
- Use async/await for asynchronous operations

## Pull Request Process

1. **Ensure your branch is up to date** with the main branch:

   ```bash
   git checkout main
   git pull upstream main
   git checkout your-branch
   git rebase main
   ```

2. **Run the full test suite** and ensure everything passes:

   ```bash
   npm test
   ```

3. **Create a pull request** with:
   - A clear, descriptive title
   - A detailed description of the changes
   - Reference to any related issues
   - Screenshots or examples if applicable

4. **Address review feedback** promptly and respectfully

5. **Ensure CI checks pass** before requesting final review

### Pull Request Guidelines

- Keep pull requests focused and atomic
- Include tests for new functionality
- Update documentation as needed
- Ensure backwards compatibility unless it's a breaking change
- Follow the conventional commit format for the PR title

## Reporting Issues

### Bug Reports

When reporting bugs, please include:

- **Clear description** of the issue
- **Steps to reproduce** the problem
- **Expected vs actual behavior**
- **Environment details** (Node.js version, OS, etc.)
- **Relevant logs or error messages**
- **Minimal reproduction case** if possible

### Feature Requests

For feature requests, please provide:

- **Clear description** of the proposed feature
- **Use case** and justification
- **Possible implementation approach** (if you have ideas)
- **Willingness to contribute** the implementation

### Security Issues

For security-related issues, please follow our [Security Policy](./SECURITY.md) and report them to
<security@techpivot.com>.

## Community Guidelines

### Code of Conduct

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Assume good intentions
- Follow the
  [GitHub Community Guidelines](https://docs.github.com/en/site-policy/github-terms/github-community-guidelines)

### Communication

- Use clear, concise language
- Provide context for your suggestions
- Be patient with review processes
- Ask questions if anything is unclear

## Release Process

This project uses automated releases through GitHub Actions:

- **Semantic versioning** based on conventional commits
- **Automatic changelog generation** from commit messages
- **GitHub releases** with proper tagging
- **npm package publication** to GitHub Packages

Contributors don't need to manually manage versions or releases. The automation handles this based on your commit
messages and pull request merges.

## Getting Help

If you need help or have questions:

1. Check the [existing documentation](./README.md)
2. Search [existing issues](https://github.com/techpivot/terraform-module-releaser/issues)
3. Open a new issue with the `question` label
4. Review the [demo repository](https://github.com/techpivot/terraform-modules-demo) for examples

## Thank You

Your contributions make this project better for everyone. Whether you're fixing bugs, adding features, improving
documentation, or helping others, we appreciate your efforts!

---

_For more information about the project, see the [README.md](./README.md) and explore the
[demo repository](https://github.com/techpivot/terraform-modules-demo)._
