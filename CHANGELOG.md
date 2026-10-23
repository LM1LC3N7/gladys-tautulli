# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-23

## [0.1.1] - 2026-10-17

### Added

- First version, never tested against a real Tautulli: the Plex server
  watched by Tautulli v2, read only, through its API and API key.
- One server device: streams in progress, transcoding, direct play, direct
  stream, bandwidth total / LAN / WAN (kbit/s), Plex reachable.
- Up to 10 followed Plex users (by name or id), one device each: streams and
  the title playing.
- Scene trigger "Plex playback started, paused, resumed or stopped", with the
  user, title, media type and player as variables.
- Refresh every 15 s to 5 min (30 s by default).
- A refused API key is never retried without a user action; HTTP 429 and
  server errors pause every request (kept across a restart); the API key never
  appears in a log.
- Strict TLS by default; a self-signed certificate accepted by trust on first
  use or by a typed SHA-256 fingerprint, checked before the API key is sent.
- Buttons "Test the connection" and "Trust the new certificate".

[Unreleased]: https://github.com/LM1LC3N7/gladys-tautulli/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-tautulli/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-tautulli/releases/tag/v0.1.1
