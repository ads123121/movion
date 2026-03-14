# Contributing to Movion

## Scope

Movion is a local-first desktop screencast editor. The highest-value contributions improve:

- motion zoom quality
- cursor fidelity
- click effect readability
- export parity
- modularity and maintainability

## Development setup

```bash
npm install
npm run dev
```

Before opening a pull request:

```bash
npm run build
npm run lint
node --check electron/main.mjs
```

## Safety rules

Do not commit:

- personal recordings
- exported videos
- screenshots from private material
- logs from local testing unless explicitly scrubbed
- `.env` files
- API keys or tokens
- machine-specific paths added to source or docs

## Pull request guidelines

- keep changes focused
- explain user-visible behavior changes
- call out preview/export implications explicitly
- prefer shared feature logic over new renderer/export duplication
- include verification notes

## Coding priorities

- preview and export should use the same math whenever possible
- avoid adding more logic to monolith files when a shared feature module is appropriate
- do not hide timing bugs behind coefficient tuning alone

## Reporting ideas and bugs

- use bug reports for concrete issues
- use feature requests for larger workflow improvements
- use security channels in [SECURITY.md](./SECURITY.md) for vulnerabilities
