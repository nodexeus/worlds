# Bot Crossing desktop app

The user approved a self-contained Electron app for macOS: open it from Applications,
retain the existing colony UI, run the scanner natively, optionally monitor from the menu
bar after closing the window, and offer launch at login. No upstream issues or PRs.

## Design

- Electron bundles Chromium and Node. A sandboxed renderer loads the existing Vite build.
- A Node utility process owns the existing HTTP/API server on a random loopback port.
  A per-launch secret header authenticates every desktop request. Navigation and new
  windows cannot leave the app origin; external HTTPS links open in the browser.
- Native process detection is enabled, with a desktop PATH suitable for GUI launches.
- The utility process supplies periodic activity summaries even when the window is hidden.
- Closing the window hides it by default. A menu preference can disable that behavior;
  explicit Quit always stops the worker. Login startup is opt-in.
- Hide/minimize stops rendering and audio; showing resumes rendering and refreshes data.
- Colony data lives in Electron's userData directory, separate from installation files.
  First-run migration never overwrites an existing colony. This installation imports a
  validated snapshot from the running Docker copy, retaining the source and a backup.
- Package a macOS Apple Silicon .app and .dmg. Local installation is sufficient; signing,
  notarization for public distribution, auto-updates, and Claude hooks are separate work.

## Acceptance

- Launch the packaged .app without npm, a system Node dependency, or Docker.
- Display the existing colony and preserve imported settings, layout, and archives.
- Read Claude and Codex stores and use native PID checks.
- Verify localhost authentication, singleton behavior, close/show, hidden render pause,
  preferences persistence, worker startup/failure handling, and clean shutdown.
- Build and run meaningful focused tests; preserve the existing web/Compose workflows.

## Decisions

- Work in the existing feature checkout to preserve this session's uncommitted changes.
- Implement inline, then request a fresh review as required by the review skill.
- Store planning and progress locally; the user prohibited upstream tracking writes.
