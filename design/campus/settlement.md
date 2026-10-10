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

Origin: centre of the platform, on the walking surface (y = 0). The walking area is the hexagon with
corners at 0, 60, 120 ... degrees at radius 5.942, so the six edges face 30, 90, 150 ... degrees. Any
multiple of 60 degrees of turn fits. Slab from y = 0 to -0.45, an I beam under each edge down to
-0.88 with stiffeners and a bolt row, joists under the slab. No kerb, rail or lit strip: those are
edge parts.

Corner k is at (5.942 cos 60k, 0, -5.942 sin 60k). Edge k runs from corner k to corner k + 1.

Each deck has a dark tread field, a pale brushed way across it, a few plates of another tone, one
rusted plate at most, grilles, a hatch or two and one amber mark. No number is painted on a deck:
the app lays it on (see Deck numbers).

| Part | Finish | Way | Triangles | Bytes | Maps |
|---|---|---|---|---|---|
| deck-a | used | through the centre, edge 0 to edge 3 | 6300 | 3201672 | 1024 |
| deck-b | nearly clean | through the centre, edge 1 to edge 4, with a cross strip | 6295 | 3085428 | 1024 |
| deck-c | used | off centre, parallel to the line from edge 2 to edge 5 | 6428 | 3229356 | 1024 |
| deck-d | nearly clean | off centre, parallel to the line from edge 1 to edge 4, with a cross strip | 6916 | 3133600 | 1024 |

### Corners

| Corner | deck-a | deck-b | deck-c | deck-d |
|---|---|---|---|---|
| 0 | balcony | shelf | step | drop |
| 1 | plain | drop | notch | balcony |
| 2 | drop | plain | shelf | step |
| 3 | notch | balcony | plain | plain |
| 4 | step | plain | drop | shelf |
| 5 | plain | notch | drop | plain |

- `plain`: the hexagon's own corner.
- `drop`: inside the hexagon. The plates stop 0.8 short of the corner and a dark grating lies 0.05
  lower. The cut reaches 1.6 along each edge from the corner. Nothing sticks out.
- `notch`: inside the hexagon. A framed grille 0.92 square, centred 1.15 in from the corner, standing
  0.07 above the deck.
- `balcony`: sticks out. A railed platform 1.5 wide carried 0.9 past the corner along the line from
  the centre through the corner (farthest point 6.88 from the centre). Its floor is at y = -0.08, its
  rail top at 0.88, a mast to 1.27.
- `shelf`: sticks out. A shelf of plant 1.4 wide carried 0.85 past the corner the same way (farthest
  point 6.83 from the centre). Its floor is at y = -0.30, the plant on it reaches 0.42.
- `step`: sticks out. The line of edge k - 1 carried 0.7 past corner k, 1.05 deep, level with the
  deck, with a kerb to 0.12 and a bollard to 0.54. It lies outside edge k: up to 0.61 out from that
  edge's line, within 1.3 of the corner along it.

Keep a `deck-join`, a `deck-fill` and a `stair-2` (whose landing lies over the point where three
decks meet) away from a corner that carries a balcony, a shelf or a step. Two or three decks may
each have a balcony or shelf at the same meeting point: they clear each other by 0.5 or more.

### Along the edges

All of these are below the deck top (highest point y = -0.06), on the outside of the edge beam, and
centred 1.55 to 1.95 from the middle of the edge. A crossing (1.5 wide, at the middle) clears them.
A `deck-join` covers them from above; their lower parts still show under it.

| Edge | deck-a | deck-b | deck-c | deck-d |
|---|---|---|---|---|
| 0 | conduit | none | catwalk | bracket |
| 1 | none | box | conduit | none |
| 2 | catwalk | conduit | none | box |
| 3 | none | bracket | box | catwalk |
| 4 | bracket | none | none | conduit |
| 5 | box | catwalk | bracket | none |

