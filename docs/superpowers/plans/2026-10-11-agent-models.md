# Agent Models Implementation Plan

**Goal:** Recreate the approved characters in `agents/Finals`, starting with Social Media Specialist, as editable Blender assets and portable animated GLBs.

**Architecture:** Preserve each character's anatomy. Share rigs only between compatible bodies; humanoid, hovering, and multi-arm characters need distinct rig definitions. Keep common semantic actions so world behavior does not depend on anatomy. Existing `crew-unit` and `crew-rock` remain the reference for material baking, rigid mechanical skinning, and eye/light markers, not a restriction on proportions.

**Tech stack:** Blender 5.2, Python, glTF 2.0, Three.js, existing KayKit animation source.

**Source brief:** `agents/Finals/Master Guidance.md`, approved reference PNGs, and the user's explicit approval of multiple rigs and preserved proportions.

## First milestone: social media model

- [x] Build a reproducible editable model with round display, cap, headphones, purple/teal plates, exposed mechanisms, sneakers, backpack, and removable camera.
- [x] Give it a proportionate humanoid rig. Retain named mechanical parts and rigid weights; keep the camera removable so it does not conflict with work props.
- [x] Export self-contained materials and animation clips in GLB. Include idle, walking, working, sitting, waving, and celebration states.
- [x] Verify geometry, finite skin weights, bone membership, textures, clip coverage, and animation deformation. Render front/side/back and posed previews from the actual model.
- [x] Present the first model for visual review before repeating the workflow across the remaining cast. User accepted the corrected model and authorized the courier.

## Subsequent milestones

- Add per-character rig selection to the app's instanced renderer, including correct attachment, picking, face, and shadow transforms. Keep existing unit/rock behavior unchanged.
- Group remaining references by actual anatomy and model each individually; do not force floating or multi-arm bodies into the humanoid rig.

## Constraints and review focus

- Work locally on `art/social-media-agent`; tracking is waived in this session.
- Preserve the supplied artwork and the running Blender scene. Build in a separate Blender process.
- No automatic character reassignment, roster migration, or replacement of the existing two shipped models.
- Visual fidelity and silhouette must be checked in renders; passing geometry checks alone does not establish artwork completion.
- Do not claim app integration until the app has loaded, animated, and rendered the new rig.

## Animation correction after first review

The first draft used crude procedural clips, and its preview omitted the production facial behavior. Its structural checks passed but did not establish acceptable animation quality. The user rejected that draft.

- [x] Extract the actual production motions, including work and phone adjustments, with recorded source provenance.
- [x] Retarget those 18 clips to the dedicated social rig and remove the invented Present action.
- [x] Add synchronized playback of the actual existing unit and rock models to the review page.
- [x] Use the existing runtime face/light logic, including blink, sleep, and fault states; remove the permanently winking face.
- [x] Verify full-cycle comparison sequences and ground contact after retargeting. GLB validation passes; 456 sampled poses and 40 comparison screenshots have no renderer errors. Maximum non-spawn floor overlap is 10.3 mm during running. Existing robot tests pass 5/5.
- [x] Obtain visual review before extending this workflow to the remaining cast.

Production integration and the remaining characters are still outstanding. No character registration, merge, or publish has been performed.

## Joint separation correction

The prior pose bounds checks missed joint separation. The motion exporter read stale animated `matrixWorld` values after the source mixer stopped, rather than inverse bind matrices. The retargeter interpreted the mismatched rest pose as joint translations.

1. Reproduce the separation with shared-pivot checks on the exported GLB.
2. Export the true bind pose; preserve fixed joint offsets for the mechanical skeleton and transfer translation only at root/hips.
3. Rebuild and inspect interact, phone/up/down, run, sit/down/up from multiple angles. Check shared pivots throughout all clips, plus existing floor, skin, and texture validation.

Correction verification: the new shared-pivot regression check failed on the old GLB (for example, cheer separated the left elbow by 356 mm). After rebuilding from inverse bind matrices with fixed limb offsets, all 1,901 sampled poses pass; the largest measured pivot gap is below 0.001 mm. The GLB contract check and 5 existing robot tests pass. Non-spawn ground overlap remains below the 25 mm review threshold (17.3 mm during running). This is a joint-continuity fix, not final art approval.

## Second model: Email Marketing Specialist

Recreate the approved burgundy/brass courier: wide hooded face, arched amber eyes, recessed chest mail slot, stocky armored limbs, shoulder bag, sealed envelope and paper aircraft. Preserve its proportions on a dedicated rig. Reuse the corrected inverse-bind motion export, rotation-only rigid joints, campus baking, and runtime light behavior.

