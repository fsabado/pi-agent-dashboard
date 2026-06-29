## Why

The Electron app wires up `electron-updater` end-to-end (`packages/electron/src/lib/app-updater.ts`, dialog UI in `main.ts:377-403`), but no user has ever seen an update prompt. The publish pipeline does not produce the metadata `electron-updater` requires, and releases are drafted rather than published. Today every scheduled check returns "no update available" and silently no-ops, so users stay on whatever version they first installed even when a new release exists on GitHub.

## What Changes

- Generate `latest.yml` / `latest-mac.yml` / `latest-mac-arm64.yml` / `latest-linux.yml` update-metadata files (version, path, sha512, releaseDate) for every artifact uploaded to a GitHub Release. Without these `electron-updater` cannot resolve an update.
- Stop publishing GitHub Releases as drafts. The `release-cut` workflow currently sets `draft: true`; flip to published (or auto-promote on green CI) so `electron-updater`'s default GitHub provider can see them. Pre-release tags MAY remain drafts but production tags MUST be published.
- Configure `publish` provider explicitly in the Electron build (e.g. `provider: github`, `owner`, `repo`) so `electron-updater` reads from the same release stream the workflow writes to.
- Sign the macOS build (Developer ID + notarisation) so Squirrel.Mac will accept the downloaded update. Without signing, macOS auto-update silently fails the staging step. Windows NSIS signing remains out of scope (per existing D12 decision) but the unsigned NSIS update path SHALL be tested.
- Surface `onError` from `app-updater.ts` to the Electron log file (`~/.pi/dashboard/electron.log` or equivalent) instead of swallowing every failure, so future regressions are diagnosable.
- Add a manual "Check for updates…" menu item in the existing app menu (`packages/electron/src/lib/app-menu.ts`) so users can trigger a check on demand instead of waiting up to 24 h.
- Document the end-to-end update flow in `docs/architecture.md` and add an FAQ entry "Why didn't I get an update?" pointing at the publish + signing prerequisites.

## Capabilities

### New Capabilities

- `electron-auto-update`: runtime behaviour of the Electron self-updater — check schedule, update-available / update-downloaded dialog flow, manual menu entry, error logging, and the publish-channel contract the runtime expects.

### Modified Capabilities

- `electron-build-pipeline`: build-side requirements for emitting `latest*.yml` update metadata next to the binaries, configuring the `publish` provider, and the macOS signing/notarisation step needed for Squirrel.Mac.
- `ci-cd-pipeline`: release workflow MUST publish (not draft) production tags and MUST attach the update-metadata files to the GitHub Release alongside the installers.

## Impact

- **Code**: `packages/electron/forge.config.ts` (publishers / `latest*.yml` generation), `packages/electron/src/lib/app-updater.ts` (error logging, manual-check entry point), `packages/electron/src/lib/app-menu.ts` (Check for updates… item), `.github/workflows/publish.yml` (drop `draft: true` on production tags, attach metadata files, run signing/notarisation).
- **Secrets/CI**: macOS signing identity + notarisation credentials added to CI secrets (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`).
- **Skills**: `release-cut` skill instructions updated — production cuts no longer leave a draft for manual editing; the workflow publishes directly. `release-revoke` skill updated to handle published-not-drafted releases.
- **User-visible**: existing installs (≤ current version) will receive their first auto-update prompt after the first release that ships with the new metadata. No protocol or data-format change.
- **Out of scope**: differential / delta updates, in-app release notes rendering, Windows code signing, auto-update for the standalone (non-Electron) `pi-dashboard` server install — that remains npm-driven.
