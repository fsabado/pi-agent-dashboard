## ADDED Requirements

### Requirement: Auto-update check schedule

The packaged Electron app SHALL initialise `electron-updater` on startup, perform an initial update check 60 seconds after launch, and SHALL repeat the check every 24 hours while the app remains running. The check SHALL be disabled in development mode (when `process.env.ELECTRON_DEV` is set or `process.resourcesPath` is unavailable).

#### Scenario: Initial check runs 60 seconds after launch

- **GIVEN** the packaged Electron app starts in production mode
- **WHEN** 60 seconds have elapsed since `app.whenReady()` resolved
- **THEN** the app SHALL invoke `autoUpdater.checkForUpdates()` exactly once

#### Scenario: Periodic check runs every 24 hours

- **GIVEN** the app has been running for at least 60 seconds
- **WHEN** 24 hours elapse since the previous check
- **THEN** the app SHALL invoke `autoUpdater.checkForUpdates()` again
- **AND** failure of any individual check SHALL NOT stop the next scheduled check

#### Scenario: Dev mode skips updater initialisation

- **GIVEN** `process.env.ELECTRON_DEV` is set OR `process.resourcesPath` is unavailable
- **WHEN** the app starts
- **THEN** `initAutoUpdater` SHALL return a no-op cleanup function and SHALL NOT register any timers, listeners, or perform any network calls

### Requirement: Update-available dialog and download consent

When `electron-updater` reports `update-available`, the app SHALL surface a native dialog asking the user to consent to the download. The dialog SHALL include the new version string. Only after user consent SHALL the app call `autoUpdater.downloadUpdate()`. The app SHALL NOT enable `autoDownload`.

#### Scenario: Update-available dialog shows version and offers Download / Later

- **GIVEN** `electron-updater` emits `update-available` with `info.version = "1.2.3"`
- **WHEN** the app receives the event
- **THEN** the app SHALL display a native message-box dialog containing the string `1.2.3`
- **AND** the dialog SHALL offer two buttons: a Download/Restart confirmation and a defer button
- **AND** the dialog SHALL NOT initiate the download until the user clicks the confirmation button

#### Scenario: User defers update

- **GIVEN** the update-available dialog is displayed
- **WHEN** the user clicks the defer button
- **THEN** the app SHALL NOT call `autoUpdater.downloadUpdate()`
- **AND** the next scheduled check SHALL still run as normal 24 hours later

#### Scenario: User consents to download

- **GIVEN** the update-available dialog is displayed
- **WHEN** the user clicks the Download/Restart confirmation button
- **THEN** the app SHALL call `autoUpdater.downloadUpdate()`
- **AND** the app SHALL NOT call `autoUpdater.quitAndInstall()` until the `update-downloaded` event has fired

### Requirement: Update-downloaded dialog and apply

When `electron-updater` emits `update-downloaded`, the app SHALL surface a second native dialog offering to restart and apply the update. `autoInstallOnAppQuit` SHALL remain enabled so a deferred update applies on the next normal quit.

#### Scenario: Update-downloaded dialog offers Restart Now / Later

- **GIVEN** the user has consented to download AND `electron-updater` emits `update-downloaded` with `info.version = "1.2.3"`
- **WHEN** the app receives the event
- **THEN** the app SHALL display a native message-box dialog containing the string `1.2.3`
- **AND** the dialog SHALL offer Restart Now and Later buttons

#### Scenario: Restart Now applies the update immediately

- **GIVEN** the update-downloaded dialog is displayed
- **WHEN** the user clicks Restart Now
- **THEN** the app SHALL call `autoUpdater.quitAndInstall()`

#### Scenario: Later defers update to next quit

- **GIVEN** the update-downloaded dialog is displayed
- **WHEN** the user clicks Later
- **THEN** the app SHALL NOT call `autoUpdater.quitAndInstall()` immediately
- **AND** `autoInstallOnAppQuit` SHALL remain `true` so the update applies the next time the user quits the app normally

