# Nodexeus Worlds for macOS

Open **Nodexeus Worlds.app** from Applications. Node, npm, Docker, and a terminal are not
needed to run the packaged app. This build targets Apple Silicon Macs.

- Closing the window keeps the scanner running in the menu bar by default.
- Choose **Show Colony** from the menu bar or click the Dock icon to return.
- **Bot Crossing → Keep Running in Menu Bar** controls close behavior.
- **Bot Crossing → Open at Login** starts it in the background at the next login. This
  is off by default. It uses an app-owned per-user LaunchAgent, which also works with
  this unsigned local build. Disable it before moving or removing the app.
- **Quit Bot Crossing** (⌘Q) saves the colony and stops the scanner.
- Rendering and audio pause when the window is hidden or minimized; the scanner continues.

The scanner reads the same local harness stores as the browser version and uses native
process detection. Claude/Codex CLI binaries are still needed for the app's terminal-opening
actions; they are not needed just to view sessions.

## Data and migration

Colony data, desktop preferences, browser storage, and logs live in:

```text
~/Library/Application Support/Bot Crossing/
```

The app menu provides **Open Data Folder** and **Open Log File**. Replacing the `.app`
does not replace this data. Login startup is stored at
`~/Library/LaunchAgents/local.botcrossing.desktop.plist`.

For this machine, the existing Docker colony was imported before the first desktop launch.
Its original snapshot is retained as `imports/docker-colony-2026-10-05.json` inside the
data folder, and the Docker volume remains intact. Subsequent desktop and Docker changes
are separate; they do not synchronize.

For another installation, export `data/colony.json` from the existing installation before
first launch. Set `BOT_CROSSING_IMPORT_COLONY` to its absolute path when launching the
app executable. Import validates the file and refuses to overwrite an existing desktop
colony. Development runs also look for the checkout's `data/colony.json` on first launch.

## Build and test

Requires Node 22.13 or newer for development:

```bash
npm ci
npm run desktop:dev       # Build and launch with Electron
npm run desktop:package   # release/mac-arm64/Nodexeus Worlds.app
npm run desktop:dist      # Also build the .dmg installer
npm run test:desktop      # Storage, login, navigation, lifecycle, HTTP, tray status
npm run test:electron     # Real Electron utility process and native PID checks
```

App artwork is checked in. To regenerate it on macOS, run `npm run desktop:icons`
(requires the Swift command-line tools). It rasterizes the official Nodexeus SVG mark.

The packaged renderer is sandboxed and uses a stable `bot-crossing://app` origin. Its
private loopback API uses a random port and per-launch credential held outside the renderer.
The existing browser and Docker commands continue to work independently.

## Local distribution

The `.app` and `.dmg` are local, unsigned builds. Public distribution would require signing
and notarization; automatic updates are not configured. Updating this copy means rebuilding
and replacing the application while it is quit. Keep the user-data directory.

## Verification for this build

- Focused unit tests cover authentication, state migration, read-state counts, native PATH,
  renderer lifecycle callbacks, and login preference files.
- The real Electron 44.5.1 / Node 24.21.0 worker test covers a live host PID, completed-turn
  detection, API isolation, state persistence, and process shutdown.
- Initial packaged startup succeeded. Its GLTF texture CSP error was corrected and covered
  by a regression test; the final package includes the correction.
- Computer Use access now works. Packaged rendering, repo navigation, and a clean quit/relaunch
  were verified in the installed app. Close-to-menu-bar and login behavior remain unverified manually.
- Claude subagent completion now recognizes a successful `SubagentHandback` receipt. Previously,
  the receipt was mistaken for another user turn and completed subagents appeared to work for
  up to ten minutes. Regression tests cover successful delivery, late parallel tool results,
  failures, and resumed work in native and transcript modes. After rebuilding and installing,
  the three completed subagents disappeared. Parent attention detection was refined separately below.

## Activity and attention

Claude's unread replies and requests for input are separate states. A completed reply or progress
report does not trigger "need you". A parent with an active reviewer or other subagent remains
working, even after posting a progress report. An unanswered `AskUserQuestion` or `ExitPlanMode`
call, or a direct closing question/request in a finished reply, signals that the user is needed.
Text requests are inferred conservatively; the scanner cannot see permission dialogs that Claude
does not record in its transcript. Marking a request viewed dismisses its indicator until new activity.

Verified with 43 focused activity/attention/errand tests, five existing Claude adapter regressions,
and the Electron utility-process test. The installed rebuild kept the reviewing session working
without an attention flag; its remaining visible attention indicator belonged to a different session
whose latest reply explicitly asked the user to choose the next task.

## Rebrand compatibility

The app is named Nodexeus Worlds. Its data directory, internal protocol, session partition,
and launch-agent identifier retain their previous values so existing layouts, archives,
and preferences remain available. The Library is a clearly unconnected product surface;
no platform credentials or memory sources are requested by this release.

## Campus Library

The permanent Library sits beside the arrival hab. Click its building or the Library
shortcut to focus it and open the knowledge drawer. Escape returns to Campus. It remains
on the map independently of sessions and is protected from workspace allocation and dragging.
Sources and memory are not connected in this release.

A workspace previously occupying the Library's reserved cell is relocated once by the existing
allocator. Other valid saved positions remain stable.
