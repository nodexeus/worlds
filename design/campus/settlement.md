# Settlement kit

Parts for the stilted settlement (NODEX-334). Built by `build_settlement.py`, baked and exported by
`bake_settlement.py`, both run inside `nodexeus-buildings.blend`. Each part is one mesh with one
material of baked maps (base colour, occlusion/roughness/metal, normal, emission), exported as
`nodexeus-set-<name>.glb`. Maps are in `bake/set-<name>_<map>.png`.

All figures below are in the app's units and in glTF axes: x across, y up, z toward the viewer.
(In Blender: glTF x = x, glTF y = z, glTF z = minus y.)

## Measurements the kit is cut to

Taken from `src/world/plots.js` and `src/world/planet.js`.

| Name | Value | Meaning |
|---|---|---|
| CELL | 7.6 | hex cell radius |
| TILE | 7.539 | CELL x 0.992 |
| cell apothem | 6.529 | TILE x sqrt(3) / 2 |
| pull-in | 1.383 | how far a platform's edge sits inside its cell's edge |
| AP | 5.146 | platform apothem (centre to mid edge) |
| RAD | 5.942 | platform corner radius, and the length of one edge |
| PITCH | 13.164 | centre to centre of neighbouring platforms |
| GAP | 2.872 | clear gap between neighbouring platforms (PITCH minus 2 x AP) |
| STEP | 1.35 | height of one level |
| LEVEL1 | 1.80 | deck top of the lowest level; level n is 1.80 + 1.35 x (n - 1) |
| SLAB | 0.45 | deck thickness |

The gap is 2.872, not 2.76. Parts that cross a gap are cut to 2.872. `walk` is 2.76 long as asked.

## Decks

Origin: centre of the platform, on the walking surface (y = 0). Corners at 0, 60, 120 ... degrees at
radius 5.942, so the six edges face 30, 90, 150 ... degrees. Any multiple of 60 degrees of turn fits.
Slab from y = 0 to -0.45, edge beam down to -0.86. No kerb, rail or lit strip: those are edge parts.

| Part | Finish | Triangles | Bytes | Maps |
|---|---|---|---|---|
| deck-a | used: worn plate edges, stains | 1564 | 1752052 | 1024 |
| deck-b | nearly clean, grilles | 1769 | 1863992 | 1024 |
| deck-c | used | 1339 | 1681532 | 1024 |
| deck-d | nearly clean, more grilles and a hatch | 2561 | 1961556 | 1024 |

Attach points (deck space): edge k mid point at angle 30 + 60k degrees, distance 5.146; legs and
under-lamp at the origin; modules, frames, signs and dishes stand anywhere on y = 0.

## Joining decks into one floor

| Part | Size (x, y, z) | Triangles | Bytes | Maps |
|---|---|---|---|---|
| deck-join | 5.94 x 0.89 x 3.51 | 600 | 470368 | 512 |
| deck-fill | triangle, corner radius 1.68, 0.46 thick | 201 | 300880 | 512 |
| edge-join | 2.75 x 0.14 x 0.22 | 44 | 96948 | 512 |

- `deck-join`: origin midway between two neighbouring deck centres, y = 0 at the deck top. Its z axis
  lies along the line between the two centres. It is as wide as a deck edge, so its sides run from
  corner to corner. Each end laps 0.32 onto the deck.
- `deck-fill`: origin at the point where three fused decks meet (the centroid of their centres),
  y = 0 at the deck top. Its three corners point at the three deck centres. As exported one corner
  points toward minus z.
- `edge-join`: the kerb for an open side of a `deck-join`. Origin at the middle of that side
  (2.971 either side of the join's centre along the join's x), y = 0 at the deck top. Runs along x.
  The floor is on its minus z side.

## Edges

Origin: the mid point of a deck edge, on the deck top. The part runs along x, 5.70 long. The deck is
on its minus z side, the drop on its plus z side. To dress edge k of a deck at heading h: place at
the edge's mid point and turn the part so that its minus z points at the deck centre.

