# Security Policy

## Supported branch

Security fixes are handled on the active `main` branch.

## Reporting a vulnerability

Please do not open public issues for:

- secret exposure
- local file access vulnerabilities
- arbitrary command execution
- unsafe IPC boundaries
- dependency or packaging vulnerabilities that could affect users

Instead, report privately to the maintainer channel you control for this project. If a dedicated security email or GitHub security advisory workflow is added later, update this file before public launch.

## What counts as sensitive

- access to arbitrary local files
- unintended upload of local recordings or transcript content
- unsafe use of `OPENAI_API_KEY`
- Electron preload or IPC privilege escalation
- packaged-binary supply-chain problems
