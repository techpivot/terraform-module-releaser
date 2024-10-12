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

## Resources

- [GitHub Actions Security Best Practices](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
- [Terraform Module Releaser CodeQL Analysis](https://github.com/techpivot/terraform-module-releaser/actions/workflows/codeql-analysis.yml)
