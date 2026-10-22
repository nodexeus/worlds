# SEO Strategist

Fourth character review asset, modeled from `agents/Finals/SEO Strategist.png` after approval of Copywriter.

A turquoise spherical scout with an amber optical display, two scanner antennae, compact torso, scanner backpack, articulated arms, and two tapered hover pods. The pods have hip pivots and no invented knees or feet. The magnifying glass is removable.

- `seo-strategist.blend`: editable named geometry, materials, rig, studio, and animation clips.
- `seo-strategist.glb`: baked rigid body, removable magnifier, embedded textures, and 18 action clips.
- `rig.json`: anatomy, source-motion provenance, and hover clearance.
- `preview.png` and `previews/`: actual renders and validation results.

Walk and run are authored forward-flight loops: both pods sweep backward together, with a gentle forward body lean and trailing arms. Run uses a stronger lean and sweep. Other actions retain the production motions adapted to single-piece pods. The retargeter adds 14 cm of clearance with 1 cm of cyclic hover motion. Antenna panels taper toward their tips; pod assemblies are 40% shallower front to back while retaining full-size hip bearings. This is a review asset; production locomotion and roster registration are separate. The magnifier uses a reflective lens material compatible with the existing texture baker, rather than optical refraction.

## Rebuild

With Vite on `127.0.0.1:5277`:

```sh
npx electron tools/export-crew-motion.cjs seo-strategist
blender --background --factory-startup --python-exit-code 1 --python design/agents/seo-strategist/build.py
blender --background design/agents/seo-strategist/seo-strategist.blend --python-exit-code 1 --python design/agents/seo-strategist/export.py
node tools/check-agent-model.mjs design/agents/seo-strategist/seo-strategist.glb
npx electron tools/capture-agent-model.cjs seo-strategist
node design/agents/seo-strategist/check-flight.mjs
```

Review at `/tools/agent-model.html?asset=seo-strategist`. Props default off for motion inspection. Hardware base contact and shared joint pivots are checked independently from visual fidelity.
