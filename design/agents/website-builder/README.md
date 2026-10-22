# Website Builder

Seventh review character, built from `agents/Finals/Website Builder.png` after acceptance of the Virtual Assistant.

The model has weathered safety-yellow armor, a curved protective brow around a rectangular amber-eye display, a single antenna, industrial arms, an equipped tool belt, and a two-wheel chassis with treaded tires and fixed mudguards. The removable accessories are a wireframe tablet and three hollow rolled plans with cylindrical ink markings.

- `website-builder.blend`: editable named geometry, materials, independent 26-bone rig, studio, and 18 action clips.
- `website-builder.glb`: baked machinery and work accessories, sharing the character's rigid skin.
- `rig.json`: anatomy, wheel configuration, and motion provenance.
- `preview.png` and `previews/`: actual renders and validation reports.

Walk and run roll both wheels forward together, with one and two revolutions per loop respectively. The axle track stays fixed and the fenders remain attached to the chassis. Sit lowers the upper assembly by 10 cm along its central support; sit-down and stand-up animate that transition. Upper-body gestures adapt the production actions to this anatomy, while jump/spawn move the complete wheelbase together. Eye/light markers support the review app's blinking, sleeping, and status expressions.

Fasteners are seated against actual support geometry. `check-wheels.mjs` independently samples the exported GLB to verify forward rotation, matched wheels, horizontal axles, stable track width, and stationary wheels at rest.

The exporter gives eye-marked surfaces 12× UV scale before repacking the atlas. This keeps the individual LED pixels readable in the standard 1024-pixel body textures; the baker's default behavior for other assets is unchanged.

These are local review assets; production roster and instanced-renderer integration remain separate.

## Rebuild

With Vite on `127.0.0.1:5277`:

```sh
npx electron tools/export-crew-motion.cjs website-builder
blender --background --factory-startup --python-exit-code 1 --python design/agents/website-builder/build.py
blender --background design/agents/website-builder/website-builder.blend --python-exit-code 1 --python design/agents/website-builder/export.py
node tools/check-agent-model.mjs design/agents/website-builder/website-builder.glb
node design/agents/website-builder/check-wheels.mjs
npx electron tools/capture-agent-model.cjs website-builder
```

Review at `/tools/agent-model.html?asset=website-builder`.