- `conduit`: two pipes the length of the beam, 0.09 out, with a box 0.16 out.
- `bracket`: a plate and a hanging drum, 0.34 out, 0.4 long.
- `catwalk`: a strip of grating 1.25 long, 0.33 out.
- `box`: a cabinet 0.5 long, 0.24 out.

Attach points (deck space): edge k mid point at angle 30 + 60k degrees, distance 5.146; legs and
under-lamp at the origin; modules, frames, signs and dishes stand anywhere on y = 0 inside the
hexagon, clear of a notch.

## Decks of their own shape

Twenty decks in three sizes: six small and eleven medium on one cell, three large on two. Origin at the centre of the deck's (first) cell on the walking surface. Any
multiple of 60 degrees of turn; no mirroring. Kerbs, rails, lit strips and edge beams are part of the
model: they take no edge parts and no leg sets. `deck-shapes.json` carries each one's outline, ports,
wings, footprints, posts, lit strips and number place, and is written by `build_settlement.py` from the
same figures the models are built from.

A large deck covers two cells: its own and the neighbour in direction k = 0, whose centre is 13.164
away at 30 degrees (x 11.400, z -6.582). Its ports and wings are given as (cell, k).

What every one of them keeps to:

- A port is at an edge mid point of a cell's hexagon: 5.146 from that cell's centre at 30 + 60k
  degrees. There the floor ends flush, 2.6 wide, with 2.2 of it open (no kerb or rail) and 2.1 clear
  between the kerbs of the floor that leads to it.
- A wing is a direction with no port in which the floor runs out past 5.146: at most 9.0 from the cell
  centre and 1.7 either side of the direction. Use a deck only at a turn where each wing points at a
  cell that stays empty.
- In every other direction there is no floor beyond 5.146 within 1.7 either side. Bolt heads in the
  slab's face stand 0.03 past it, and on `deck-s2` and `deck-m6` the end of a beam under the deck stands
  0.10 to 0.12 past it.
- Elsewhere the floor stays inside its cell's hexagon or within 7.0 of the cell centre toward a corner.
  A large deck's floor also crosses the gap between its own two cells, up to 5.94 wide.

| Part | Size | What it is | Area | Ports | Wings | Fits (buildings + stacks) | Posts | Triangles | Bytes |
|---|---|---|---|---|---|---|---|---|---|
| deck-s1 | small | a tight landing in the corner between two ports | 44.5 | 0 1 | none | 0 + 1 | 3 | 5151 | 3119988 |
| deck-s2 | small | an L with a port at the end of each arm | 40.8 | 2 5 | none | 0 + 1 | 3 | 4810 | 2904312 |
| deck-s3 | small | a pad out on a wing, reached by its own walkway | 49.7 | 3 4 | 1 | 1 + 1 | 3 | 7951 | 3148208 |
| deck-m1 | medium | a long pier with a bulb at one end | 81.6 | 0 2 4 | 1 | 2 + 2 | 5 | 7063 | 3226908 |
| deck-m2 | medium | a wedge running out to a point, a jetty either side | 81.2 | 1 3 5 | 0 | 2 + 1 | 5 | 7336 | 3090388 |
| deck-m3 | medium | a slab with a bite out of it and a pier off one side | 83.5 | 0 1 3 4 | 5 | 0 + 2 | 5 | 7833 | 3179268 |
| deck-m4 | medium | half a slab and a forked jetty to the two far ports | 77.2 | 0 1 2 3 4 5 | none | 0 + 1 | 5 | 5774 | 2978312 |
| deck-s4 | small | an S: a strip between two ports, a pad hung off each side | 43.9 | 0 3 | none | 0 + 1 | 3 | 4912 | 2920132 |
| deck-s5 | small | a spine with a branch one side and a pad the other | 48.4 | 1 2 4 | none | 0 + 1 | 3 | 5726 | 3118020 |
| deck-s6 | small | a blunt block on two ports, one arm reaching for a third | 46.8 | 0 2 3 | none | 0 + 1 | 3 | 4667 | 3040816 |
| deck-m5 | medium | a cleaver: a broad blade and a handle to the third port | 73.7 | 0 1 3 | none | 1 + 1 | 5 | 6444 | 3227844 |
| deck-m6 | medium | a slab with a long slot cut in from one side | 82.9 | 0 2 3 | none | 0 + 1 | 5 | 6614 | 2998220 |
| deck-m7 | medium | one side sliced off on the slant, two corners stepped out | 75.5 | 1 3 5 | none | 1 + 2 | 5 | 5451 | 3144676 |
| deck-m8 | medium | a T: a bar across three ports and a broad stem to the fourth | 75.5 | 0 1 2 4 | none | 0 + 1 | 5 | 5755 | 3005476 |
| deck-m9 | medium | a hammer: its top planed off, a pier out over the next cell | 85.2 | 0 3 4 5 | 2 | 0 + 2 | 5 | 6745 | 3151552 |
| deck-m10 | medium | a slab with a wedge taken out to its middle | 77.5 | 0 1 2 3 4 | none | 0 + 1 | 5 | 5237 | 2984008 |
| deck-m11 | medium | a butterfly: slotted from below, trimmed corners, a pier above | 88.5 | 0 2 3 5 | 1 | 0 + 2 | 5 | 7109 | 3161588 |
| deck-l1 | large | a dumbbell: two pads and a neck across the gap | 158.0 | (0,1) (0,3) (1,0) (1,4) | none | 2 + 4 | 8 | 12055 | 3366212 |
| deck-l2 | large | a broad yard with a pier | 166.9 | (0,1) (0,5) (1,0) (1,5) | (1,1) | 3 + 3 | 8 | 11296 | 3247980 |
| deck-l3 | large | a pad, a long arm to a far landing, a pier behind | 148.2 | (0,2) (0,4) (1,0) (1,1) (1,5) | (0,3) | 0 + 4 | 8 | 12451 | 3295804 |

