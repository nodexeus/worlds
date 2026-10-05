---
name: Nodexeus Worlds
description: A spatial campus with quiet, readable Nodexeus controls.
colors:
  ink: "#050506"
  panel: "#101012"
  white: "#fafafa"
  muted: "#b2b2bb"
  dim: "#a4a4ac"
  line: "#2c2c30"
  line-strong: "#56565e"
  amber: "#fdc700"
  amber-hover: "#ffda55"
  nav-selected: "#302a14"
  row-selected: "#2b2819"
  control-hover: "#242429"
  stat-surface: "#1c1c20"
  working: "#7fd39a"
  blocked: "#e88b8b"
  done: "#abc7ed"
  idle: "#b6b5be"
typography:
  headline:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 550
    letterSpacing: "-0.02em"
  section:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.65
  intro:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: 1.6
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "13px"
  metadata:
    fontFamily: "Geist Mono, monospace"
    fontSize: "11px"
rounded:
  status: "6px"
  control: "8px"
  field: "9px"
  panel: "14px"
  mobile-sheet: "18px"
spacing:
  tight: "4px"
  small: "8px"
  inset: "12px"
  row: "16px"
  edge: "24px"
  drawer: "28px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.amber-hover}"
  button-secondary:
    backgroundColor: "rgba(255, 255, 255, 0.05)"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "34px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    height: "34px"
  navigation:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  navigation-selected:
    backgroundColor: "{colors.nav-selected}"
    textColor: "{colors.amber-hover}"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.white}"
    rounded: "{rounded.panel}"
  field:
    backgroundColor: "rgba(255, 255, 255, 0.06)"
    textColor: "{colors.white}"
    rounded: "{rounded.field}"
    padding: "0 28px 0 11px"
    height: "30px"
  status-chip:
    backgroundColor: "{colors.stat-surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.status}"
    padding: "0 9px"
---

# Design System: Nodexeus Worlds

## Overview

**Creative North Star: "Nodexeus Campus"**

The campus is a spatial workspace: the world carries activity and the interface supplies readable wayfinding and inspection. The user-approved Nodexeus identity anchors the shell with the official arch mark, ink, white, restrained amber, Geist Sans, and Geist Mono.

Opaque panels and compact controls give information a stable foreground over the rendered landscape. The permanent Library shares the campus's architectural language; its open-book roof and amber trim identify a place, while its drawer explains its current unconnected state. The visual system distinguishes local session activity from future platform capabilities.

**Key Characteristics:**
- Spatial world with an opaque, quiet interface.
- Amber wayfinding with distinct semantic activity colors.
- Geist for reading; Geist Mono for paths, counts, and timing.
- Permanent landmarks and reversible inspection drawers.

Source authority: `src/ui/campus-theme.css` loads after `src/ui/styles.css`; component behavior is in `src/ui/campus-shell.js`, and the physical Library is in `src/world/library.js`. This records the shipped branded shell and its shared primitives, not a replacement specification for every legacy settings control.

## Colors

The interface combines near-black surfaces, neutral text, and a warm amber accent; activity states retain their own colors.

### Primary
- **Amber:** primary actions, current Campus/Library wayfinding, focus outlines, waiting status, and Library trim.
- **Amber hover:** brighter primary hover and selected navigation text.
- **Selected navigation / selected row:** separate dark amber surfaces for the corresponding selected controls.

### Secondary
- **Working / blocked / done / idle:** green, soft red, blue, and neutral gray status signals. Keep visible status names alongside dots and counts.

### Neutral
- **Ink / panel:** application background and opaque foreground surfaces.
- **White / muted / dim:** main copy, secondary explanation, and compact supporting information.
- **Line / strong line:** quiet separators and control borders.
- **Control hover / stat surface:** local state and compact count backgrounds.

### Named Rules
**The Amber Wayfinding Rule.** Use amber for brand actions and orientation; preserve distinct colors for operational states.

## Typography

**Display and Body Font:** Geist (the shipped Geist Sans family), with system-ui and sans-serif fallbacks.
**Label/Mono Font:** Geist Mono, with monospace fallback.

The pairing is compact and direct. Sans text explains actions and state; tabular monospaced values make paths, counts, and elapsed time easier to scan. Fonts ship locally as variable WOFF2 files.

### Hierarchy
- **Headline:** the Library drawer heading.
- **Title:** the Library empty-state title.
- **Section:** directory branding and Library section headings.
- **Body / intro:** readable Library paragraphs and its opening explanation.
- **Label:** navigation, section labels, and ordinary buttons; supporting descriptions also use this size with a relaxed line height.
- **Metadata:** repository paths, elapsed times, and session metadata. Counts use the same mono family at their component's size.

