# Electron app implementation plan

> Execute inline with superpowers:executing-plans; request a fresh final code review.

**Goal:** Deliver an installed, usable Bot Crossing.app with native session scanning.
**Architecture:** Sandboxed Electron window, authenticated loopback API in a utility
process, persistent per-user data, native menu controls, and a packaged runtime.
**Tech stack:** Existing JavaScript/Vite/Three.js, Electron 44, electron-builder 26, node:test.
**Spec:** ../specs/2026-10-05-electron-app.md

## Constraints and review focus

- Keep each new source module below 400 lines and document interfaces with JSDoc.
- Preserve all current Docker, browser, and session-data changes. No upstream writes.
- Never overwrite existing user data; detect invalid migration input and preserve sources.
- Reject unauthenticated desktop API traffic and unexpected renderer navigation.
- Handle worker startup/exit failures, duplicate launches, and hidden-window resources.
- Test packaged node:sqlite support and GUI PATH resolution on this Mac.

## Tasks

- [x] 1. Extract `createAppServer` to `server/http-server.mjs`, preserving `serve.mjs`.
  Write `test/http-server.test.mjs` for static assets, API routing, token checks, malformed
  paths, and ephemeral ports. Run `node --test test/http-server.test.mjs` red then green.
- [x] 2. Add `desktop/storage.mjs` for preferences and non-overwriting colony import.
  Test fresh imports, existing destinations, corrupt input, and unrelated preference
  preservation in `test/desktop-storage.test.mjs` before implementation.
- [x] 3. Add Electron main/worker/menu/preload modules and a small renderer lifecycle
  adapter. Use a random API token and ephemeral port; expose only visibility to the
  sandboxed renderer. Add menu preferences and useful startup failure messages.
  Test pure navigation/environment/lifecycle rules and smoke-test the actual runtime.
- [x] 4. Configure pinned dependencies, packaging scripts, app artwork based on the existing
  astronaut favicon, and desktop usage docs. Build with `npm run desktop:package` and
  verify the packaged binary, assets, native scanner, close/show, and clean worker exit.
- [ ] 5. Request a focused final review; fix material findings with regression coverage.
  Import the current Docker colony with backup, install in ~/Applications, stop the
  Docker app after migration, and open the desktop app. Verify the rendered result.

## Progress ledger

- Spec reflects the desktop proposal approved by the user. Implementation authorized.
- Baseline: Docker running with session mounts; prior harness tests pass in Linux but one
  existing native test assumes Codex is not installed at /opt/homebrew/bin/codex.

- Tasks 1–4 implemented. Stable custom-protocol renderer proxies to the authenticated
  loopback worker so localStorage survives random-port changes.
- Review fixed two findings with regressions: valid settings:null migration and tray
  read-state normalization. Packaged startup also exposed and fixed GLTF blob CSP.
- 19 desktop unit tests pass; real Electron worker integration passes native PID activity,
  completed-turn status, token isolation, persistence, and shutdown.
- Initial broader check: 95 focused tests passed in a clean Node 22 container. Two existing
  native no-CLI tests are environment-dependent because Codex is installed on this Mac.
- Built Apple Silicon .app and .dmg. Installed ~/Applications/Bot Crossing.app. Migrated
  17 project layouts, one archived session, and settings, retaining the Docker source
  and an import backup.
- Computer Use access subsequently became available. Verified the installed app's rendered
  colony, repo navigation, and clean quit/relaunch. Close-to-menu-bar and login startup
  remain unverified manually. Docker remains available independently.
- Corrected completed-subagent detection and separated unread replies from requests for
  user input. Active reviewers keep their parent working. See docs/desktop.md for checks.
