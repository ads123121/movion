# Privacy

## Local-first by default

Movion is designed to work locally.

By default:

- recordings are stored locally
- projects are stored locally
- exports are stored locally
- editor state remains on the machine
- this repository does not include built-in telemetry or remote analytics

## Optional provider-backed features

OpenAI-backed transcription is optional.

If you set `OPENAI_API_KEY` and trigger transcript generation:

- selected audio from the clip is sent to OpenAI
- the returned transcript is stored locally in the project

If you do not set `OPENAI_API_KEY`, that feature is unavailable and the rest of the app can still be used.

## Repository hygiene

This public repository should never include:

- private screen recordings
- exported videos from private work
- internal screenshots
- logs with sensitive content
- secrets or local environment files

## Future policy

If additional cloud-backed features are added:

- they should be opt-in
- the data flow should be documented before release
- the UI should make it clear when data leaves the device