1. Build the editable character and removable mail props from the reference.
2. Retarget 18 production clips and export a portable GLB.
3. Generalize the isolated review/capture tools to select an asset, preserving the social preview.
4. Validate joint continuity at 60 Hz and inspect silhouette, mail accessories, phone, sitting and running from multiple angles.

The user authorized the next model after reviewing the social agent. Tracking remains waived. Production integration is still separate.

Second-model verification: editable Blender and GLB exported; 31 bones, 38,436 triangles, 18 clips, and 4,918,840-byte GLB. All 1,901 sampled poses pass joint continuity (maximum 0.000000527 m); no renderer errors. The final browser captures include bare-body motion, mail props, and review controls. Existing robot tests pass 5/5, and the social-model/agent-selector smoke check passes. Final visual approval and production integration remain pending.

## Courier shape and palette refinement

User feedback: coloring is off and the model feels too square. Match the approved reference more closely with oxblood paint, aged bronze, dark gunmetal, a rounded tapered visor/chest, curved limb shells, and rounded boot soles. Replace thickness-limited box bevels with rounded profile geometry; retain the corrected rig pivots. Rebuild, compare the studio renders, then repeat GLB and joint-continuity validation.

Additional review correction: the display's upper corners extended beyond the curved hood profile. Replaced the rectangular display shoulders with a clipped, rounded outline shared by the bezel and glass, then checked both upper corners against the brow opening.

Refined courier verified: GLB contract check and all 1,901 pose samples pass. Front, left, and right browser renders confirm both upper display corners sit inside the hood. Final asset: 47,316 triangles, 31 bones, 18 clips, 5,291,448 bytes.

Visor attachment correction: added solid swept brass temple supports, with dark insets and fasteners, overlapping both hood ends, cheek frame, and ear housings. Rebuilt the Blender source and GLB; front, both three-quarter views, and both profiles show continuous mounts. GLB validation and the full animation capture check pass without renderer errors. Updated asset: 48,388 triangles, 31 bones, 18 clips, 5,408,120 bytes.

Visor silhouette refinement: replaced the deep semicircular hood with a shallow forward brim. Reduced the arch, swept the ends back to the ears, exposed the crown, and raised the temple supports to maintain physical attachment. Checked studio, front, three-quarter, and profile renders; the GLB and animation capture checks pass. Updated GLB: 5,366,808 bytes; 48,388 triangles, 31 bones, and 18 clips.

## Reference correction and fastener seating

The user rejected the cap-like brim and the subsequent flattened interpretation of the reference. The reference visor is rounded. Rebuild it with continuous curvature across its width and depth, a swept front edge, and side returns into the chin frame.

An underside screenshot also exposed floating fasteners that the prior front-view inspection missed. Replace hard-coded bolt depth with contact against the supporting mesh. Relocate unsupported chest bolts inside panels or onto strap buckles, embed ear rivets in their rims, and extend the forehead lamp backing into the face frame. Check every hex bolt's six base corners against the armor; preserve underside captures in the regular review workflow. This is a geometry/attachment correction, not final visual approval.

Verification: all 28 hex bolts have supporting surfaces; all 168 tested base corners lie inside their supporting geometry (least overlap 0.278 mm). Sixteen ear rivets overlap the brass mounting rim. Inspected close front, side, and underside renders. The GLB contract and all 1,901 sampled animation poses pass, with no renderer errors. Export: 51,704 triangles, 31 bones, 18 clips, 5,506,704 bytes. Final visual acceptance remains with the user.

The user accepted the email model and authorized the next character.

## Third model: Copywriter

Use `agents/Finals/Copywriter.png` directly: tall, slender cream-painted mechanism; one large amber optical lens; asymmetrical swept head shell; charcoal wrapped scarf with a long tail; brown leather satchel; removable open book and fountain pen. Preserve its distinctive proportions rather than reusing the courier body.

Copywriter subsequently accepted after rebuilding the shell along its fore-aft axis with a tapered rear and an open arched brow. User authorized the next character.

1. Build the editable geometry, checking the reference silhouette and seating hardware on its actual supports.
2. Retarget the 18 production clips to its own proportions; give the cloth tail a blended scarf chain while keeping mechanical parts rigid.
3. Bake/export and add Copywriter to the isolated review selector.
4. Verify rigid pivots, scarf weights, hardware contact, floor contact, and front/side/back/underside motion renders. Present for visual review.