### Requirement: Update errors logged, never silently swallowed

The app SHALL register an `error` listener on `autoUpdater` that writes every error to the Electron main-process log file (resolved via `app.getPath('logs')`). Errors SHALL be classified by severity: `update-not-available` is debug, network errors are warn, signature/parse errors are error. The handler SHALL NOT show a dialog for any error type — errors are silent to the user but visible to maintainers.

#### Scenario: Network error logged at warn

- **WHEN** `autoUpdater` emits an `error` event whose message indicates a network failure (ECONNREFUSED, ETIMEDOUT, getaddrinfo, 502/503/504)
- **THEN** the app SHALL write the error message + stack to the log file at level `warn`
- **AND** the app SHALL NOT display a dialog

#### Scenario: Signature or parse error logged at error

- **WHEN** `autoUpdater` emits an `error` event whose message indicates a signature failure, sha512 mismatch, or YAML parse error
- **THEN** the app SHALL write the error message + stack to the log file at level `error`
- **AND** the app SHALL NOT display a dialog

#### Scenario: update-not-available is not surfaced as an error

- **WHEN** `autoUpdater` reports that no update is available
- **THEN** the app SHALL log this at level `debug` (or omit entirely)
- **AND** the app SHALL NOT display a dialog

### Requirement: Manual "Check for updates…" menu item

The Electron app menu (`packages/electron/src/lib/app-menu.ts`) SHALL provide a "Check for updates…" menu item that triggers an immediate `autoUpdater.checkForUpdates()` regardless of the 24-hour timer. The result SHALL be surfaced to the user via one of three native dialogs.

#### Scenario: Manual check shows up-to-date dialog when no update available

- **GIVEN** the user clicks "Check for updates…"
- **WHEN** `electron-updater` reports no newer version exists
- **THEN** the app SHALL display a native dialog with the message "You're up to date" including the current version string

#### Scenario: Manual check transitions into the update-available flow when update found

- **GIVEN** the user clicks "Check for updates…"
- **WHEN** `electron-updater` emits `update-available`
- **THEN** the app SHALL display the standard update-available dialog (Requirement: Update-available dialog and download consent)

#### Scenario: Manual check shows error dialog on check failure

- **GIVEN** the user clicks "Check for updates…"
- **WHEN** `electron-updater` emits an `error` event before reporting available/not-available
- **THEN** the app SHALL display a native dialog with the message "Update check failed" and a short reason (network unreachable, signature error, etc.)
- **AND** the error SHALL also be logged per the error-logging requirement

#### Scenario: Manual check item hidden in development mode

- **GIVEN** `process.env.ELECTRON_DEV` is set
- **WHEN** the app menu is built
- **THEN** the "Check for updates…" item SHALL NOT appear

### Requirement: Update channel binds to GitHub release stream

The packaged app SHALL embed a `publish` configuration declaring `provider: github`, `owner: blackbelt-technology`, `repo: pi-agent-dashboard`. `electron-updater` SHALL read this configuration from the auto-generated `app-update.yml` resource included in the packaged app. The runtime configuration SHALL match the build-time publish configuration so a release uploaded by CI is the same release the runtime queries.

#### Scenario: Packaged app contains app-update.yml with GitHub provider

- **WHEN** the production build runs
- **THEN** the packaged app SHALL include `app-update.yml` in its resources directory
- **AND** the file SHALL declare `provider: github`, `owner: blackbelt-technology`, `repo: pi-agent-dashboard`

#### Scenario: Pre-release tags do not appear as updates to stable users

- **GIVEN** a pre-release tag (`v1.2.3-alpha.1`, `v1.2.3-beta.1`, `v1.2.3-rc.1`) has been pushed
- **WHEN** a stable user's app performs an update check
- **THEN** the user SHALL NOT receive an update prompt for the pre-release version
