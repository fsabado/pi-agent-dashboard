## Context

`fix-electron-auto-update-pipeline` reorganised the macOS build: `electron-forge package` produces the universal `.app` (and is the step where `forge.config.ts` `osxSign`/`osxNotarize` run, gated on `APPLE_IDENTITY`), then `electron-builder --mac dmg --prepackaged` wraps the already-built `.app` into a DMG + `latest-mac.yml` + `app-update.yml`, with `CSC_IDENTITY_AUTO_DISCOVERY=false` so electron-builder does NOT re-sign. So the **single signing point is the Forge package step**, and the only missing ingredient is the secrets + a keychain holding the cert.

GitHub-hosted `macos-14` (arm64) and `macos-15-intel` (x64) runners have `xcrun`, `codesign`, `notarytool`, and `security` (keychain) preinstalled. They do NOT have any signing identity in the default keychain — a `.p12` must be imported per run into a temporary keychain that is deleted on job end.

Stakeholders: macOS end users (Gatekeeper block + no updates), maintainers (manual upgrade comms), security (CVE fixes cannot reach macOS users). No external API consumers.

## Goals / Non-Goals

**Goals:**
- Every macOS DMG on a production tag SHALL be Developer-ID-signed, notarised, and stapled.
- macOS first launch SHALL pass Gatekeeper with no user workaround (offline-capable via stapled ticket).
- macOS auto-update (Squirrel.Mac) SHALL accept the update (signature verifies).
- Missing signing secrets on a production tag SHALL fail the workflow fast (never silently ship unsigned).
- Fork PRs without secrets SHALL still build (unsigned, warned).

**Non-Goals:**
- Windows Authenticode (owned by `windows-authenticode-signing`).
- Linux AppImage signing (unsigned by convention; no Gatekeeper equivalent).
- Signing the standalone npm `pi-dashboard` install.
- Hardened-runtime entitlement re-design — `entitlements.plist` already exists and is correct.

## Decisions

### D1: Sign in the Forge package step, not electron-builder

**Decision:** Sign in `electron-forge package` via `forge.config.ts` `osxSign`/`osxNotarize`. Provide the secrets as env vars on that CI step. electron-builder stays `--prepackaged` + `CSC_IDENTITY_AUTO_DISCOVERY=false` (no re-sign).

**Note:** `fix-electron-auto-update-pipeline` REMOVED the inline `osxSign`/`osxNotarize` block from `forge.config.ts` (it was dead — no `APPLE_IDENTITY` in any workflow — and broke `tsc` once the DMG maker was dropped). This change RE-ADDS it with the current `@electron/osx-sign` option shape (verify `entitlements`/`entitlementsInherit` field names against the installed version; the old `entitlements-inherit` kebab key no longer typechecks).

**Why:** `fix-electron-auto-update-pipeline` already wired this split. Re-signing in electron-builder would double-sign (or strip the Forge signature) and duplicate config. One signing point = one place to reason about.

**Alternative considered:** Move signing to electron-builder's native `CSC_LINK` flow. Rejected — would require removing the Forge `osxSign` block and re-validating notarisation through electron-builder; larger, riskier, no benefit.

### D2: Secret shape — base64 `.p12` imported into a temporary keychain

**Decision:** Store the Developer-ID Application cert + private key as a base64-encoded `.p12` in `CSC_LINK`, password in `CSC_KEY_PASSWORD`. A CI step decodes it, creates a temporary keychain, imports the `.p12`, and unlocks it. `APPLE_IDENTITY` is set to the cert's Common Name (e.g. `Developer ID Application: Black Belt Technology Kft. (TEAMID)`) so `osxSign` selects it. Notarisation uses `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`.

**Why:** `.p12`-in-secret is the standard GitHub-hosted-runner path (no HSM/token). Temporary keychain avoids polluting the runner's login keychain and is auto-discarded.

**Keychain step shape:**
```bash
KEYCHAIN="$RUNNER_TEMP/signing.keychain-db"
security create-keychain -p "$RUNNER_TEMP_PW" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$RUNNER_TEMP_PW" "$KEYCHAIN"
echo "$CSC_LINK" | base64 --decode > "$RUNNER_TEMP/cert.p12"
security import "$RUNNER_TEMP/cert.p12" -k "$KEYCHAIN" -P "$CSC_KEY_PASSWORD" \
  -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple: -k "$RUNNER_TEMP_PW" "$KEYCHAIN"
security list-keychains -d user -s "$KEYCHAIN" login.keychain-db
```

### D3: Production-tag guard; pre-release tags may ship unsigned

**Decision:** A guard step computes whether the tag matches `^v\d+\.\d+\.\d+$` (production). On production, if any of `CSC_LINK`/`CSC_KEY_PASSWORD`/`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` is empty, the workflow exits non-zero **before** building any macOS artifact, naming the missing secret(s). On pre-release tags (`-rc.N` etc.), missing secrets emit a `::warning::` and the build proceeds unsigned (marked not-update-eligible).

**Why:** Shipping an unsigned production DMG bricks the update channel for every existing macOS install (Squirrel.Mac rejects unsigned), and re-exposes the Gatekeeper block. Pre-releases are for staging and are invisible to stable updater clients, so unsigned is tolerable there. This mirrors the `ci-cd-pipeline` requirement already added by `fix-electron-auto-update-pipeline` and the `windows-authenticode-signing` fork-safe gate.

### D4: Notarise + staple; verify fail-closed

**Decision:** `osxNotarize` (notarytool under the hood in `@electron/notarize`) submits the `.app` and waits. After the DMG is built, a verify step runs:
- `codesign --verify --deep --strict --verbose=2 <app>` → exit 0
- `spctl -a -t exec -vvv <app>` → "accepted, source=Notarized Developer ID"
- `xcrun stapler validate <dmg>` → exit 0

Any failure fails the job. The DMG is stapled (`xcrun stapler staple`) so first launch works offline.

**Why:** "Signing succeeded but the uploaded artifact was the unsigned one" is the classic silent failure (called out in `windows-authenticode-signing`). Fail-closed verification on the exact artifact that ships is the only defence.

**Risk — notarisation flakiness:** notarytool can rate-limit or hang. **Mitigation:** treat notarisation failure as a workflow failure (gate the release on it), document the refresh procedure (`docs/release.md`), and rely on the pre-release path for risky cuts.

### D5: Fork-PR safe — gate on secret presence

**Decision:** All signing/notarisation/verify steps run only when `env.CSC_LINK != ''`. Fork PRs (no secret access) skip them with a `::warning::` and ship unsigned. Mirrors `windows-authenticode-signing` D4 so CI on forks stays green.

## Risks / Trade-offs

- **Apple ID 2FA / app-specific-password rotation** → notarisation fails silently in CI, only macOS users notice eventually. **Mitigation:** gate the release on notarisation exit code; document rotation in `docs/release.md`.
- **Cert expiry (annual)** → all macOS releases fail to sign. **Mitigation:** the production-tag guard fails loudly; document the renewal date + procedure.
- **Universal-binary signing** — the `.app` is universal (arm64+x64). `codesign`/notarytool handle universal Mach-O natively; no per-arch split needed. Verify on both matrix legs.
- **Keychain leakage** — temporary keychain in `$RUNNER_TEMP` is discarded on job end; never written to the login keychain.
