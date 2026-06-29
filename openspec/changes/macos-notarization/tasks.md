# Tasks — macos-notarization

## Prerequisites (manual, off-CI)

- [ ] Enroll / confirm **Apple Developer Program** membership for `Black Belt Technology Kft.` ($99/yr)
- [ ] Create a **Developer ID Application** certificate in the Apple Developer portal; export it + private key as a password-protected `.p12`
- [ ] Create an **app-specific password** for the Apple ID used by notarytool (appleid.apple.com → Sign-In and Security)
- [ ] Note the **Team ID** (10-char) from the Apple Developer account
- [ ] Add the five repo secrets: `CSC_LINK` (`base64 -i cert.p12`), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`

## Implementation

- [ ] Add a keychain-provisioning step to the macOS legs of `.github/workflows/_electron-build.yml` (D2): create temp keychain in `$RUNNER_TEMP`, decode `CSC_LINK`, `security import`, `set-key-partition-list`, `list-keychains`. Gated on `env.CSC_LINK != ''`.
- [ ] Export `APPLE_IDENTITY` (cert Common Name), `APPLE_ID`, `APPLE_ID_PASSWORD` (= `APPLE_APP_SPECIFIC_PASSWORD`), `APPLE_TEAM_ID` as env on the `Make Electron distributables (macOS)` `electron-forge package` step so `forge.config.ts` `osxSign`/`osxNotarize` activate.
- [ ] Confirm `electron-builder --mac dmg --prepackaged` keeps `CSC_IDENTITY_AUTO_DISCOVERY=false` (no re-sign) — already set by `fix-electron-auto-update-pipeline`; add a comment tying it to this change.
- [ ] Add a `xcrun stapler staple` step on the produced DMG (offline first-launch).
- [ ] Add a production-tag secret guard to `.github/workflows/publish.yml` (D3): on `^v\d+\.\d+\.\d+$`, fail before the electron job if any of the 5 signing secrets is empty; name the missing one(s). Pre-release tags → `::warning::` only.

## Verification (in-CI, fail-closed)

- [ ] Add a post-build verify step (macOS legs, gated on `CSC_LINK`): `codesign --verify --deep --strict --verbose=2` on the `.app`, `spctl -a -t exec -vvv` → "Notarized Developer ID", `xcrun stapler validate` on the DMG. Any non-zero fails the job.
- [ ] Add `packages/shared/src/__tests__/publish-workflow-macos-signing.test.ts` — parse `_electron-build.yml` + `publish.yml`; assert the macOS legs declare keychain-import → package(with APPLE_* env) → staple → verify in order, all gated on `CSC_LINK`, and that `publish.yml` has the production-tag secret guard.

## Documentation

- [ ] Add a "macOS code signing & notarisation" section to `docs/release.md`: secret setup, cert renewal date, failure modes (2FA expiry, app-specific-password rotation, notarytool rate limits), and the rollback procedure. (Delegate `docs/` write per AGENTS.md Documentation Update Protocol, caveman style.)
- [ ] Note the signing flow in `docs/architecture.md` "Electron Auto-Update" section (signed+notarised is the Squirrel.Mac gate). (Delegate, caveman style.)
- [ ] Update the `publish.yml` / `_electron-build.yml` rows in `docs/file-index-*.md` with the signing contract. (Delegate, caveman style.)
- [ ] Add a `CHANGELOG.md` `[Unreleased] → Changed` line describing macOS signing + notarisation.

## Post-ship cleanup (after a signed release validates)

- [ ] Remove the **macOS half** of `UnsignedBinaryNote` in `site/src/components/InstallTabs.tsx` and the macOS section of `.github/release-notes-footer.md`. (Once both this and `windows-authenticode-signing` ship, drop the whole component + `unsignedNote` flag.)
- [ ] Mark `fix-electron-auto-update-pipeline` §4 (tasks 4.1–4.6) complete — this change implements them.

## Validation (post-merge, post-cert-issuance)

- [ ] Cut a `v0.0.0-test.1` pre-release tag — confirm the macOS legs sign + notarise green (or warn-unsigned if secrets absent).
- [ ] Download the DMG on a fresh macOS machine (no prior pi-dashboard) — confirm first launch passes Gatekeeper with no right-click-Open workaround.
- [ ] Confirm `spctl -a -t exec -vvv <app>` reports `source=Notarized Developer ID` and `xcrun stapler validate <dmg>` exits 0.
- [ ] On macOS: install the previous public release, push a higher production tag, confirm the in-app updater downloads + applies (Squirrel.Mac accepts the signed update).
