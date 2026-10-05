---
version: 1
slug: "src-ui-styles-css"
primary_target: "src/ui/styles.css"
related_targets: ["src/ui/campus-shell.js","src/ui/campus-theme.css","src/world/library.js","desktop/main.mjs"]
---

# Campus surface

Mode: Operate, with an exploratory 3D view. Customers need to understand who is working,
what needs their input, and eventually what knowledge and workflows are available.
This first pass uses real local sessions. Library is unconnected, with no synthetic records
or simulated platform status. Preserve controls, saved layouts, archives, and preferences.

## Direction contract

THESIS: Nodexeus Worlds is a spatial workspace for agent work. The live world remains
central; wayfinding and readable controls make it useful alongside a future Library.
OWN-WORLD: Nodexeus ink, white, restrained amber, official arch mark, Geist Sans and
Geist Mono. Opaque surfaces, quiet rules, compact controls, semantic status colors.
STORY: See real work, choose a workspace, inspect an agent, open its session. Enter the
Library to understand the future shared-knowledge space and its current connection state.
FIRST VIEWPORT: A compact brand and Campus/Library switch sits above the world at left.
A 344px right-hand directory holds live states, workspaces, and session details. Navigation
never obscures the world controls. Library is a permanent core building beside the arrival hab, with an open-book roof and amber trim. Selecting it opens a readable knowledge drawer in place of the right-hand directory.
FORM: Campus wayfinding is user-pinned; it overrides the direction roll (seed 4fc5879b,
assigned index 6). Retain the challenger disciplines of map/list correspondence, readable
network state, and restrained annotation; brand colors and fonts remain fixed. No generated
comp is available, so this pass is code-led. Signature interaction: selecting the Library moves the camera to its permanent site and opens its knowledge drawer. Campus preserves the map and restores keyboard focus.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Verification: desktop packaged app at 1280px, keyboard navigation, Library
open/close, live counts, data continuity, and brand artwork. Memory access, workflow execution,
and customer billing are future integration work, not controls offered by this build.

Verification evidence: desktop.png and library.png show the native app at 1280px.
Browser responsive-mode captures verify compact layout at 800×600 (compact.png)
and mobile Campus and Library at 390×844 (mobile.png and mobile-library.png).
The native wrapper has an 800px minimum width; its compact layout is checked through
the shared browser renderer. The mobile workspace disclosure supports Enter/Space,
reports aria-expanded, and keeps collapsed content out of the focus order. Tab navigates
controls; G opens planet view while the interface is visible.

Finish result: the independent reviewer marked the three requested fixes resolved
(control rail at 800px, mobile status labels, keyboard workspace disclosure).
Disposition: ship for those scored fixes; no whole-surface ceiling claim.
