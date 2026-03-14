# Third-Party Notices

This document is a practical notice file for the public source repository. It is not legal advice.

## Source code license

Movion source code is released under Apache-2.0 unless otherwise noted in specific files.

See:

- [LICENSE](./LICENSE)

## Key upstream software

The repository depends on third-party packages with their own licenses. Current examples include:

- Electron: MIT
- React: MIT
- React DOM: MIT
- Vite: MIT
- TypeScript: Apache-2.0
- ESLint: MIT

The npm dependency graph and package license metadata are reflected in:

- `package-lock.json`

## FFmpeg

Movion relies on FFmpeg for export workflows.

Important notes:

- this source repository does not claim to relicense FFmpeg
- packaged desktop releases must comply with the FFmpeg license obligations of the actual binary build being distributed
- maintainers should review FFmpeg build flags and notice requirements before publishing installers

## OpenAI

Movion can optionally call OpenAI APIs for transcription features when a user provides `OPENAI_API_KEY`.

Important notes:

- OpenAI is optional, not required for the local-first core product
- API use is governed by OpenAI's own terms and policies
- users are responsible for their own API credentials

## Bundled visual assets

This repository includes SVG cursor assets in `cursors/`.

Maintainer note:

- if these assets are replaced or supplemented, their provenance and redistribution rights should be reviewed explicitly before packaging commercial or public binary releases

## Ongoing maintenance

Before each public release, maintainers should review:

1. dependency updates
2. FFmpeg redistribution assumptions
3. newly added bundled assets
4. any external service integration added since the previous release
