# Nodexeus Worlds handoff

Recorded 2026-10-05. This guide carries development context between machines.
Linear is the source of truth for delivery status; GitHub hosts the code and pull requests.

## Repository and tracking

- Clone `git@github.com:nodexeus/worlds.git`; use its `main` branch.
- `origin` is the Nodexeus fork. The optional `upstream` remote is
  `https://github.com/Station-Sciences/bot-crossing.git`.
- Track all work in the Linear [worlds project](https://linear.app/nodexeus/project/worlds-be8ea2816608)
  (team Nodexeus, issue prefix `NODEX`). Search it before creating an item, and set a
  label, priority, and status on every issue.
- Open PRs only in the Nodexeus fork. Do not write to upstream tracking.
- Name branches `<issue-id>-<short-kebab-summary>`, reference the issue in commits, and
  put the closing reference (`Closes NODEX-123`) in the PR description only.
  Do not add a co-author line unless requested. Future work needs its own scoped plan.
- History before the move to Linear lives on GitHub and is complete:
  [PR #4](https://github.com/nodexeus/worlds/pull/4) (merged 2026-10-05) delivered the
  branded campus and Library, closing [parent #1](https://github.com/nodexeus/worlds/issues/1),
  branding #2, and Library #3. The
  [GitHub project](https://github.com/orgs/nodexeus/projects/2) holds only those items.
  Do not open new GitHub issues or copy the closed ones into Linear.

## Documentation map

| Document | Purpose |
| --- | --- |
| [PRODUCT.md](../PRODUCT.md) | Current capabilities, customer direction, constraints |
| [DESIGN.md](../DESIGN.md) | Implemented brand tokens and component guidance |
| [Design sidecar](../.impeccable/design.json) | Machine-readable design metadata and snippets |
| [Campus surface contract](../.impeccable/surfaces/src-ui-styles-css.md) | Direction and scoped review evidence |
| [Campus implementation plan](superpowers/plans/2026-10-05-nodexeus-campus.md) | Completed steps and deferred integration work |
| [Desktop spec](superpowers/specs/2026-10-05-electron-app.md) | Original Electron architecture and acceptance criteria |
| [Desktop implementation plan](superpowers/plans/2026-10-05-electron-app.md) | Original execution and verification ledger |
| [Desktop guide](desktop.md) | Packaging, runtime, storage, and activity semantics |
| [Docker guide](docker.md) | Compose setup, session mounts, and limitations |
| [Platform identity](platform-identity.md) | Durable agents versus runtimes, runs, and sessions |
| [Harness adapters](../server/harnesses/README.md) | Existing local session adapter contract |
| [Crew backend](crew-backend.md) | Roster, workspaces, storage settings and API of the crew backend |
| [Crew chat design](superpowers/specs/2026-10-07-crew-chat-design.md) | Durable agents you can converse with, and the order that work is built in |
| [DECISIONS.md](../DECISIONS.md) | Inherited technical decisions |

The Electron spec and plan retain the original Bot Crossing name as historical context.
The current product is Nodexeus Worlds; its main view is Campus.

## Start on a new machine

Install Git and Node 22.13 or newer, and authenticate Git access to the fork.

```bash
git clone git@github.com:nodexeus/worlds.git
cd worlds
npm ci
npm run dev
```

For a native app on an Apple Silicon Mac:

```bash
npm run desktop:dist
```

Install `release/mac-arm64/Nodexeus Worlds.app` or the generated DMG. Once installed,
open the app normally; npm and a development server are not required to use it.
The current packaging commands target macOS arm64. Other machines can use the browser
or Docker workflow; native packaging for other targets has not been verified.

Generated `dist/`, `node_modules/`, and `release/` are excluded from Git and rebuilt
locally. Runtime artwork, desktop icons, licensed fonts, and their source information
are committed. Original art packs are not needed for an ordinary build.

## Transfer personal state separately

Quit Nodexeus Worlds before copying its data. To retain desktop layouts, archives, and
preferences, transfer `~/Library/Application Support/Bot Crossing/` privately to the
same location on the new Mac before launching the app. Keep an original backup. The
legacy folder name is intentional compatibility, not an old installation to delete.
Repository paths stored in layouts may need adjustment when checkout locations change.

Local Claude/Codex session stores are separate from Worlds data and are not in this
repository. Install and sign in to the harnesses on the new machine; transfer their
history separately if needed. Worlds only displays stores it can read on that machine.
CLI tools are needed for terminal-opening actions. Credentials should be configured
through each tool, not committed to this public repository.

Browser development uses ignored `data/colony.json`; Docker uses its named volume.
Neither stays synchronized with the Electron data directory. The one exception is a
one-time import: when the desktop data folder has no `colony.json`, the app copies one in
at launch. A development run (`npm run desktop:dev`) takes the checkout's
`data/colony.json`; any run takes the file named by `BOT_CROSSING_IMPORT_COLONY` (an
absolute path). An existing desktop colony is never overwritten, so copying the data
folder first, as above, skips the import. See the runtime guides before importing data.

Other ignored, machine-local files need a separate transfer or recreation if you use
them: `compose.override.yaml`, `.env`, licensed audio overrides in `public/audio/`,
character design source in `design/character/`, and `.claude/settings.local.json`
(which holds personal paths, so recreate it instead of copying).

Re-enable Open at Login from the app on the new machine. The login job is
`~/Library/LaunchAgents/local.botcrossing.desktop.plist`, which sits outside the data
folder and is not carried by the transfer above. Do not copy it: its application path
belongs to the old installation.

## Current scope and next decisions

The app monitors local harness sessions. The Library is a permanent selectable core
building beside the arrival hab, with reserved ground and an explicitly unconnected
knowledge drawer. A crew backend (durable agents and workspaces in Postgres, see
`docs/crew-backend.md`) is present when a database is configured. There is no memory
ingestion, RAG service, workflow execution, customer account system, billing, or
platform-runtime lifecycle adapter yet, and agents cannot yet be conversed with: see the
crew chat design for the order of that work.

The platform direction is durable Nodexeus agents with replaceable runtimes such as
Hermes or OpenClaw, shared memory with access scopes and retrieval evidence, and
inference through Nodexeus LiteLLM using customer keys or Nodexeus credits. An existing
local Hermes session reader does not implement that future persistent-agent model.
Define tenant boundaries and stable identity/event contracts before connecting it.

Brand authority: https://brand.nodexeus.com/. The private feasibility research remains
at https://gitlab.com/nodexeus/agent-platform-feasibility/ and requires separate access;
its contents and local clone are not bundled into this public repository.

## Verification baseline

Before the merge handoff, 88 focused tests, `npm run test:electron`, and `npm run build`
passed. The Apple Silicon app and DMG were built and the installed app was inspected.
Native desktop, 800px compact, and 390px mobile layouts were checked; the finish reviewer
marked three requested responsive fixes resolved. This is not a whole-surface audit.

```bash
node --test test/campus-structures.test.mjs test/plot-move.test.mjs test/colony-motion.test.mjs test/desktop-*.test.mjs test/http-server.test.mjs test/claude-container-activity.test.mjs test/claude-handback.test.mjs test/claude-turn.test.mjs test/errands.test.mjs
npm run test:electron
npm run build
```

The build retains Vite's large-chunk warning. Historical desktop notes record two
environment-dependent no-CLI tests on a Mac with Codex installed; no full-suite pass is
claimed here. The desktop plan also preserves manual close-to-menu-bar/login startup
verification limits. Recheck those behaviors on the new machine. Signing, notarization,
and automatic updates are future distribution work.

Local review screenshots are intentionally ignored because they contain private
workspace/session names. Decisions and review scope are recorded in the committed
documents. The two font detector exceptions preserve the Nodexeus brand fonts only.
