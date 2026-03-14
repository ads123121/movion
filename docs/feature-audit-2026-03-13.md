# Feature Audit - 2026-03-13

## Goal

Bring the inherited codebase to a state where the four most visible features behave as one coherent system:

- Motion Zoom Effect
- Cursor overlay
- Cursor click effect
- Export parity

The key quality bar is not "looks good in one mode". The target is:

- preview and export use the same motion semantics
- cursor overlay follows real user intent instead of drifting or lagging
- click emphasis stays readable and elegant in both preview and export
- camera motion explains the action to the viewer, instead of reacting late

## Current Architecture

### Core runtime split

- `src/App.tsx`
  Renderer monolith. Owns editor UI, live preview, capture-session orchestration, motion lane editing, timeline inspector, preview cursor drawing, transcript UI, audio lanes, and a large amount of feature glue.
- `electron/main.mjs`
  Electron monolith. Owns capture IPC, persistence, FFmpeg discovery/provisioning, export planning, filtergraph generation, transcript/media processing, and native runtime integration.
- `electron/preload.cjs`
  Thin IPC bridge. Mostly transport, low feature risk compared to renderer/export logic.

### Shared feature math introduced during cleanup

- `src/shared/focusMotion.js`
  Shared motion zoom timing and easing semantics.
- `src/shared/cursorTelemetry.js`
  Shared cursor approach metrics and click pulse inference.
- `src/shared/cursorPath.js`
  Shared cursor interpolation and projected visual point construction.
- `src/shared/cursorTrack.js`
  Shared cursor track normalization and raw point compaction.
- `src/shared/cursorVisuals.js`
  Shared cursor kind, hotspot and appearance normalization.
- `src/shared/cursorClickEffect.js`
  Shared LiquidGlass click effect asset and timing.
- `src/shared/cursorSampling.js`
  Shared range sampling.
- `src/shared/cursorScale.js`
  Shared pointer scale math for preview/export parity.

### Current size pressure

- `src/App.tsx`: 15k+ lines
- `electron/main.mjs`: 8.6k+ lines

This is the main structural source of regressions. Feature logic lives too close to orchestration and rendering details.

## Feature Flow Map

### 1. Motion Zoom

Capture phase:

- cursor clicks and cursor positions are recorded
- auto-focus regions are seeded from cursor click telemetry

Preview phase:

- focus regions are normalized
- motion segments are built from those regions
- state at playhead time is evaluated and applied to the stage camera

Export phase:

- clip focus regions are normalized again
- the same motion segments are rebuilt
- FFmpeg expressions are generated from those segments

Risk:

- any mismatch between preview-side and export-side segment generation makes zoom feel different after render

### 2. Cursor Overlay

Capture phase:

- cursor snapshots, kind, hotspot, appearance id and click events are collected

Preview phase:

- raw points are compacted
- normalized cursor track is sampled
- interpolated cursor point is projected with hotspot-aware scaling
- cursor is drawn with optional smoothing and motion tilt

Export phase:

- normalized cursor track is sampled again
- overlay samples are simplified
- cursor assets are grouped by appearance id
- FFmpeg overlay plan is generated

Risk:

- any drift in normalization, interpolation, hotspot handling or scale math makes the overlay feel fake

### 3. Click Effect

Capture phase:

- click events are preferred
- inferred pulses are fallback only

Preview phase:

- click pulse is drawn near the actual click anchor
- size and opacity are driven by LiquidGlass timing helpers

Export phase:

- click overlay plan is built from the same cursor track
- LiquidGlass asset and timing are reused

Risk:

- if preview/export use different timing or scale math, click emphasis feels inconsistent

### 4. Export

Pipeline:

- resolve FFmpeg
- normalize clip/timeline inputs
- prepare focus motion
- prepare cursor overlays
- prepare click overlays
- prepare captions/audio/background/camera layers
- build FFmpeg filter graph
- render clip or timeline

Risk:

- export still concentrates too much feature orchestration in `electron/main.mjs`
- FFmpeg expression generation remains sensitive to overly complex local logic

## Main Findings

### Motion Zoom findings

1. The hard part was never easing alone. The real issue was shot semantics around click anchoring, cue lead and readable post-click hold.
2. Shared `focusMotion.js` now owns those semantics, which is the right architecture.
3. Remaining debt is mostly glue debt: preview and export still wrap the shared layer in large monoliths.

### Cursor findings

1. Cursor quality depends on six linked concerns:
   - telemetry fidelity
   - raw point compaction
   - cursor kind stabilization
   - hotspot normalization
   - interpolation math
   - pointer scale parity
2. Earlier versions had these concerns scattered across renderer and export.
3. The cleanup already moved most of them into shared modules.
4. The remaining problem is not missing math, but too much orchestration still trapped in `App.tsx` and `main.mjs`.

### Click effect findings

1. Click emphasis should be anchored to the action, not to incidental cursor draw timing.
2. LiquidGlass is the correct current direction because it reads better than a generic ring pulse and fits a premium visual language.
3. The critical engineering rule is parity: one asset, one timing model, one scale model.

### Export findings

1. Export quality is only as good as its shared inputs.
2. Parser failures and visual drift came from duplicated logic and overly deep generated expressions.
3. Recent work already reduced risk by:
   - replacing nested FFmpeg expressions with additive piecewise expressions
   - preserving important cursor anchors during sample simplification
   - aligning cursor scale math between preview and export

## External Benchmark Summary

### Screen Studio

Observed product themes:

- cursor shake removal
- pointer rotation during motion
- refined zoom timing and follow behavior
- premium-looking cursor emphasis

Takeaway:

- their quality comes from treating cursor and camera motion as editorial layers, not as raw capture leftovers

### Camtasia

Observed product themes:

- explicit cursor effects layer
- separate cursor customization pipeline
- strong export-time cursor tooling

Takeaway:

- cursor logic should not be mixed into unrelated editor code paths

### FocuSee

Observed product themes:

- zoom auto-follow
- motion blur and cursor emphasis
- tunable smoothing controls

Takeaway:

- flexibility is useful, but parity and predictability matter more than exposing many knobs

## Cleanup Already Landed

- shared focus motion timing and normalization
- shared cursor telemetry
- shared cursor interpolation
- shared cursor visual normalization
- shared cursor sampling
- shared cursor track compaction and normalization
- shared LiquidGlass click effect timing and asset
- shared cursor scale math

This is the correct direction. The app is gradually moving from duplicated feature math toward one shared engine with multiple render targets.

## Remaining High-Value Refactors

### Priority 1

Extract a feature-level cursor engine wrapper so renderer and export stop constructing cursor point projection logic locally.

### Priority 2

Split `App.tsx` by feature ownership:

- preview compositor
- capture session / telemetry ingestion
- motion lane editor
- timeline and inspector UI

### Priority 3

Split `electron/main.mjs` by export concerns:

- FFmpeg runtime resolution
- cursor overlay planning
- click overlay planning
- focus motion planning
- clip/timeline render assembly

### Priority 4

Add a parity checklist or lightweight regression harness for:

- auto zoom timing
- cursor hotspot alignment
- click effect visibility
- preview/export position agreement

## Practical Rule For Future Work

If a change affects:

- cursor positions
- click timing
- focus region timing
- hotspot math
- pointer scale
- exported overlay positions

then preview and export must be updated together, or the change is incomplete.
