# Roadmap

## Public alpha baseline

Current public baseline:

- local-first desktop capture and editing
- cinematic motion zoom groundwork
- cursor overlay system
- click effects
- FFmpeg-backed export
- optional OpenAI transcription

## Next 30 days

### 1. Preview/export parity hardening

- eliminate remaining duplicate motion/cursor math
- add parity regression fixtures for zoom, cursor, and click effect
- reduce FFmpeg expression fragility in export planning

### 2. Cursor quality push

- improve high-speed cursor fidelity
- stabilize hotspot and asset transitions
- keep click visuals locked to actual click locations

### 3. Motion Zoom quality push

- further refine anticipatory, click-centered zoom timing
- improve dense multi-click behavior
- preserve readability during camera return transitions

## Next 60 days

### 1. Monolith reduction

- split `src/App.tsx` into feature modules
- split export planning from `electron/main.mjs`
- isolate persistence, capture, and export orchestration boundaries

### 2. Public contributor ergonomics

- architecture walkthroughs
- better issue labels and contributor onboarding
- more example projects and smoke-test scenarios

### 3. Packaging and compliance

- document FFmpeg redistribution policy
- add third-party notice maintenance workflow
- prepare reproducible release checklist

## Next 90 days

### 1. AI-assisted workflows

- transcript cleanup
- chapter suggestions
- semantic edit suggestions
- export QA helpers

These remain optional and should never block local use.

### 2. Release quality

- signed release pipeline
- stronger CI
- repeatable export validation on sample projects

## Product principles

- local-first by default
- preview and export should feel identical
- camera motion must explain user intent
- cursor treatment must improve clarity without feeling synthetic
- optional AI should enhance workflows, not become a product dependency
