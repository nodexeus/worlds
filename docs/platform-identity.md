# Worlds and platform agent identity

Worlds is the visual workspace for the planned Nodexeus agent platform. The current app
monitors local harness sessions; this is one source of activity, not the permanent agent model.

## Separate the identities

- **Agent:** a durable Nodexeus identity, with a name, role, workspace membership, and access
  policy. Its identity should survive a runtime replacement.
- **Runtime:** the execution adapter, such as Hermes or OpenClaw. Runtime-specific handles
  remain behind the platform contract.
- **Run:** one execution of a task, with lifecycle events, timestamps, outcome, and an agent ID.
- **Session:** a conversation or runtime context associated with an agent/run. A new session
  must not automatically create another permanent campus agent.
- **Workflow:** coordinated work and handoffs between agents, with independent run state.
- **Library collection:** sources and shared memory with explicit scope and access rules.

## Integration direction

The future platform supplies stable IDs, authorized snapshots, and lifecycle events. Local
Claude/Codex scanners remain adapters whose current IDs are source-scoped session IDs.
Do not infer a platform agent ID from a display name, repository path, or process ID.
Worlds needs reconciliation after reconnects, deletions, and out-of-order events before
platform live state can be treated as authoritative. No event schema is committed yet.

The owner intends inference to pass through Nodexeus's LiteLLM gateway, using customer
keys or Nodexeus credits. Worlds should present the customer's agents, work, access, and
usage without exposing replaceable runtime internals as product concepts.

## Library semantics

Show source origin, ingestion/freshness state, accessible agents or teams, and retrieval
evidence separately. Stored information does not prove successful recall. Agent-private
context, workspace memory, and organization knowledge need visibly distinct access scopes.

The Library is a permanent core campus building, independent of agents, sessions, and workspace plots. Selecting it opens its knowledge view. The initial view is explicitly unconnected. It has no invented collections,
documents, retrieval metrics, billing controls, or background platform requests.
Tenant isolation, execution permissions, ingestion, and memory synchronization belong to
the platform integration and require their own implementation and verification.
