# Business Strategist

Fifth review character, built from `agents/Finals/Business Strategist.png` after acceptance of the SEO Strategist.

Distinctive geometry includes a clear outer globe, a separate dark twin-optic head, an internal wire globe and orbital halo, a segmented metal cradle, headset fins, substantial articulated arms, and suspended articulated blade pods. The gap between the central thruster and the magnetic pod hubs follows the reference. A tablet and wireframe chart projections are removable together.

The metal finish is dark oil-rubbed bronze: brown-black machinery, warm bronze armor and polished hardware, with aged bronze trim and amber lights.

- `business-strategist.blend`: editable named geometry, materials, 29-bone rig, studio, and 18 action clips.
- `business-strategist.glb`: baked opaque machinery/props plus a separate skinned glass globe.
- `rig.json`: anatomy, material exceptions, motion provenance, and hover clearance.
- `preview.png` and `previews/`: actual studio/browser renders, contact and motion checks.

Walk and run use the coordinated flight construction accepted for the scout: both pods sweep backward together, with a slight forward lean and trailing arms. Other actions adapt the production motions to this anatomy. All mechanical parts have rigid skin weights.

The globe uses glTF transmission with IOR 1.12 and roughness 0.055. It is deliberately kept outside opaque texture baking. The material validator checks that it remains a clear dielectric; the review renderer excludes it from opaque shadow casting. These are local review assets, not production roster or instanced-renderer integration.

## Rebuild

With Vite on `127.0.0.1:5277`:

```sh
npx electron tools/export-crew-motion.cjs business-strategist
blender --background --factory-startup --python-exit-code 1 --python design/agents/business-strategist/build.py
blender --background design/agents/business-strategist/business-strategist.blend --python-exit-code 1 --python design/agents/business-strategist/export.py
node tools/check-agent-model.mjs design/agents/business-strategist/business-strategist.glb
node design/agents/business-strategist/check-flight.mjs
npx electron tools/capture-agent-model.cjs business-strategist
```

Review at `/tools/agent-model.html?asset=business-strategist`.
