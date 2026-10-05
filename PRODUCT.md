# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The existing Vite/Three.js interface also ships inside an Electron app for macOS Apple
Silicon. Browser and Docker entry points remain available.

## Users

Today, the owner uses the app to monitor local coding-agent sessions, including Claude
Code and Codex. The intended future audience includes Nodexeus customers building their
own campuses. Specific customer roles and collaboration requirements are undecided.

## Product Purpose

Make agent activity understandable through a spatial interface. Show which agents are
working, idle, or actually need human input, and let the user open the underlying session.

The owner wants to evolve the product into a Nodexeus Worlds campus where customers build and
run agents and workflows. Agents can collaborate or work independently, discover each
other, and use shared memory and retrieval-augmented knowledge. A Library in the campus
should make available knowledge visible and understandable.
These integrations are a future product direction, not current capabilities.

## Operating Context

The current application reads local harness data and displays sessions as bots grouped
by repository in a 3D colony. Users can organize the map, hide repositories, archive
sessions from their view, and monitor activity from the desktop app.

## Capabilities and Constraints

- Session scanning reads harness data without modifying it.
- Native desktop scanning can inspect host process activity. Docker uses bounded
  transcript inference where host process inspection is unavailable.
- An unread reply is distinct from a request for human input. A parent whose subagent
  is still reviewing or working must not ask for help merely because it posted an update.
- Preserve existing colony data and functioning session workflows during a rebrand.
- Customer accounts, shared campuses, workflow execution, and agentic-memory connections
  are not implemented. Their interfaces and deployment model are open decisions.
- Planned inference goes through Nodexeus's LiteLLM gateway, funded by customer-provided
  keys or Nodexeus API credits. Billing and gateway integration are outside this visual pass.
- The feasibility design keeps customer agent identity and organizational memory independent
  of replaceable execution runtimes. Customer-facing UI uses Nodexeus concepts.
- Knowledge storage, ingestion, recall, and access are separate states. Do not imply that a
  stored source was successfully used by an agent without evidence.
- A persistent Nodexeus agent is distinct from an execution, conversation, or runtime process.
  Future agents may use Hermes, OpenClaw, or other runtimes. Worlds must support platform
  identities and lifecycle events rather than treating Claude/Codex session files as the
  permanent identity model. The existing scanners remain local-source adapters.

## Brand Commitments

- Adapt the product to Nodexeus using https://brand.nodexeus.com/ as the brand authority.
- Use the supplied logo assets and follow the kit's identity and voice guidance.
- Nodexeus Worlds is the product name; Campus is the main spatial view. The first branded
  pass retains the live local monitor and adds a permanent Library building with a clearly unconnected knowledge view.
- Preserve upstream source attribution and license notices. The fork needs its own
  product identity; the upstream crew character is not the Nodexeus logo or mascot.

## Evidence on Hand

- Existing working UI, native Electron package, Docker configuration, and session tests.
- Brand kit and machine-readable https://brand.nodexeus.com/brand.json.
- Owner's stated ambition: customers build their own Nodexeus campuses, connected to
  agentic memory and workflows they are developing.

## Open Decisions

- Concrete memory/workflow integrations and their data model.
- Customer customization, sharing, permissions, and hosting requirements.