| Part | Has | Height | Triangles | Bytes | Maps |
|---|---|---|---|---|---|
| edge-kerb | kerb | 0.12 | 44 | 67212 | 512 |
| edge-rail | kerb, rail on three posts | 0.98 | 144 | 172208 | 512 |
| edge-lit | kerb, lit strip 0.27 inside the edge | 0.12 | 100 | 103932 | 512 |
| edge-rail-lit | kerb, rail, lit strip | 0.98 | 200 | 221888 | 512 |

Every edge part includes the kerb. An edge that carries a crossing or a join takes no edge part.

## Legs and what hangs under a deck

Origin: the deck's centre on the deck top, the same point as the deck. Tops at y = -0.45.

| Part | Feet at y | Footprint (x by z) | Triangles | Bytes | Maps |
|---|---|---|---|---|---|
| legs-1 | -1.80 | 6.26 x 6.06 | 880 | 585112 | 512 |
| legs-2 | -3.15 | 6.44 x 6.24 | 880 | 512504 | 512 |
| legs-3 | -4.50 | 6.64 x 6.42 | 880 | 511160 | 512 |
| legs-4 | -5.85 | 6.82 x 6.62 | 880 | 470228 | 512 |
| legs-5 | -7.20 | 7.00 x 6.80 | 880 | 447104 | 512 |
| under-lamp | -0.59 (lowest point) | 1.70 x 1.70 | 56 | 89112 | 512 |

`legs-n` is for a deck on level n. Four legs with cross bracing and foot plates. May be turned by
any multiple of 60 degrees. `under-lamp` is a lit panel in a frame against the underside of the slab.

## Crossings between decks

Origin for the three crossings: the mid point of the gap between two neighbouring decks (midway
between their centres), at the top of the lower deck. The z axis lies along the line between the
centres, lower deck on the minus z side, upper deck on the plus z side.

| Part | Rise | Size (x, y, z) | Triangles | Bytes | Maps |
|---|---|---|---|---|---|
| gangway | 0 | 1.50 x 1.26 x 3.34 | 316 | 342376 | 512 |
| stair-1 | 1.35 | 1.60 x 2.58 x 3.06 | 604 | 565712 | 512 |
| stair-2 | 2.70 | 4.82 x 4.02 x 3.08 | 1860 | 2453364 | 1024 |
| stair-ground | 1.80 | 1.76 x 2.97 x 2.95 | 1136 | 819884 | 512 |

- `gangway`: level. Ends at z = -1.636 and z = +1.636. Walking width 1.5, rails both sides to 1.0.
- `stair-1`: foot at (0, 0.02, -1.49), head at (0, 1.37, +1.49). Walking width 1.5, rails both sides.
- `stair-2`: a switchback that stays inside the gap. It steps off the lower deck at x between -0.6
  and 0.6, climbs along plus x in the lane at z = -0.74 to a landing (x 3.0 to 4.2, y = 1.35), then
  returns along minus x in the lane at z = +0.74 to arrive at y = 2.70, again at x between -0.6 and
  0.6. It stands on its own frame and has no posts to the ground.
- `stair-ground`: origin at the foot, on the ground (y = 0). It climbs toward plus z and ends in a
  landing whose top is at y = 1.80 and whose far end is at z = 2.85. Place the origin 2.85 out from
  the mid point of a level 1 deck edge, with plus z pointing at the deck.

## Stacking: frame, modules, ladder

| Part | Size (x, y, z) | Triangles | Bytes | Maps |
|---|---|---|---|---|
| frame | 3.56 x 2.30 x 2.36 | 572 | 304852 | 512 |
| mod-cabin | 3.35 x 1.89 x 1.92 | 2328 | 1480024 | 1024 |
| mod-drum | 2.13 x 1.93 x 2.08 | 1176 | 1149456 | 1024 |
| mod-shed | 3.32 x 1.73 x 1.92 | 540 | 1353976 | 1024 |
| mod-tank | 2.94 x 1.79 x 1.54 | 1104 | 1995900 | 1024 |
| ladder | 0.46 x 2.80 x 0.48 | 152 | 149332 | 512 |

