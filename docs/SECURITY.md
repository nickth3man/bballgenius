# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead:

1. Use [GitHub private vulnerability reporting](https://github.com/nickth3man/bballgenius/security/advisories/new)
2. Or email the maintainer directly via the contact info on the GitHub profile

Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 7 days
- **Resolution**: Depends on severity, typically within 30 days

## Scope

Security issues in:

- Application source code (`src/`)
- Build scripts and CI configuration (`scripts/`, `.github/`)
- Dependency vulnerabilities (reported via `bun audit`)

Out of scope:

- The upstream `nbadb` data pipeline
- Third-party services (OpenRouter, Basketball-Reference)
- Issues in dependencies that are already tracked by `bun audit`
