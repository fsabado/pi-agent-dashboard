## ADDED Requirements

### Requirement: macOS first launch passes Gatekeeper without a workaround

Every macOS DMG produced on a production tag SHALL contain a Developer-ID-signed, notarised, and **stapled** `.app`, so that a freshly downloaded copy launches on a clean macOS machine without the *"cannot be opened because Apple cannot check it"* / *"is damaged"* Gatekeeper block and without the user clearing the quarantine attribute. Stapling SHALL make first launch succeed offline (no network round-trip to Apple at launch).

#### Scenario: Fresh download launches without right-click-Open

- **GIVEN** a macOS DMG built from a production tag (`^v\d+\.\d+\.\d+$`)
- **WHEN** a user downloads it on a machine that has never run pi-dashboard and double-clicks the app
- **THEN** Gatekeeper SHALL allow the launch with no "cannot be opened" / "damaged" dialog
- **AND** the launch SHALL succeed with the network unavailable (stapled ticket)

#### Scenario: Stapled ticket present on the DMG

- **WHEN** a production-tag macOS build completes
- **THEN** `xcrun stapler validate <path>.dmg` SHALL exit zero
- **AND** `spctl -a -t exec -vvv <app>` SHALL report `source=Notarized Developer ID`

### Requirement: CI provisions a signing keychain and guards production tags

The publish pipeline SHALL import the Developer-ID Application certificate from the `CSC_LINK` / `CSC_KEY_PASSWORD` secrets into a temporary keychain on the macOS runners, expose `APPLE_IDENTITY` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` to the signing step, and SHALL fail fast on any production tag when a required signing secret is missing.

#### Scenario: Missing signing secret on a production tag fails the workflow

- **GIVEN** the workflow triggers on a tag matching `^v\d+\.\d+\.\d+$`
- **WHEN** any of `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` is unset or empty
- **THEN** the workflow SHALL exit non-zero before producing any macOS artifact
- **AND** the failure message SHALL name the missing secret(s)

#### Scenario: Pre-release tag without secrets warns and ships unsigned

- **GIVEN** the workflow triggers on a pre-release tag (e.g. `v1.2.3-rc.1`)
- **WHEN** a signing secret is unset
- **THEN** the workflow SHALL emit a `::warning::` and SHALL produce an unsigned DMG
- **AND** the draft release SHALL mark that DMG as not-update-eligible

#### Scenario: Temporary keychain is discarded

- **WHEN** the macOS signing step imports the certificate
- **THEN** the certificate SHALL be imported into a keychain under `$RUNNER_TEMP`, never the login keychain
- **AND** the keychain SHALL not persist beyond the job

### Requirement: macOS signing and notarisation verified fail-closed

The build SHALL verify the exact DMG/`.app` that will be uploaded — not an intermediate copy — and SHALL fail the job on any verification miss, so a "signing claimed but the unsigned artifact shipped" regression cannot reach a Release.

#### Scenario: Verification gate on the shipped artifact

- **WHEN** a production-tag macOS DMG is produced
- **THEN** `codesign --verify --deep --strict <app>` SHALL exit zero
- **AND** `spctl -a -t exec <app>` SHALL accept the app as Notarized Developer ID
- **AND** `xcrun stapler validate <dmg>` SHALL exit zero
- **AND** any non-zero result SHALL fail the workflow before the Release is created

### Requirement: Fork PRs build unsigned without secret access

CI on a forked pull request (which cannot read repo secrets) SHALL still build macOS artifacts, skipping the signing / notarisation / verification steps and emitting a `::warning::`, so fork CI stays green.

#### Scenario: Fork PR ships an unsigned DMG with a warning

- **GIVEN** a pull request from a fork where `CSC_LINK` is empty
- **WHEN** the macOS build runs
- **THEN** the signing, notarisation, and verification steps SHALL be skipped
- **AND** the workflow SHALL emit a `::warning::` noting the DMG is unsigned
- **AND** the job SHALL complete successfully
