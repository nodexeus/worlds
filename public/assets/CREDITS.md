# Bundled art

The `.glb` files in this directory are built from three CC0 asset packs by
**[Kay Lousberg](https://kaylousberg.com)**, one by **[Kenney](https://kenney.nl)** and one by
**[Quaternius](https://quaternius.com)**. They are **not** covered by the project's MIT
licence — they are [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), which places
them in the public domain.

| File | Built from | Licence |
| --- | --- | --- |
| `spacebase.glb` | [KayKit : Space Base Bits](https://kaylousberg.itch.io/space-base-bits) | CC0 1.0 |
| `crew.glb` | [KayKit : Character Animations](https://kaylousberg.itch.io/kaykit-character-animations) | CC0 1.0 |
| `forest.glb` | [KayKit : Forest Nature Pack](https://kaylousberg.itch.io/kaykit-forest) | CC0 1.0 |
| `nature.glb` | [Nature Kit](https://kenney.nl/assets/nature-kit) by **[Kenney](https://kenney.nl)** — palms, cacti, pines, autumn and jungle trees, recoloured and vertex-baked by `tools/build-nature.mjs` | CC0 1.0 |
| `megakit.glb` | [Modular Sci-Fi MegaKit](https://quaternius.com/packs/modularscifimegakit.html) (Standard) by **[Quaternius](https://quaternius.com)** — re-homed, downscaled, and with the pack's own logo decals removed by `tools/build-megakit.mjs` | CC0 1.0 |

CC0 requires nothing of you. Crediting Kay, Kenney and Quaternius costs nothing either.

See the repository README under "Where the art comes from" for how these are packed, and
"Rebuilding them" if you want to regenerate them from the original packs.

## campus/deck_*.jpg, campus/deck_normal.png

The campus deck plate. Made for this project by `design/campus/bake_deck.py`, run in Blender.

## campus/buildings.glb

The campus's own buildings. Modelled for this project in Blender (`design/campus/build_*.py`),
baked by `design/campus/bake_model.py` and packed by `tools/build-buildings.mjs`.
