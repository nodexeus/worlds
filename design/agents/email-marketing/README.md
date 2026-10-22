# Email Marketing Specialist

Second character review asset, built from `agents/Finals/Email Marketing Specialist.png`.

The courier has a burgundy visor housing with a broad brow and tapered side returns, rectangular black display with amber arched eyes, brass-rimmed ear housings, a glowing antenna, a recessed chest mail slot, layered armor, chunky boots, and a leather satchel. The sealed envelope and paper aircraft are removable accessories. Its stockier proportions use a dedicated 31-bone mechanical rig.

- `email-marketing.blend`: editable named parts, source materials, rig, 18 retargeted production clips, and a studio camera. Baked meshes are hidden for editing.
- `email-marketing.glb`: self-contained body and mail props, with rigid skinning, baked textures, and all 18 clips.
- `rig.json`: anatomy, animation metadata, source hash, and inverse-bind provenance.
- `preview.png`: studio render. `previews/`: browser renders and verification results.

## Rebuild and review

With Vite serving the repository on 127.0.0.1:5277:

```sh
npx electron tools/export-crew-motion.cjs email-marketing
blender --background --factory-startup --python design/agents/email-marketing/build.py
blender --background design/agents/email-marketing/email-marketing.blend --python design/agents/email-marketing/export.py
node tools/check-agent-model.mjs design/agents/email-marketing/email-marketing.glb
npx electron tools/capture-agent-model.cjs email-marketing
```

Open `/tools/agent-model.html?asset=email-marketing`. The Agent selector also preserves access to the social specialist. Mail props default off so they do not obscure motion review. The comparison characters use the existing production renderer and clips.

The builder reuses geometry helpers from the campus and social scripts, and the corrected `social-media/retarget.py`. Export delegates to the same configurable bake/export implementation. Source bind matrices are derived from inverse binds; fixed limb offsets prevent joint separation. The capture check samples shared pivots at 60 Hz, including transition endpoints, and fails above 1 mm separation.

Eye blinking, sleep dimming, and fault colors use the app's runtime shader logic. These facial states are visible in the review page, not embedded Blender body animation clips.

This is a local review asset. It is not yet registered in the production roster. The reference supplies one view; hidden surfaces and mechanical construction are modeled interpretations, and final art approval remains separate from structural validation.

Refinement after review: rounded/tapered visor and chest profiles are independent of plate thickness; the limb armor uses domed shells and the boots use rounded soles. The palette is oxblood, aged bronze, and dark gunmetal. Both display shoulders are clipped beneath the brow. The visor has continuous curvature across its width and depth, a swept leading edge, and side returns into the lower face frame. Its front edge has a narrow brass rim and dark interior. Compact brass hinge blocks connect it to the ear housings; all casing parts follow the head bone. The flat cap brim and flattened brow were rejected during visual review.

Hex fasteners are seated on the completed supporting geometry with surface ray casts. The builder checks all six corners of every head's base, rejecting unsupported or floating edges; `previews/fastener-seating.json` records contacts. Chest bolts sit within panels or strap buckles, and ear rivets intersect their brass rims. The review capture includes close underside views to expose attachment gaps that front views miss.
