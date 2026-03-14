# Movion

Movion is a local-first desktop screencast studio for developers, educators, and product teams.

It focuses on four things:

- cinematic motion zoom
- accurate cursor enhancement
- readable click emphasis
- export parity with preview

Movion is an independent project. It can import data from Canvid-compatible local folders, but it is not published as a branded fork.

## Status

This repository is an early open-source edition. The app is usable, but the codebase is still being modularized and hardened for public release quality.

Current strengths:

- screen and window capture
- timeline editing
- motion zoom and focus regions
- cursor overlay with click effects
- FFmpeg-backed export
- captions and transcript workflows
- webcam and microphone layers
- local-first project storage

Current priorities:

- further split large renderer/export files into feature modules
- keep preview and export mathematically identical
- improve public repo ergonomics and contributor workflow

## Privacy model

Movion is designed to work locally by default.

- screen recordings, projects, exports, and editor state stay on the local machine
- there is no built-in analytics or cloud sync in this repository
- OpenAI-backed features are optional and require your own API key
- if you enable transcript generation, selected audio is sent to OpenAI for processing

Read [PRIVACY.md](/C:/Users/glebg/AppData/Local/Canvid/Movion/PRIVACY.md) before enabling provider-backed features.

## Quick start

Requirements:

- Node.js 20+
- npm
- FFmpeg available on the system or discoverable by the app

Install and run:

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run start
```

## Optional OpenAI integration

Transcript generation is optional.

Set `OPENAI_API_KEY` only if you want OpenAI-powered transcription:

```bash
$env:OPENAI_API_KEY="your_key_here"
npm run start
```

By default, the app can still be used without OpenAI.

## Repository structure

- `electron/main.mjs`
  Desktop shell, capture IPC, persistence, FFmpeg orchestration, export planning.
- `electron/preload.cjs`
  Safe IPC bridge for the renderer.
- `src/App.tsx`
  Main desktop UI shell.
- `src/shared/*`
  Shared motion, cursor, click-effect, sampling, and normalization logic used by preview and export.
- `docs/`
  Internal architecture and release planning notes.

## Import compatibility

Movion includes compatibility import paths for existing local Canvid data. This is for migration support only.

Current compatibility sources:

- `%LOCALAPPDATA%/Canvid`
- `%USERPROFILE%/Videos/Canvid/Projects`
- `%USERPROFILE%/Videos/Canvid/Presets`

## Open source hygiene

Before contributing or publishing forks:

- do not commit personal recordings
- do not commit exports, logs, or generated runtime files
- do not commit API keys or local environment files
- do not commit private customer or internal demo assets

See:

- [CONTRIBUTING.md](/C:/Users/glebg/AppData/Local/Canvid/Movion/CONTRIBUTING.md)
- [SECURITY.md](/C:/Users/glebg/AppData/Local/Canvid/Movion/SECURITY.md)
- [SUPPORT.md](/C:/Users/glebg/AppData/Local/Canvid/Movion/SUPPORT.md)

## License

Apache-2.0. See [LICENSE](/C:/Users/glebg/AppData/Local/Canvid/Movion/LICENSE).