All maps are 1024. Highest point of any of them is 1.27 (a balcony's mast); most stop at 0.98 (rail).

### What fits

The footprints given keep every margin: a building is a circle of radius 1.6, a stack a rectangle
3.56 by 2.36; 0.3 from the edge, 0.8 between any two, and outside each port's lane (1.0 either side
of its centre line for 2.0 inward). "Fits" in the table is what a search found with all of that kept,
most footprints first and stacks before buildings. It is a search, not a proof: a count one higher
may exist on some decks. `deck-s6`, `deck-m5`, `deck-m8` and `deck-m10` were asked for
buildings before stacks, though still a stack where one fits; `deck-m9` takes a stack over two buildings.

### Posts

`post-1` to `post-5`: one heavy leg for a deck on levels 1 to 5. Origin at the middle of the post's
head, with y = 0 at the walking surface as the leg sets have it: the head plate is at y = -0.45 and
the footing's underside at -1.80, -3.15, -4.50, -5.85 and -7.20. A concrete pad, a bolted base plate,
an H section, a head plate and four knee braces. Maps 512.

| Part | Footprint (x by z) | Triangles | Bytes |
|---|---|---|---|
| post-1 | 1.76 x 1.76 | 972 | 737420 |
| post-2 | 2.46 x 2.46 | 1040 | 758972 |
| post-3 | 2.54 x 2.54 | 1016 | 760228 |
| post-4 | 2.64 x 2.64 | 1084 | 731632 |
| post-5 | 2.72 x 2.72 | 1132 | 518756 |

