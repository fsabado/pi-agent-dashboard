## ADDED Requirements

### Requirement: Production tags publish GitHub Releases (not draft)

The publish workflow SHALL classify version tags by shape and SHALL publish (not draft) GitHub Releases for production tags. A production tag matches the anchored regular expression `^v\d+\.\d+\.\d+$`. Any tag containing a hyphen-separated suffix (`-alpha.N`, `-beta.N`, `-rc.N`, etc.) is a pre-release tag and SHALL still create a draft so a maintainer can eyeball artifacts before flipping to published. `electron-updater` cannot resolve drafts via its default GitHub provider, so production releases MUST be published immediately for auto-update to function.

#### Scenario: Production tag publishes immediately

- **WHEN** a tag matching `^v\d+\.\d+\.\d+$` (for example `v1.2.3`) is pushed and the workflow's build and upload steps complete successfully
- **THEN** the GitHub Release SHALL be created with `draft: false` and `prerelease: false`
- **AND** `electron-updater` clients SHALL be able to resolve the release via the default GitHub provider

#### Scenario: Pre-release tag creates a draft

- **WHEN** a tag matching `^v\d+\.\d+\.\d+-[a-z]+(\.\d+)?$` (for example `v1.2.3-rc.1`) is pushed
- **THEN** the GitHub Release SHALL be created with `draft: true`
- **AND** the maintainer SHALL be able to flip the release to published manually after review

#### Scenario: Release-cut skill no longer assumes draft for production cuts

- **WHEN** a maintainer cuts a production release using the `release-cut` skill
- **THEN** the skill SHALL document that the resulting GitHub Release will be published (not drafted)
- **AND** any "edit the draft before publishing" affordance SHALL be moved to the pre-release flow

### Requirement: Update-metadata files attached to GitHub Release

The publish workflow SHALL attach `latest.yml`, `latest-mac.yml`, and `latest-linux.yml` to the GitHub Release alongside the installer artifacts produced by the corresponding matrix variants. The metadata files SHALL be uploaded in the same `softprops/action-gh-release` invocation (or equivalent) as the installers so atomicity is preserved — partial uploads (installer present, metadata missing) SHALL fail the workflow.

#### Scenario: Workflow fails if metadata missing for a platform that produced an installer

- **GIVEN** the Windows matrix variant produced an NSIS `.exe`
- **WHEN** the upload step runs and `latest.yml` is not present in the artifacts directory
- **THEN** the workflow SHALL exit non-zero and SHALL NOT publish the release

#### Scenario: macOS metadata merges arm64 and x64 entries

- **GIVEN** both `macos-13` (x64) and `macos-14` (arm64) matrix variants completed
- **WHEN** the workflow uploads macOS artifacts
- **THEN** a single `latest-mac.yml` SHALL be uploaded whose `files[]` array references both DMGs

#### Scenario: All metadata uploaded in one release-creation step

- **WHEN** the workflow creates the GitHub Release
- **THEN** every artifact (installers + `latest*.yml`) SHALL be attached in a single atomic step
- **AND** no second-stage workflow run SHALL edit the release after creation

### Requirement: macOS signing secrets present for production tags

The publish workflow SHALL fail fast on any production tag if any of the macOS signing/notarisation secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) is missing or empty. Auto-update on macOS depends on signing; releasing an unsigned macOS DMG bricks the update channel for every existing macOS installation.

#### Scenario: Missing signing secret on production tag fails workflow

- **GIVEN** the workflow triggers on a tag matching `^v\d+\.\d+\.\d+$`
- **WHEN** any of the listed signing secrets is unset or empty
- **THEN** the workflow SHALL exit non-zero before producing any macOS artifact
- **AND** the failure message SHALL name the missing secret(s)

#### Scenario: Missing signing secret on pre-release tag is a warning, not failure

- **GIVEN** the workflow triggers on a tag matching `^v\d+\.\d+\.\d+-`
- **WHEN** any of the listed signing secrets is unset
- **THEN** the workflow SHALL emit a warning and SHALL produce an unsigned DMG
- **AND** the resulting draft release SHALL clearly mark the macOS DMG as not-update-eligible