- `frame`: origin at the centre of its footprint, on whatever it stands on. Four posts, bracing and a
  floor whose top is at y = 2.30. Posts stand on a 3.4 x 2.2 rectangle and every module fits between them. A module or a
  second frame stands on the floor at y = 2.30 with the same origin and heading. A third storey
  stands at y = 4.60.
- Modules: origin at the centre of the footprint, on the floor. Long axis along x. Each fits under a
  frame and on top of one. Their lit windows and strips are in the emission map. No lamp light is
  baked onto their walls.
- `ladder`: origin at the base of the thing it climbs, where its head meets it. The foot is 0.42 out
  toward minus z. The rungs reach y = 2.30, the stiles reach 2.80. Against a frame: place it at the
  middle of one end (1.75 along the frame's x from its centre) with minus z pointing away from it.

## Gantry

| Part | Size (x, y, z) | Triangles | Bytes | Maps |
|---|---|---|---|---|
| gantry | 0.90 x 1.26 x 2.00 | 292 | 430864 | 512 |
| gantry-lamp | 0.10 x 0.20 x 0.10 | 56 | 192512 | 512 |

- `gantry`: one segment of walkway between frame floors. Origin at the centre of its start, on the
  walking surface. It runs 2.00 toward plus z. Walking width 0.9, rails to 0.98 ending in posts, so
  segments butt end to end. Lay the next segment 2.00 further along. To climb, tilt the segments.
  The test tilts them up to about 20 degrees.
- `gantry-lamp`: a small lamp. Origin at its base. It sits on a gantry rail post: at (0.41, 0.95, 0)
  or (-0.41, 0.95, 0) in the segment's own space.

## Signs and the dish

Origin: centre of the base, on the deck. Signs are thin along z: the face is in the x, y plane.

| Part | Colour | Size (x, y, z) | Triangles | Bytes | Maps |
|---|---|---|---|---|---|
| sign-a | cyan | 1.60 x 2.25 x 0.14 | 132 | 395352 | 512 |
| sign-b | magenta | 1.30 x 2.10 x 0.14 | 132 | 395340 | 512 |
| sign-c | cyan | 1.10 x 2.40 x 0.14 | 132 | 375696 | 512 |
| sign-d | magenta | 1.70 x 2.05 x 0.14 | 132 | 383884 | 512 |
| dish | none | 0.86 x 1.75 x 1.48 | 564 | 516208 | 512 |

## Boardwalk on the ground

Origin: the centre of the start, on the ground (y = 0). Walking surface at y = 0.45, 1.6 wide, kerbs
to 0.52. Each piece starts heading plus z.

| Part | End point (x, z) | Heading at the end | Triangles | Bytes | Maps |
|---|---|---|---|---|---|
| walk | (0, 2.76) | unchanged | 802 | 614172 | 512 |
| walk-turn-30 | (0.322, 1.200) | turned 30 degrees toward plus x | 1244 | 626464 | 512 |
| walk-turn-60 | (1.200, 2.078) | turned 60 degrees toward plus x | 2102 | 774568 | 512 |

The turns follow an arc of radius 2.4 about the point (2.4, 0). For a turn the other way, mirror the
piece in x.

## Light pools

`pool-round.png` and `pool-band.png`: 256 square, white, with the strength of the light in the alpha
channel. They are neutral: tint them amber, cyan or magenta in the app and add them over the deck.

- `pool-round`: the pool under a lamp or beside a lit module. Uneven and slightly off centre. Falls
  to nothing before the border.
- `pool-band`: the light a lit edge strip throws across the deck. The strip lies along the bottom
  edge of the image (v = 0) and the light fades toward the top. It fades out at the left and right.
  Lay it with its bottom edge on the deck edge, as long as the edge.

The test lays the round pool 6.4 x 5.2 beside each ground module and 4.2 square under each sign, and
the band 6.2 x 3.4 inside each lit edge, all at half strength, amber (1.0, 0.55, 0.16).

## Not in the kit

- `lamp-post`: not made. The campus Beacon serves as the standing lamp.
- Legs for `stair-2`, and ground posts under a `deck-join`: not made.