Initial Copywriter verification: 34 bones, 18 production clips, 72,648 triangles, 6,771,560-byte GLB. The cloth chain has 1,736 blended vertices; mechanical vertices remain rigid. All 1,901 pose samples pass joint continuity (maximum gap 0.000000535 m), with no renderer errors. Worst non-spawn floor overlap is 21.2 mm, within the existing 25 mm review threshold. All 25 hex bolts pass 150 base-corner contact checks (minimum overlap 2.10 mm). Reviewed studio, close head, underside, phone, sitting and running renders; corrected lens/canopy interference and filled the scarf collar between folds. Existing robot tests pass 5/5, and prior character GLBs still pass the asset validator. This initial build preceded the accepted shell revision; production registration remains separate.

## Fourth model: SEO Strategist

Reference: `agents/Finals/SEO Strategist.png`. Preserve the large turquoise spherical head, convex black face with two amber arches, tall panel antennae, compact exposed torso, scanner backpack, articulated arms, and two long tapered hover pods. Do not add humanoid feet or knees absent from the reference.

1. Build editable spherical armor, seated hardware, connected joints, antennae, hover pods, and a removable magnifying glass.
2. Give this anatomy its own rigid rig. Retarget the 18 production clips, reduce leg gait rotations for the single-piece hover pods, and preserve ground clearance.
3. Bake/export and add the model to the existing isolated review selector.
4. Inspect actual reference-angle, profile, rear, underside, and action renders; validate weights, contact, joint continuity, and prior asset behavior.

Tracking remains waived; work stays local and production registration remains separate.

SEO review build verified: 26 bones, 18 clips, 57,096 triangles, and 5,456,020-byte GLB. All 1,901 pose samples retain shared pivots (maximum gap 0.000000450 m) and hover clearance (minimum 0.1298 m). All 26 bolts pass 156 base-corner checks, with minimum overlap 2.42 mm. No browser renderer errors. Reviewed front, profile, rear, underside, magnifier, phone, sit, and run captures. Existing robot tests pass 5/5, and all three previous asset GLBs validate. Ready for user visual review; production integration is not included.

## SEO flight and silhouette correction

User feedback: alternating leg strides are inappropriate for a floating scout; both pods should trail backward together in forward flight. Antennae should taper, and pod depth should be reduced.

- Replace walk/run gait with coordinated forward-flight poses: both pods swept aft, mild forward body lean, and trailing arms. Keep semantic clip names for the review controls.
- Replace rectangular antenna blocks with rounded tapered plate profiles, including tapered inset windows and seated fasteners.
- Reduce complete pod assemblies to 60% of their previous front-to-back depth, retaining hip bearings and reseating hardware on the final geometry.
- Verify the exported GLB with `check-flight.mjs`, plus the existing motion/contact checks and front/profile/underside captures. The new flight check fails on the prior export because a pod swings forward during walking.

Corrected export verified: walk/run pass 122 flight samples with zero pod-direction difference and zero fore-aft hip stagger; both pods remain swept backward throughout each loop. All 1,901 general pose samples pass, maximum joint gap 0.000000492 m, minimum hover clearance 0.12998 m, and no renderer errors. All 26 bolts pass their seat checks (minimum overlap 2.72 mm). Reviewed flight side/front/three-quarter views and the tapered antennae; seated two chest status lights against the curved chest panel after profile inspection. Final review asset: 57,128 triangles, 26 bones, 18 action clips, 5,441,088 bytes. Visual approval remains with the user.

SEO correction accepted. User authorized the next character.

## Fifth model: Business Strategist

Use `agents/Finals/Business Strategist.png`: transparent globe around a dark twin-optic inner head, amber orbital globe and diagram details, metallic headset/antennae, tapered armored body, substantial articulated arms, suspended blade pods, tablet and optional holographic charts.

1. Build its distinct geometry and dedicated rigid rig from the reference; preserve the suspended construction and thin pods.
2. Export the transparent globe as a separate skinned transmissive surface, keeping the existing baked opaque materials for machinery and props.
3. Reuse coordinated flight for walk/run and adapt the other production actions to its anatomy.
4. Check glass visibility, connected mechanical joints, physical fastener seating, all action samples, and multiple views of the exported GLB. Keep all assets local for review.

