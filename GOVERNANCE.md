# Governance

## Current model

Movion is currently a maintainer-led open-source project.

The default maintainer of record is:

- `@ads123121`

## How decisions are made

For now, project direction is decided by the maintainer after considering:

- user impact
- technical quality
- local-first/privacy-first constraints
- preview/export parity implications
- long-term maintainability

## What requires maintainer review

The following changes should not merge without maintainer approval:

- architecture changes affecting preview/export parity
- Electron IPC or preload boundary changes
- file system access changes
- FFmpeg provisioning or export pipeline changes
- OpenAI integration changes
- licensing, branding, or third-party asset changes

## Contribution path

Contributors are encouraged to:

1. open an issue or draft PR for non-trivial changes
2. keep feature changes focused
3. include verification steps
4. call out user-visible behavior changes explicitly

## Maintainer expansion

Additional maintainers can be added when contributors demonstrate:

- repeated high-quality contributions
- good review judgment
- respect for privacy/security constraints
- ability to steward feature direction, not just land patches

## Code of conduct and security

- behavior expectations are in [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- vulnerability handling is in [SECURITY.md](./SECURITY.md)

## Releases

Until a more formal release process exists:

- `main` is the active development branch
- releases should be cut only after build, lint, and Electron entry checks pass
- packaged releases should include third-party notice review and FFmpeg compliance review
