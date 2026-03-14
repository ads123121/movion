# Migration

## Legacy import support

Movion can scan for and import compatible state from earlier local installs.

This feature exists for migration support only. It is not part of the product branding.

## What can be imported

- project files
- preset files
- window state

## Legacy Windows locations currently scanned

- `%LOCALAPPDATA%/Canvid`
- `%USERPROFILE%/Videos/Canvid/Projects`
- `%USERPROFILE%/Videos/Canvid/Presets`

## Notes

- imported data is copied into the Movion workspace
- the original files are not modified
- missing legacy data does not affect normal Movion usage

## Maintainer guidance

If this migration layer changes:

- keep user-facing copy branded as `Movion`
- describe the source as `legacy import` or `previous installation`
- preserve backward compatibility only where it adds real user value
