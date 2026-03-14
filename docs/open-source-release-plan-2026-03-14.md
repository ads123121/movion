# Open Source Release Plan - 2026-03-14

## Why this needs a separate OSS edition

The current repository is a strong local-first product prototype, but not yet a public-ready open source repository.

Main reasons:

- branding still contains legacy fork-era language
- repository hygiene is not ready for a public launch
- legal and licensing artifacts are missing
- OpenAI-powered features are embedded directly as product features, not yet framed as optional integrations
- FFmpeg redistribution and third-party compliance need explicit treatment

## Current repo blockers for public release

### Repo metadata

- `package.json` still has `"private": true`
- there is no top-level `LICENSE`
- there is no `CONTRIBUTING.md`
- there is no `SECURITY.md`
- there is no `CODE_OF_CONDUCT.md`
- there is no `.github/ISSUE_TEMPLATE`
- there is no pull request template
- there is no `FUNDING.yml`

### Branding and positioning

- repo name and README still need to avoid any legacy fork framing
- README explicitly references Canvid runtime folders and import paths
- the project should be presented as an independent product with compatibility import support, not as a branded fork

### Repo cleanliness

- root currently contains local media artifacts (`*.mp4`)
- root contains runtime artifacts (`dist`, `node_modules`, `smoke-start*.log`, `output`)
- `.gitignore` is too small for a desktop capture app

### Legal/compliance

- FFmpeg usage is real and needs release-time compliance documentation
- OpenAI integration exists and needs a privacy/data-flow explanation
- there is no third-party notice file

## Recommended OSS strategy

## 1. Publish an independent open source core

Open source the product as a standalone project, not as "Canvid, but public".

Recommended structure:

- `core app`: capture, editor, cursor system, motion zoom, export
- `compat import`: optional importer for Canvid state
- `ai integrations`: optional provider-backed features, starting with OpenAI transcription

This keeps the core honest:

- useful without cloud
- legally cleaner
- more appealing to contributors
- stronger for grants

## 2. Rebrand before going public

Do not publish the public repo under a name centered on another product’s trademark.

Recommended:

- new repository name
- new app name in README and package metadata
- keep migration/import support, but move it under compatibility language such as:
  - `Import from Canvid`
  - `Canvid migration support`

Avoid:

- primary branding as a fork
- marketing copy that sounds like a derivative clone

## 3. Make OpenAI usage optional, not foundational

Current repo already works largely as a local-first desktop app. That is an advantage.

Open source edition should keep:

- all capture/edit/export features working without OpenAI
- OpenAI only for optional AI enhancements

Recommended AI boundary:

- transcript generation
- future semantic editing helpers
- future auto-chaptering or edit suggestions
- future QA / export verification helpers

Implementation principle:

- BYOK only
- clear env var setup
- explicit consent before data leaves device
- visible privacy note in UI and docs

## 4. Choose a standard license

Do not invent a custom license.

Preferred options:

- `Apache-2.0` if you want a modern permissive license with an explicit patent grant
- `MIT` if you want the simplest possible permissive license

Recommendation for this project:

- `Apache-2.0`

Reason:

- desktop application
- meaningful implementation work around rendering/motion/export
- better patent posture than MIT
- acceptable and familiar in startup/open source ecosystems

If you want stronger share-back obligations later, evaluate `MPL-2.0`, but that is likely unnecessary for the first public release.

## 5. Treat FFmpeg as a release engineering concern

For source publication, the code can remain public.

For packaged binaries, add a release policy for FFmpeg:

- do not use GPL or nonfree FFmpeg builds unless you intentionally accept those obligations
- document exactly which FFmpeg build is expected
- publish corresponding notices and source references when redistributing binaries
- add FFmpeg attribution to the app and docs

Lowest-friction OSS path:

- open-source repo first
- let contributors use system FFmpeg or a documented install path
- add packaged redistribution only after legal/compliance docs are in place

## 6. Add community health files before public launch

Minimum required:

- `LICENSE`
- `README.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `SUPPORT.md`
- issue templates
- pull request template

Recommended also:

- `GOVERNANCE.md`
- `ROADMAP.md`
- `ARCHITECTURE.md`
- `THIRD_PARTY_NOTICES.md`
- `PRIVACY.md`

## 7. Add supply-chain basics

Minimum:

- GitHub Actions CI for build/lint
- Dependabot for npm
- secret scanning
- dependency graph
- SBOM export

Recommended:

- signed release artifacts or provenance attestations
- release checklist for desktop packaging

## 8. Clean repository contents before first public commit

Do not publish:

- `node_modules`
- `dist`
- local logs
- sample recordings unless you fully own and want them public
- personal test media
- any generated runtime data

Expand `.gitignore` for:

- `output/`
- `*.mp4`
- `*.mov`
- `*.wav`
- `*.jsonl`
- local env files
- packaged binaries

## OpenAI-specific opportunity map

## Best public fit as of 2026-03-14

The strongest public fit is the `Codex open source fund`.

What it currently asks for:

- your project name
- repo URL
- project description
- team members and roles
- how you would use API credits

This is the clearest program match for an open source developer tool.

## Other OpenAI programs that may help but are not the main grant path

- `OpenAI for Startups`
  Good for community, events, learning resources, and startup visibility.
- `Researcher Access Program`
  Relevant only if you frame part of the work as research.
- specialized grants
  Usually domain-specific and not the primary fit for this product.

## Important application implication

The current Codex open source fund terms explicitly state that OpenAI may independently develop similar ideas and does not assume exclusivity.

Practical meaning:

- do not submit anything you are not comfortable making non-confidential
- publish your public-facing story first
- apply with a crisp open source roadmap, not secret sauce language

## Recommended grant narrative

Position the project as:

- a local-first open source desktop studio for technical screencasts
- focused on cursor clarity, motion zoom, readable exports, and creator control
- useful for developers, educators, and OSS maintainers making product demos and tutorials
- enhanced by optional OpenAI features rather than dependent on them

Best API-credit use cases to pitch:

- transcript generation
- edit suggestions from transcripts
- semantic scene segmentation
- auto-generated tutorial chapters
- accessibility outputs such as summaries and caption cleanup
- export QA agents that inspect transcript/timeline mismatches

Do not pitch credits for vague experimentation.

Pitch them as:

- concrete product improvements
- measurable contributor/user value
- open source leverage for the broader ecosystem

## Recommended release sequence

### Phase 1: Prepare the repo

- rename project
- clean artifacts
- add license and community docs
- split AI features behind explicit provider boundaries
- document FFmpeg/OpenAI/privacy behavior

### Phase 2: Public alpha

- publish repo
- ship source build instructions
- publish one demo video and screenshots
- create roadmap and good-first issues
- collect first external testers

### Phase 3: Grant application

- apply to Codex open source fund
- join OpenAI startup community if you are forming a startup around it
- include:
  - demo
  - public repo
  - architecture summary
  - precise API-credit plan
  - evidence of community pull or contributor interest

### Phase 4: Hardening

- release packaging pipeline
- FFmpeg compliance pack
- SBOM
- release notes
- security intake process

## Practical recommendation

The correct move is not:

- open-source this repo exactly as it is

The correct move is:

- create a clean public-facing OSS edition
- rebrand it as an independent product
- keep the core local and open
- make OpenAI integrations optional and explicit
- apply to the Codex open source fund with a strong public roadmap
