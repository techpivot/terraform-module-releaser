# Security Policy

**[Terraform Module Releaser](https://github.com/techpivot/terraform-module-releaser)** takes security seriously. We are
committed to protecting the integrity of your infrastructure and adhering to secure coding practices.

We regularly scan for vulnerabilities using
[CodeQL](https://github.com/techpivot/terraform-module-releaser/actions/workflows/codeql-analysis.yml). The results are
public and available for review.

## Reporting a Vulnerability

If you discover a security issue in the `Terraform Module Releaser`, please adhere to the following reporting
guidelines:

### Reporting Guidelines

**Non-Confidential Issues**: [Open an issue](https://github.com/techpivot/terraform-module-releaser/issues/new/choose)
directly on the GitHub repository with a detailed description of the vulnerability, including steps to reproduce if
possible.

**Confidential or High-Priority Issues**: Report sensitive vulnerabilities directly to our security team at
<security@techpivot.com>. We aim to respond within 24 hours.

## Best Practices

This GitHub Action runs inside a GitHub Actions runner and may have access to the source control repository. To minimize
security risks, we recommend the following practices when using this Action:

- Review the CodeQL analysis results regularly to ensure the code remains free of known vulnerabilities.
- **Pin to the latest major version** (e.g., `v1`) instead of an explicit version tag. This ensures you benefit from the
  latest features, security patches, and bugfixes while maintaining backward compatibility.
- Please refer to the
  [permissions in the README.md](https://github.com/techpivot/terraform-module-releaser?tab=readme-ov-file#permissions)
  to ensure that the required GitHub Action permissions are set appropriately with **least privilege**.
- Regularly update to the latest version of the Action to benefit from any security fixes.
- **Audit GitHub Actions dependencies** regularly to ensure that no third-party actions have introduced vulnerabilities
  or insecure behaviors.

## Why This Action Uses the Default `GITHUB_TOKEN`

This action utilizes the default `GITHUB_TOKEN` for several important reasons, ensuring that it operates efficiently and
securely:

1. **Scoped Access to the Current Repository**: The `GITHUB_TOKEN` is automatically generated by GitHub for every
   workflow run and is scoped to the repository in which the action is triggered. It provides the necessary permissions
   to interact with that specific repository, such as reading pull request data, interacting with GitHub APIs, and
   making commits. Since this action operates within the same repository, there’s no need for external authentication or
   elevated permissions, ensuring minimal access for optimal security.

1. **No Cross-Repository Access**: This action does not require access to other repositories. The default `GITHUB_TOKEN`
   is scoped only to the repository where the action is executed. This makes it unnecessary to configure additional
   tokens or credentials, keeping the action simple and secure.

1. **Security and Minimal Exposure**: The `GITHUB_TOKEN` is ephemeral—it is automatically revoked at the end of each
   workflow run and does not persist beyond the scope of the action. This limits its exposure and prevents any misuse
   beyond its intended purpose.

1. **Simpler Token Management**: Using the `GITHUB_TOKEN` eliminates the need for manually managing personal access
   tokens (PATs), which would require extra steps for setup, maintenance, and possible re-authentication. GitHub handles
   the lifecycle of this token automatically, reducing the risk of human error and making this action more secure.

By leveraging the default `GITHUB_TOKEN`, this action minimizes security risks, simplifies configuration, and ensures
that it remains efficient and secure.

## Resources

- [GitHub Actions Security Best Practices](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
- [Terraform Module Releaser CodeQL Analysis](https://github.com/techpivot/terraform-module-releaser/actions/workflows/codeql-analysis.yml)