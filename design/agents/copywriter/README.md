# Copywriter

Third character review asset, modeled from `agents/Finals/Copywriter.png` after the user accepted the email specialist.

Distinctive construction: a single amber optical lens, a fore-aft ivory carapace with a raised tapered rear and an arched brow that curves down beside the lens, rounded casing, left antenna, charcoal scarf with a fringed tail, slender cream armor over exposed mechanisms, a brown satchel, and removable notebook/fountain-pen props. Its dedicated rig has 34 bones, including a four-bone scarf chain.

- `copywriter.blend`: editable named geometry, procedural materials, rig, studio, and 18 retargeted production clips.
- `copywriter.glb`: baked body and removable writing props, embedded textures, animations, and skin.
- `rig.json`: anatomy, motion provenance, clips, and explicitly declared deformable cloth bones.
- `preview.png`: studio render; `previews/`: browser motion views, underside views, validation, and fastener contact report.

## Rebuild

With Vite serving the repository on `127.0.0.1:5277`:

```sh
npx electron tools/export-crew-motion.cjs copywriter
blender --background --factory-startup --python-exit-code 1 --python design/agents/copywriter/build.py
blender --background design/agents/copywriter/copywriter.blend --python-exit-code 1 --python design/agents/copywriter/export.py
node tools/check-agent-model.mjs design/agents/copywriter/copywriter.glb
npx electron tools/capture-agent-model.cjs copywriter
```

Review at `/tools/agent-model.html?asset=copywriter`. Props default off for animation inspection.

Mechanical geometry retains rigid weights and fixed joint offsets. The scarf alone has blended weights; its chain bends with the adjacent leg and adds slight secondary motion. This is authored cloth motion, not cloth simulation. The exporter and motion retargeter expose optional callbacks for this asset; existing character behavior uses their unchanged default paths. Runtime eye/light states use the existing app shaders.

The builder seats each hex bolt against its completed support and checks its six base corners. Geometry checks do not establish final visual approval: compare the studio and browser renders with the supplied reference. This remains a local review asset, not production roster integration.
