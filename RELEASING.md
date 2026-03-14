# Releasing Movion

## Scope

This repository currently ships a Windows-focused desktop release pipeline.

Release targets:

- NSIS installer
- portable executable

## Prerequisites

- Node.js 20+
- npm
- Windows build host

## Local release build

```bash
npm install
npm run dist:win
```

This default packaging path intentionally disables Windows executable resource editing.

That keeps packaging reproducible on Windows machines that do not have the privileges needed by `electron-builder`'s full toolchain extraction path.

Use the fully branded build mode when your machine or CI runner can support it:

```bash
npm run dist:win:release
```

Artifacts are written to:

- `release/`

## Release assets

Release icons and installer graphics are generated from:

- `build/icon.svg`

Generated files include:

- `build/icon.ico`
- `build/icon.png`
- `build/installer-banner.png`

## GitHub release flow

Tag a version like:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The GitHub Actions release workflow will:

1. install dependencies
2. run validation
3. build Windows artifacts
4. upload artifacts to the workflow
5. publish GitHub Release assets for version tags

The GitHub workflow uses the validated reproducible packaging path, not the optional executable-editing mode.

That is deliberate: it keeps release generation stable on standard Windows runners and avoids the legacy `winCodeSign` extraction failure path.

## Code signing

Unsigned builds will work, but Windows SmartScreen warnings are expected.

If signing secrets are added later, `electron-builder` can use the standard environment variables:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

`MOVION_ENABLE_WIN_EXECUTABLE_EDITING=true` enables the full Windows executable resource pass.

Keep this mode as an advanced opt-in until your Windows build host is confirmed to complete the legacy `winCodeSign` extraction path successfully.

## FFmpeg note

The packaged app does not bundle FFmpeg in this repository by default.

That means:

- the app will run
- export features still require FFmpeg to be discoverable at runtime
- first-party bundled FFmpeg distribution should only be added together with a compliance review

## Packaging-specific implementation notes

- Electron helper PowerShell scripts are unpacked from `asar` so cursor and keyboard tracking keep working in packaged builds
- the app is configured to prefer `MOVION_LOCAL_FFMPEG` and `MOVION_LOCAL_FFPROBE`, while still accepting legacy fallback env vars for compatibility