The footprint is the knee braces' reach just under the slab; the pad is under 1.6 across. Each deck's
post places are in `deck-shapes.json`: under floor, 0.75 or more in from the edge. A brace of a post
that near an edge reaches past the edge under the deck by up to 0.6. `ties` lists pairs of posts
within 6.0 of each other (each post's two nearest); nothing is modelled between them.

### Number place

Same sheet, size and convention as the hexagon decks (digit height 0.97).

| Part | Centre (x, z) | Turn about Y | Plate (along the number by across it) |
|---|---|---|---|
| deck-s1 | (0.63, -3.47) | 30 degrees | 1.96 x 1.76 |
| deck-s2 | (-2.37, 1.56) | 0 degrees | 1.96 x 2.36 |
| deck-s3 | (0.89, 1.64) | 90 degrees | 2.76 x 1.54 |
| deck-m1 | (-1.23, -1.13) | 90 degrees | 1.96 x 2.36 |
| deck-m2 | (-0.61, 1.25) | 30 degrees | 1.96 x 1.76 |
| deck-m3 | (0.29, 1.12) | 150 degrees | 1.96 x 1.76 |
| deck-m4 | (-0.87, 2.82) | 90 degrees | 1.96 x 1.96 |
| deck-l1 | (0.68, -0.02) | 30 degrees | 2.36 x 2.36 |
| deck-l2 | (13.07, -4.39) | 30 degrees | 1.96 x 1.76 |
| deck-l3 | (2.72, -1.95) | 30 degrees | 1.56 x 1.56 |

On `deck-s3` and `deck-l3` the place is the largest piece of plate there is, not a whole plate.

The later single-cell decks (the plate each number lies on is in `deck-shapes.json` only by its place):

| Part | Centre (x, z) | Turn about Y |
|---|---|---|
| deck-s4 | (0.90, 1.32) | 30 degrees |
| deck-s5 | (1.02, 1.10) | 90 degrees |
| deck-s6 | (0.01, -0.16) | 30 degrees |
| deck-m5 | (0.04, -2.01) | 0 degrees |
| deck-m6 | (-0.27, -0.77) | 90 degrees |
| deck-m7 | (-0.49, -1.39) | 150 degrees |
| deck-m8 | (-1.42, -1.74) | 90 degrees |
| deck-m9 | (0.65, 1.99) | 150 degrees |
| deck-m10 | (3.18, -1.36) | 30 degrees |
| deck-m11 | (2.51, -2.18) | 90 degrees |


### deck-shapes.json

Axes as everywhere here: x across, z toward the viewer, on y = 0. Turns are about +y in radians, the
number plates' convention. For each deck: `size`, `cells`, `ports` and `wings` (k, or [cell, k] on a
large deck), `outline` (the floor's outline in order, closed implicitly), `area`, `buildings`,
`stacks` (`x`, `z`, `turn`: the frame's length runs along (cos turn, 0, -sin turn)), `posts`, `ties`
(pairs of indices into `posts`), `lit` (the middle of each lit strip, its `turn` with the deck on the
strip's own -z side, and its `length`), `number` (`x`, `z`, `turn`).

### port-gate

A swing gate between two short posts, to close a port that has no crossing. Origin at the edge mid
point on the deck top. It runs along x, 2.2 over the posts (2.0 between their middles), 1.0 high,
and stands on the deck's side of the origin (z from -0.23 to -0.03), like the edge parts: turn it
so that its -z points at the deck centre. 540 triangles, 557360 bytes, maps 512.

## Deck numbers

`stencil-digits.png` (made by `make_stencil_digits.py`): the digits 0 to 9 in one row, left to right,
each in a cell 128 wide by 192 tall (the sheet is 1280 by 192). White, with the paint in the alpha
channel, transparent elsewhere. Seven-segment stencil strokes, each digit chipped its own way. In a
cell the digit is centred and measures 140 pixels from the middle of its top stroke to the middle of
its bottom one (160 over the paint), and 70 between the middles of its side strokes (90 over the paint).

Where a two-digit number goes on each deck, in deck space, lying flat on a plate of the brushed way:

| Part | Centre (x, z) | Turn about Y | Plate (along the number by across it) |
|---|---|---|---|
| deck-a | (2.542, -1.468) | 30 degrees | 2.36 x 1.76 |
| deck-b | (-2.300, 0.363) | 90 degrees | 2.76 x 2.36 |
| deck-c | (-3.775, -0.101) | 150 degrees | 2.36 x 1.76 |
| deck-d | (2.000, -2.792) | 90 degrees | 2.76 x 1.76 |

- Turn: at a turn of t the number reads along (cos t, 0, -sin t) and the tops of its digits point
  along (-sin t, 0, -cos t). That is a quad lying flat with its image's left to right along +x and
  bottom to top along -z, then turned t about +y. Turn the deck and the number turns with it.
- Lay it at y = 0.02, just clear of the plate.
- Size, the same on all four: digit height 0.97 (middle of top stroke to middle of bottom stroke),
  so one cell of the sheet is drawn 0.885 wide by 1.327 tall. The middles of two digits are 0.678
  apart, 0.339 either side of the centre along the reading direction. Cells overlap at that pitch:
  only their empty margins do. Two digits then cover 1.30 by 1.10 of paint.

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
| legs-1 | -1.80 | 6.26 x 6.06 | 4208 | 3049492 | 1024 |
| legs-2 | -3.15 | 6.44 x 6.24 | 5828 | 3215932 | 1024 |
| legs-3 | -4.50 | 6.64 x 6.42 | 4852 | 3230220 | 1024 |
| legs-4 | -5.85 | 6.82 x 6.62 | 7276 | 3266448 | 1024 |
| legs-5 | -7.20 | 7.00 x 6.80 | 5960 | 3225664 | 1024 |
| under-lamp | -0.59 (lowest point) | 1.70 x 1.70 | 56 | 89112 | 512 |

`legs-n` is for a deck on level n. Four steel legs at (2.7, 2.6), (-2.7, 2.6), (-2.7, -2.6) and
(2.7, -2.6), each on a concrete pad with a bolted base plate, joined at the head by I beams. May be
turned by any multiple of 60 degrees. Everything is inside the footprint given. The five sets differ:

- `legs-1`: H sections, knee braces, a cable run up one leg.
- `legs-2`: box sections with bolted collars, one diagonal or a pair to the middle on each face, a pipe riser.
- `legs-3`: H sections, a tie at half height, crossed flats on two faces, a ladder, the level stencilled on one leg.
- `legs-4`: box sections, a tie, rods below it and crossed or forked flats above, a pipe riser and a cable run.
- `legs-5`: H sections, two ties, diagonals that change direction bay by bay, a pipe riser and a ladder.

One leg in each set has an amber band near the foot, and one has rusted at the foot. `under-lamp` is a lit panel in a frame against the underside of the slab.

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

Origin: centre of the base plate (for `sign-c`, midway between its two posts), on the roof or deck it
stands on (y = 0). The face is in the x, y plane and the marks show on both sides. Marks are
abstract: no words. Only the tubes and marks are lit, and each sign has a part that is out.

| Part | Colour | What it is | Size (x, y, z) | x from origin | Triangles | Bytes | Maps |
|---|---|---|---|---|---|---|---|
| sign-a | cyan | a tall strip of five stacked marks hung off one side of a mast; the fourth mark is out | 0.80 x 2.55 x 0.34 | -0.21 to 0.59 | 640 | 586540 | 512 |
| sign-b | cyan | a broken ring of tube on a bracket arm from a short post, an arrow inside; the lowest stretch is out | 1.20 x 2.08 x 0.38 | -0.19 to 1.01 | 1200 | 612756 | 512 |
| sign-c | magenta | a wide low board on two posts with a row of marks and a lit top rail; one mark is out, one cell is bare with its cable hanging | 2.06 x 1.37 x 0.44 | -1.03 to 1.03 | 760 | 621528 | 512 |
| sign-d | magenta | a mast with four odd panels at their own angles: two lit, one only its border, one dark | 1.39 x 2.10 x 0.44 | -0.64 to 0.76 | 608 | 645076 | 512 |

`sign-a` and `sign-c` were cyan and `sign-b` and `sign-d` magenta before this change: now a and b
are cyan, c and d magenta.

| Part | Size (x, y, z) | Triangles | Bytes | Maps |
|---|---|---|---|---|
| dish | 0.86 x 1.75 x 1.48 | 564 | 516208 | 512 |

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
