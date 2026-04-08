# Security Policy

## Supported Versions

| Version   | Supported          |
| --------- | ------------------ |
| 0.8.x     | :white_check_mark: |
| < 0.8.0   | :x:                |

Only the latest minor release receives security patches.

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Instead, report vulnerabilities privately via one of these methods:

1. **GitHub Security Advisory** (preferred): use the "Report a vulnerability" button on the [Security tab](https://github.com/Erreur32/LogviewR/security/advisories/new).
2. **Email**: send details to the maintainer address listed in `package.json`.

### What to include

- Description of the vulnerability
- Steps to reproduce (or a proof-of-concept)
- Affected version(s)
- Potential impact

### Response timeline

- **Acknowledgement**: within 72 hours
- **Initial assessment**: within 7 days
- **Fix or mitigation**: targeting 30 days for critical issues

### After reporting

- You will receive updates as the issue is triaged and resolved.
- Once a fix is released, the advisory will be published with credit (unless you prefer to remain anonymous).
- We ask that you do not publicly disclose the vulnerability until a fix is available.

## Security Best Practices for Deployment

- Always set a strong, unique `JWT_SECRET` environment variable.
- Run the Docker container with `security_opt: ["no-new-privileges:true"]`.
- Keep the host `/host` mount read-only (`:ro`).
- Use HTTPS via a reverse proxy (nginx, Caddy, Traefik) in production.
- Regularly update to the latest release.