Business Strategist review build verified: 29 bones, 18 clips, 69,488 triangles, and a 6,726,824-byte GLB. The separate transmissive globe preserves the visible inner head. All 28 bolts pass 168 base-corner contact checks (minimum overlap 2.56 mm). Walk/run pass 122 flight samples with both pods trailing together. All 1,901 general pose samples pass, with maximum shared-pivot gap 0.000000806 m, minimum non-spawn hover clearance 0.12970 m, and no renderer errors.

The initial pose check caught lower-pod separation caused by adjusting the upper-leg transform without carrying its descendants. Propagating the transform delta through the lower-pod chain corrected the separation; the complete capture check then passed. Inspected updated seated, flight profile, underside, globe, and prop renders. All four prior GLBs still validate, existing robot tests pass 5/5, and the review script syntax and whitespace checks pass. Ready for user visual review; production integration remains separate.

Business Strategist accepted after changing its metal to dark oil-rubbed bronze. User authorized the next character.

## Sixth model: Virtual Assistant

Reference: `agents/Finals/Virtual Assistant.png`. Preserve its curved purple-and-ivory helmet, recessed dark display with paired circular amber eyes, physical headset and boom microphone, slender plated torso with exposed neck/waist, articulated legs and chunky shoes, utility pouches, badge, and removable tablet.

1. Build reference-specific geometry with a real helmet opening, attached accessories, and fasteners seated against their support surfaces.
2. Give the humanoid proportions a dedicated rigid rig and adapt the 18 production actions, retaining facial light markers.
3. Bake and export Blender/GLB review assets; add the character to the isolated selector.
4. Compare actual renders with the reference; verify joints, floor contact, hardware, and the existing asset contract before presenting for visual review.

Tracking remains waived; work stays local on the existing branch.

Virtual Assistant review build verified: 30 bones, 18 clips, 81,240 triangles, and an 8,148,020-byte GLB. All 1,901 pose samples pass shared-pivot checks (maximum gap 0.000000715 m); worst non-spawn floor overlap is 20.4 mm, within the existing 25 mm threshold. All 42 fasteners pass 252 base-corner checks with minimum overlap 2.29 mm. No renderer errors. Existing robot tests pass 5/5, Python/JavaScript syntax checks and `git diff --check` pass.

Reference and multi-angle review led to smoother headset/microphone curves, deeper cable mounting sockets, a darker plum finish, flush display eyes, upright headset emblems, and a continuous rear service cover instead of overlapping chest surfaces. Inspected front, profile, rear, head close-up, underside, seated, phone, walking/running, props, and sleeping-eye captures. Ready for user visual review; production integration remains separate.

Virtual Assistant accepted. User authorized the next character.

## Seventh model: Website Builder

Reference: `agents/Finals/Website Builder.png`. Preserve its safety-yellow and charcoal construction, broad rectangular display with amber arch eyes, curved protective brow and chin guard, single antenna, industrial arms, tool belt, two large treaded wheels with fixed fenders, and removable tablet/rolled plans.

1. Build reference-specific geometry, with continuous armor attachments and fasteners seated on their supports.
2. Create a wheeled rig: fixed axle track, coordinated wheel spin for walk/run, lowered resting chassis for sit/sleep, and adapted upper-body gestures.
3. Export editable Blender and portable GLB assets, adding the character to the isolated review selector.
4. Validate the exported wheel behavior, shared pivots, ground contact, material contract, and rendered views/actions before visual review.

Tracking remains waived; work stays local on the existing branch.

Website Builder review build verified: 26 bones, 18 clips, 90,136 triangles, and an 8,787,988-byte GLB. All 1,901 pose samples pass, with maximum shared-pivot gap 0.000000736 m, worst non-spawn floor overlap 0.744 mm, and no renderer errors. All 54 fasteners pass 324 base-corner checks (minimum overlap 1.25 mm). The independent wheel check passes 363 samples: one forward revolution for walk, two for run, stationary wheels for sit, zero wheel-direction disagreement or fore-aft stagger, and at most 1.03 mm height variation.

Rendered review corrected stepped fastener seats, overlapping forearm armor, tread-block orientation, and the belt's attachment so pouches remain clear of fixed fenders during rest. Small LED islands initially occupied less than one texel and baked incompletely; an opt-in light UV weighting in the shared baker allocates adequate atlas space while retaining the standard texture dimensions. The final browser close-up shows complete amber arches, and sleep closes/dims them. Inspected front/profile/rear/underside, lowered rest, phone, rolling, and prop views. Existing robot tests pass 5/5, all six prior GLBs validate, and syntax/whitespace checks pass. Ready for user visual review; production integration remains separate.
