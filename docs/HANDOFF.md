# Nodexeus Worlds handoff

Recorded 2026-10-05. This guide carries development context between machines.
GitHub issues and pull requests remain the source of truth for delivery status.

## Repository and tracking

- Clone `git@github.com:nodexeus/worlds.git`; use its `main` branch.
- `origin` is the Nodexeus fork. The optional `upstream` remote is
  `https://github.com/Station-Sciences/bot-crossing.git`.
- Create issues and PRs only in the Nodexeus fork. Do not write to upstream tracking.
- [PR #4](https://github.com/nodexeus/worlds/pull/4) contains the branded campus and Library.
  [Parent #1](https://github.com/nodexeus/worlds/issues/1) links branding #2 and Library #3.
- [Nodexeus Worlds project](https://github.com/orgs/nodexeus/projects/2) tracks workflow,
  priority, dates, and issue types. Do not duplicate its existing items.
- Keep work linked to issues, use issue references in commits, and closing references in
  PRs. Do not add a co-author line unless requested. Future work needs its own scoped plan.

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
Neither is automatically synchronized with the Electron data directory. Personal
`compose.override.yaml`, `.env`, and any licensed audio overrides also need a separate
transfer or recreation. See the runtime guides before importing data.

Re-enable Open at Login from the app on the new machine. Do not copy the old LaunchAgent
blindly: its application path belongs to the old installation.

## Current scope and next decisions

The app monitors local harness sessions. The Library is a permanent selectable core
building beside the arrival hab, with reserved ground and an explicitly unconnected
knowledge drawer. There is no memory ingestion, RAG service, workflow execution,
customer account system, billing, or platform-runtime lifecycle adapter yet.

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