### Named Rules
**The Readable State Rule.** Keep status labels visible at compact and mobile widths; color and counts accompany the words.

## Layout

The scene fills the viewport. On desktop, brand wayfinding sits at the upper left and a right directory occupies a fixed-width panel (344px), inset from the viewport (24px). The Library uses the same right-hand slot and replaces the directory while open. It scrolls internally. The control rail stays separate from wayfinding.

Spacing is compact inside controls and more generous around reading: small gaps, row padding, outer edges, and section spacing follow the frontmatter scale. The Library drawer uses the drawer inset; its text follows the available panel width rather than an invented editorial measure.

At widths from 721px through 1050px, the brand bar stacks its contents and Library padding becomes 22px. At 820px and below, the existing rail becomes horizontal; the 721–820px layout places it beneath the brand bar. At 720px and below, the header and Library use 12px outer insets, navigation keeps text and hides its SVGs, and Library begins below the header. At 600px and below, the directory becomes a bottom sheet with a visible 200px peek, an explicit disclosure button, and a height capped at the lesser of 64vh and 560px. Its collapsed contents leave the keyboard focus order.

The desktop wrapper has an 800px minimum width. Narrower responsive layouts belong to the shared browser renderer.

## Elevation & Depth

The 3D scene supplies physical depth and lighting. Interface panels remain opaque, with a soft ambient shadow separating them from the scene. Panel blur is disabled; thin rules organize information within the panels. This is not a flat-world prohibition: the physical Library casts and receives scene shadows.

### Shadow Vocabulary
- **Panel lift:** the single ambient panel shadow is recorded in the sidecar and bound to the shipped shadow custom property.

### Named Rules
**The Opaque Foreground Rule.** Use opaque panels for readable interface content above the world.

## Shapes

Panels have rounded rectangular silhouettes; controls use tighter corners, status chips tighter again. Mobile directory sheets have their own larger corner radius. Borders divide content and define secondary controls; panels themselves have no border. SVG icons use simple stroked forms. The official Nodexeus arch remains the identity asset.

The Library's open-book roof, amber edging, stone body, and glazed openings belong to the spatial architecture. Those material colors are not additional interface accents.

## Components

### Buttons
Compact, legible actions. Primary buttons use amber with ink text and a brighter hover; secondary buttons use a subtle white tint, thin border, and stronger hover. Ghost buttons remove the resting fill. Shared buttons scale slightly on press. Focus uses an amber outline (2px) with outward offset (4px). Rail buttons are larger square SVG controls.

### Chips
Status chips combine a colored pip, mono count, and readable label. Their surface and tight corners keep the row compact. Empty counts retain legible labels while the pip dims. A neutral connection badge makes the Library's unavailable connection explicit. Legacy settings picker chips retain their existing styling; they do not establish new brand colors.

### Cards / Containers
Opaque panels frame the directory, navigation, and Library. The Library uses divided reading sections instead of repeated nested cards. Session popovers share the dark panel material and use amber progress indication.

### Inputs / Fields
Settings selects have a thin neutral border, subtly tinted fill, compact height, and an inline chevron. They use the shared amber focus outline. No new text-entry form or source-connection form is implemented by the Library.

### Navigation
Campus and Library are labeled buttons with explicit pressed state, dark amber selection, and brighter selected text. Opening Library focuses its panel; closing or pressing Escape restores focus to Library navigation. Mobile preserves the words while removing the accompanying icons. The bottom-sheet disclosure supports keyboard activation and reports expanded state.

### Library Landmark
The permanent open-book building is independent of session-building lifecycles. Selecting it opens the Library and moves the camera to its site beside the hab. The drawer's sources, shared-memory, and retrieval descriptions describe future capabilities; its current state is visibly unconnected.

The Library arrival moves upward gently over 220ms with an easing curve recorded in the sidecar. It runs only when reduced motion is not requested. Global reduced-motion rules minimize other interface transitions.

## Do's and Don'ts

### Do:
- **Do** use the official Nodexeus identity assets and locally shipped Geist fonts.
- **Do** keep the spatial world readable beside quiet, opaque controls.
- **Do** pair semantic color with visible labels and preserve keyboard focus behavior.
- **Do** represent Library connection and retrieval state truthfully.

### Don't:
- **Don't** treat the upstream crew character as the Nodexeus logo or mascot.
- **Don't** imply that knowledge sources, shared memory, or backend retrieval are connected in the current Library.
- **Don't** replace operational status colors with amber merely to match the brand.

Not canonized: retained rust selected buttons and teal settings-picker selection from the base stylesheet are legacy control styling outside this branded-shell pass; they are neither new brand tokens nor repaired here. No additional defect or whole-surface quality-ceiling claim is inferred from this documentation pass.
