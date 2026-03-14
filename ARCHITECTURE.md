# Architecture

## Product shape

Movion is a local-first Electron desktop application for recording, editing, and exporting technical screencasts.

The current architecture is deliberately optimized around four product-critical features:

- motion zoom that explains user intent
- cursor overlays that stay faithful to source motion
- click effects that remain readable in preview and export
- FFmpeg-based export that matches preview behavior as closely as possible

## Top-level runtime

### Renderer

Main file:

- `src/App.tsx`

Responsibilities:

- desktop UI shell
- timeline and editor state
- live preview
- settings panels
- preview-side cursor and focus rendering

### Shared feature math

Directory:

- `src/shared/`

Responsibilities:

- focus motion timing and easing
- cursor path interpolation
- cursor telemetry and click pulse inference
- cursor scale, visuals, and click-effect normalization
- reusable math for preview/export parity

This folder is the most important long-term refactor direction. Product behavior should move here before it grows further inside renderer or export monoliths.

### Electron main process

Main file:

- `electron/main.mjs`

Responsibilities:

- app bootstrap and native window creation
- capture IPC
- project persistence
- FFmpeg detection and provisioning
- export planning and command execution
- optional OpenAI-backed transcription

## Core data flow

### 1. Capture and project state

Screen, system audio, mic, cursor, and editor metadata are captured locally and persisted into project structures used by both preview and export.

### 2. Preview composition

Preview reads clip state and shared feature math to render:

- camera framing
- motion zoom
- cursor interpolation
- click effects
- timeline edits

### 3. Export planning

Export builds an FFmpeg render plan from the same clip/project state and the same shared motion/cursor logic where available.

### 4. Final render

FFmpeg performs composition, muxing, timing, overlays, and output encoding.

## Feature-specific architecture

### Motion Zoom

Relevant code:

- `src/shared/focusMotion.js`
- `src/App.tsx`
- `electron/main.mjs`

Principles:

- click intent should be readable
- camera movement should lead the action, not chase it
- preview and export must share timing semantics

### Cursor

Relevant code:

- `src/shared/cursorPath.js`
- `src/shared/cursorTelemetry.js`
- `src/shared/cursorTrack.js`
- `src/shared/cursorVisuals.js`
- `src/shared/cursorScale.js`

Principles:

- overlay cursor should visually explain the source cursor rather than lag behind it
- cursor asset choice, hotspot logic, interpolation, and scale should be shared across preview/export

### Click effect

Relevant code:

- `src/shared/cursorClickEffect.js`
- `src/App.css`
- `electron/main.mjs`

Principles:

- click emphasis is a visual layer, not a side effect of current cursor position
- preview and export should use the same timing and visual asset model

### Export

Relevant code:

- `electron/main.mjs`

Principles:

- export should be a deterministic transformation of project state
- avoid duplicate math when preview already has the correct model
- prefer explicit render plans over giant ad hoc filter-string logic

## Security and privacy boundaries

- recordings, projects, and exports stay local by default
- OpenAI usage is optional and BYOK
- Electron preload should remain the only renderer bridge
- sensitive changes require special care around IPC, file access, process execution, and export commands

## Known technical debt

- `src/App.tsx` is still too large
- `electron/main.mjs` is still too large
- automated preview/export parity testing is not yet present
- FFmpeg packaged-binary compliance needs a release-specific process
- bundled cursor SVG provenance should stay documented and reviewed

## Near-term refactor direction

1. Continue moving feature logic from renderer/export monoliths into `src/shared/`.
2. Add parity-oriented regression fixtures for motion zoom, cursor, and click effect.
3. Keep OpenAI integrations behind a narrow optional provider boundary.
