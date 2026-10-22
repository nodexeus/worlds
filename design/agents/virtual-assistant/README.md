# Virtual Assistant

Sixth review character, built from `agents/Finals/Virtual Assistant.png` after acceptance of the Business Strategist.

The model has a curved purple-and-ivory helmet with a real front opening, recessed amber-ring display, attached headset cables and boom microphone, exposed neck and waist mechanisms, plated humanoid limbs, utility pouches and badge, and a removable tablet.

- `virtual-assistant.blend`: editable named geometry, materials, dedicated 30-bone rig, studio, and 18 action clips.
- `virtual-assistant.glb`: baked machinery and removable tablet, sharing the character's rigid skin.
- `rig.json`: anatomy, motion provenance, and clip metadata.
- `preview.png` and `previews/`: actual studio/browser renders and verification reports.

Production motion rotations are retargeted to this character's own shared pivots and dimensions. The eye/light markers support the review app's blinking, sleeping, and status expressions. Fasteners are seated against actual support geometry before export.

These are local review assets; production roster and instanced-renderer integration remain separate.

## Rebuild

With Vite on `127.0.0.1:5277`:

```sh
npx electron tools/export-crew-motion.cjs virtual-assistant
blender --background --factory-startup --python-exit-code 1 --python design/agents/virtual-assistant/build.py
blender --background design/agents/virtual-assistant/virtual-assistant.blend --python-exit-code 1 --python design/agents/virtual-assistant/export.py
node tools/check-agent-model.mjs design/agents/virtual-assistant/virtual-assistant.glb
npx electron tools/capture-agent-model.cjs virtual-assistant
```

Review at `/tools/agent-model.html?asset=virtual-assistant`.
