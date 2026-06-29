## Why

Every macOS DMG published by `.github/workflows/publish.yml` ships **unsigned and un-notarised**. Two distinct user-visible failures result:

1. **Gatekeeper blocks first launch.** macOS shows *"PI Dashboard can't be opened because Apple cannot check it for malicious software"* (or *"…is damaged and can't be opened"* when the quarantine bit is set on download). Users must right-click → Open, or run `xattr -dr com.apple.quarantine`, which a non-trivial fraction will not do. The static release-notes footer (`.github/release-notes-footer.md`) currently documents this workaround as a stopgap.

2. **Auto-update is dead on arrival on macOS.** `fix-electron-auto-update-pipeline` shipped the in-app updater, but Squirrel.Mac (electron-updater's macOS arm) **refuses to apply an update to or from an unsigned app** — it verifies the new `.app`'s Developer-ID signature against the running app before staging. So every macOS user is permanently stuck on whatever version they first installed, even after the update channel otherwise works. That change's design (D4) named signing as the hard gate and split it out as a separate, independently-revertable PR — this is that PR.

The build already carries the *plumbing*: `packages/electron/forge.config.ts` declares `osxSign` (hardenedRuntime + `entitlements.plist`) and `osxNotarize`, gated on `process.env.APPLE_IDENTITY`; `packages/electron/entitlements.plist` exists. But no workflow ever provides the signing secrets, so the gated block no-ops and every DMG ships unsigned. This change provides the secrets, imports the cert into a CI keychain, runs notarisation, and verifies the result fail-closed.

## What Changes

- Provision an **Apple Developer ID Application** certificate (Apple Developer Program, $99/yr) for `Black Belt Technology Kft.` and store it + notarisation credentials as repo secrets.
- Import the cert into a temporary keychain on the `macos-*` runners and provide `APPLE_IDENTITY` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` to the macOS `electron-forge package` step (the step that signs, since `fix-electron-auto-update-pipeline` moved DMG production to `electron-builder --prepackaged` which does NOT re-sign).
- Notarise the `.app` via `notarytool` and **staple** the ticket so offline first-launch passes Gatekeeper.
- Add a **production-tag guard**: on a tag matching `^v\d+\.\d+\.\d+$`, fail the workflow before producing any macOS artifact if any signing secret is missing. Pre-release tags warn and ship unsigned (not update-eligible).
- Add **fail-closed verification**: `codesign --verify --deep --strict`, `spctl -a -t exec`, and `xcrun stapler validate` on the produced DMG/`.app`; a signing-claimed-but-unsigned artifact fails the release.
- **Fork-PR safe**: gate signing on secret presence; fork PRs without the secret emit a `::warning::` and ship unsigned (dry-run), mirroring `windows-authenticode-signing` D4.
- Document the cert/notarisation setup + failure modes (2FA expiry, app-specific-password rotation, notarytool rate limits) in `docs/release.md`.
- Once a signed+notarised release ships: drop the **macOS half** of the `UnsignedBinaryNote` component (`site/src/components/InstallTabs.tsx`) and the macOS section of `.github/release-notes-footer.md`.

## Capabilities

### Modified Capabilities

- `electron-build-pipeline`: add the CI mechanism for Developer-ID signing + notarisation + stapling on macOS, the production-tag secret guard, the fail-closed verification gate, and the fork-PR unsigned dry-run fallback. (`fix-electron-auto-update-pipeline` already added the high-level "macOS DMG is signed+notarised so Squirrel.Mac accepts it" requirement from the *updater's* perspective; this change adds the concrete build-side guarantees: Gatekeeper first-launch, keychain provisioning, verification gate.)

## Impact

- **Code**: `.github/workflows/_electron-build.yml` (keychain import + `APPLE_*` env on the darwin package step + post-build verify step), `.github/workflows/publish.yml` (production-tag secret guard), `docs/release.md` (setup + failure modes), `docs/architecture.md` (signing flow note), `CHANGELOG.md`.
- **Secrets/CI**: `CSC_LINK` (base64 `.p12`), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- **Cost**: Apple Developer Program membership ($99/yr). One-time cert + app-specific-password setup; cert renews annually.
- **Relationship**: completes `fix-electron-auto-update-pipeline` §4 (its tasks 4.1–4.6) — that change can mark §4 done once this ships. Sibling to `windows-authenticode-signing` (Windows half).
- **User-visible**: macOS first launch stops showing the Gatekeeper block; macOS auto-update begins functioning for the first time.
- **Out of scope**: Windows Authenticode (tracked under `windows-authenticode-signing`), Linux signing (AppImage unsigned by convention), differential updates, signing the standalone npm `pi-dashboard` install.
