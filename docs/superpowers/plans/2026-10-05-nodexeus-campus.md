# Nodexeus Worlds campus foundation plan

This is the durable record of the implementation completed during the 2026-10-05
session. Delivery status is tracked in [parent #1](https://github.com/nodexeus/worlds/issues/1)
and [PR #4](https://github.com/nodexeus/worlds/pull/4); implementation checkmarks below do
not replace the tracker's merged-and-verified definition of done.

## Scope and decisions

- Apply the official Nodexeus identity to the existing Electron app and campus shell.
- Keep the spatial world central. Campus is the view; Nodexeus Worlds is the product.
- Library is a permanent building beside the arrival hab, independent of session buildings.
- Preserve local scanning, saved layouts, archives, native preferences, and upstream attribution.
- Keep knowledge connections visibly unconnected until the platform exists.
- Separate future permanent agent identity from runtime, execution, and session identity.

The [product](../../../PRODUCT.md), [design system](../../../DESIGN.md),
[surface contract](../../../.impeccable/surfaces/src-ui-styles-css.md), and
[identity guidance](../../platform-identity.md) hold the detailed constraints.

## Implementation steps

- [x] Brand the app and shell ([#2](https://github.com/nodexeus/worlds/issues/2)).
  Use official SVG assets, bundled licensed Geist fonts, ink/white/amber controls,
  native icons, product naming, and accessible Campus/Library navigation. Retain
  internal data, protocol, and partition identifiers for compatibility.
- [x] Build the permanent Library ([#3](https://github.com/nodexeus/worlds/issues/3)).
  Reserve its hex cell; relocate a legacy occupant through the allocator; protect
  against dragging; include the building in terrain, scatter clearance, navigation,
  pointer selection, and disposal. Selecting it focuses the camera and opens its drawer.
- [x] Verify layout and interactions. Cover core cells, connectivity, allocation,
  stable migration, ray selection, and resource disposal with focused tests.
  Inspect the packaged desktop and compact/mobile renderer.
- [x] Resolve the three finish-review findings: rail overlap at 800px, missing mobile
  status labels, and keyboard access to the mobile workspace disclosure. Use Tab for
  focus navigation and G for planet selection while the interface is visible.
- [x] Record the shipped design and future identity constraints. Persist narrow font
  detector exceptions for the Nodexeus brand fonts; keep other rules active.
- [x] Prepare a [machine-transfer handoff](../../HANDOFF.md) and commit the docs/plans.

## Verification record

The 88 focused tests and real Electron integration passed. The production renderer and
Apple Silicon app/DMG built successfully. Native app startup, saved campus continuity,
Library interaction, and 800px/390px responsive layouts were inspected. The reviewer
returned `ship` for the three scored fixes, all resolved. No approved image comp or
whole-surface quality ceiling was available; do not expand that verdict's scope.

Private screenshots, personal state, and generated installers are not committed.
The handoff records reproducible checks and transfer locations.

## Deferred platform work

No execution platform or new persistent-agent adapter is part of this plan. Follow-up
planning must define stable agent IDs, runtime/run/session relationships, tenant access,
authorized snapshots/events and reconciliation, memory ingestion and retrieval evidence,
workflow handoffs, and LiteLLM usage/billing. Library collection and access controls
should use those contracts instead of presenting simulated integration state.
