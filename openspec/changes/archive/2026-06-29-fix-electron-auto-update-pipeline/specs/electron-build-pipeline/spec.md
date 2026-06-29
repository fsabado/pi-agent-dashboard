## ADDED Requirements

### Requirement: Update-metadata files generated for every release artifact

The Electron build pipeline SHALL produce update-metadata YAML files alongside every installer/binary artifact, in the format consumed by `electron-updater`. These metadata files SHALL be named `latest.yml` (Windows), `latest-mac.yml` (macOS, listing both arm64 and x64 entries in `files[]`), and `latest-linux.yml` (Linux). Each metadata file SHALL contain `version`, `path`, `sha512`, `releaseDate`, and a `files[]` array describing every artifact.

#### Scenario: Windows build emits latest.yml

- **WHEN** the Windows electron build runs
- **THEN** the output directory SHALL contain `latest.yml` listing the NSIS installer's filename, sha512, and size
- **AND** the file's `version` field SHALL match the workspace package version

#### Scenario: macOS build emits unified latest-mac.yml

- **WHEN** both arm64 and x64 macOS builds have completed
- **THEN** a single `latest-mac.yml` SHALL be produced whose `files[]` array contains both DMGs
- **AND** the metadata SHALL be byte-identical regardless of which arch builder ran last (deterministic merge)

#### Scenario: Linux build emits latest-linux.yml

- **WHEN** the Linux electron build runs
- **THEN** the output directory SHALL contain `latest-linux.yml` listing the AppImage's filename, sha512, and size

#### Scenario: sha512 in metadata matches binary

- **WHEN** any `latest*.yml` is generated
- **THEN** every `sha512` field SHALL equal the actual sha512 of the corresponding artifact file as it will be uploaded to the GitHub Release (no post-upload edit may invalidate the hash)

### Requirement: GitHub publish configuration embedded in packaged app

The Electron build SHALL configure `publish: { provider: 'github', owner: 'blackbelt-technology', repo: 'pi-agent-dashboard' }` so that `electron-builder` writes `app-update.yml` into the packaged app's resources. The runtime updater reads this file at startup; build and runtime SHALL therefore agree on the release stream by construction.

#### Scenario: app-update.yml present in packaged resources

- **WHEN** any production Electron build completes
- **THEN** the packaged app's resources directory SHALL contain `app-update.yml`
- **AND** the file SHALL declare `provider: github`, `owner: blackbelt-technology`, `repo: pi-agent-dashboard`

#### Scenario: app-update.yml ships as a packaged resource

- **WHEN** the mac/linux build runs electron-builder in `--prepackaged` mode (which skips the packaging phase that would otherwise emit `app-update.yml`)
- **THEN** `app-update.yml` SHALL still be present in the packaged app's resources directory, shipped via Forge `extraResource` (`packages/electron/resources/app-update.yml`)
- **AND** its `provider`/`owner`/`repo` SHALL match the build-time `publish` configuration

### Requirement: macOS build is Developer-ID-signed and notarised

Every macOS DMG produced by the publish pipeline SHALL be code-signed with a Developer ID Application certificate AND notarised by Apple's notarisation service before being uploaded to a GitHub Release. Squirrel.Mac (the macOS arm of `electron-updater`) refuses to apply unsigned updates; this requirement is the gate.

#### Scenario: DMG stapled with notarisation ticket

- **WHEN** a macOS DMG is produced for a production tag
- **THEN** `xcrun stapler validate <path>.dmg` SHALL exit zero
- **AND** the inner `.app` SHALL pass `codesign --verify --deep --strict`

#### Scenario: Missing signing secrets fails the build

- **GIVEN** any of `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` is missing in CI
- **WHEN** the macOS build step runs on a production tag (matching `^v\d+\.\d+\.\d+$`)
- **THEN** the build step SHALL exit non-zero and fail the workflow

#### Scenario: Local dev builds may skip signing

- **WHEN** a developer runs the macOS build locally without signing secrets in their environment
- **THEN** the build SHALL still succeed
- **AND** the resulting DMG SHALL be marked with `identity: null` (ad-hoc / unsigned) and clearly logged as not-update-eligible

### Requirement: Update-metadata uploaded with installers in the same release

Every upload to the GitHub Release SHALL include the matching `latest*.yml` metadata file alongside the corresponding installer. Upload of installer-without-metadata or metadata-without-installer SHALL be considered a failed release.

#### Scenario: Windows release contains installer + latest.yml

- **WHEN** a production tag publishes
- **THEN** the GitHub Release SHALL contain the NSIS `.exe` AND `latest.yml`

#### Scenario: macOS release contains DMGs + latest-mac.yml

- **WHEN** a production tag publishes
- **THEN** the GitHub Release SHALL contain both arm64 and x64 `.dmg` files AND a single `latest-mac.yml` referencing both

#### Scenario: Linux release contains AppImage + latest-linux.yml

- **WHEN** a production tag publishes
- **THEN** the GitHub Release SHALL contain the `.AppImage` AND `latest-linux.yml`

### Requirement: Build-config parity lint

A repo-lint test SHALL assert that the Forge config (`packages/electron/forge.config.ts`) and the electron-builder config declare the same `appId`, `productName`/executable name, icon paths, and version source. Drift between the two configs caused historical packaging bugs (e.g. `pi-dashboard` vs `pi-dashboard-electron` mismatches); auto-update is sensitive to the same drift because the packaged app's `app-update.yml` is written by electron-builder while other artifacts may originate from Forge.

#### Scenario: Lint passes when configs agree

- **WHEN** both configs declare the same `appId` (`com.blackbelt-technology.pi-dashboard`), `productName` (`PI Dashboard`), executable name (`pi-dashboard`), and icon paths
- **THEN** the parity test SHALL pass

#### Scenario: Lint fails on appId or productName drift

- **GIVEN** Forge declares `appId: 'foo'` and electron-builder declares `appId: 'bar'`
- **WHEN** the parity test runs
- **THEN** the test SHALL fail with a message naming the drift fields
