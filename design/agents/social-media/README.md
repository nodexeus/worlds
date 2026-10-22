# Social media specialist

First model for visual review, based on `agents/Finals/Social Media Specialist.png`.

- `social-media.blend`: editable named mechanical parts, dedicated armature, source materials, 18 retargeted production clips, and a preview studio. Baked meshes are retained in hidden export collections.
- `social-media.glb`: portable animated model with embedded base-color, normal, roughness/metallic, and emission maps. The character and removable camera each use one material.
- `rig.json`: bone hierarchy and action names. Blender coordinates are Z-up, front -Y; GLB exports Y-up, front +Z.
- `preview.png`: Blender studio render. `previews/` contains renders of the exported GLB in Three.js and validation evidence.

The source has a dedicated 30-bone rig, including fingers, independently controlled eyes, and a camera attachment. Mechanical parts use rigid weights. The 18 body clips are retargeted from the exact production bone texture, including the app’s work and phone adjustments. `rig.json` records source filenames, their combined SHA-256, clip names, durations, and loop flags. The first draft’s procedural motions and invented Present action have been removed. Bind-pose transforms come from inverse bind matrices, never the mixer’s last evaluated pose. Mechanical joint offsets remain fixed: limb animations transfer rotation, while root/hips carry body translation. Ground contact is adapted to this character’s proportions; spawn retains the original entrance motion.

## Rebuild

From the repository root, with Blender on PATH and Vite running on 127.0.0.1:5277:

```sh
npx electron tools/export-crew-motion.cjs
blender --background --factory-startup --python design/agents/social-media/build.py
blender --background design/agents/social-media/social-media.blend --python design/agents/social-media/export.py
node tools/check-agent-model.mjs design/agents/social-media/social-media.glb
# With Vite running on 127.0.0.1:5277:
npx electron tools/capture-agent-model.cjs
```

Visit `/tools/agent-model.html` for synchronized playback: existing unit on the left, social media in the center, existing rock on the right. The baselines use the actual production models, skinning shader, and animation data. Camera visibility is optional and off by default. Sleep plays sitDown followed by sit; its dimmed, nearly closed eyes distinguish it from awake sitting. All three use `robotLights` and `decorateLights` for blinking, eye openness, fault color, and lamp brightness. Facial states are runtime shader behavior, not embedded GLB body clips; Blender alone will not reproduce these runtime expressions. This isolated review page does not read or change the user's world or roster.

## Integration boundary

This model intentionally preserves longer-legged proportions instead of using the existing unit/rock skeleton. It is not registered in the production roster yet. The production renderer currently shares a single bone texture between robot kinds; it needs per-rig animation data, attachment/picking transforms, and a semantic clip mapping before this model can replace an agent in the world. Floating and multi-arm characters will need their own anatomy and action implementations through the same interface.

Before shipping, review silhouette and material fidelity against the supplied artwork, refine motion/contact and facial expressions, then profile instance counts and choose an appropriate LOD. Structural validation and successful GLB playback do not constitute final art approval.

The capture check samples every clip at 60 Hz, including endpoints, and compares each joint pivot transformed by its parent and child. A gap over 1 mm fails validation. It also records front and side views of interact, phone/up/down, run, and sitting transitions. This checks joint continuity separately from overall model bounds.
