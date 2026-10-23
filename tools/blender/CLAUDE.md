# The 3D asset kit — notes for Claude Code

## The 3D asset kit

`tools/blender/` is the source of truth. `npm run assets` rasterises the product's own `deck.svg`,
`card-back.svg` and `ludo-board.svg` with Chrome, runs `showcase.py` in Blender headless, and writes
`showcase-desktop.glb` and `showcase-phone.glb` into `frontend/public/world/`. **The GLBs are
committed**, so `npm run build` and CI never need Blender.

- Five vignettes (`vignettes/{hokm,poker,backgammon,ludo,chess}.py`), each built at the origin on a plinth
  under an empty named by its game id; the runtime places each root at its anchor. Real-world metres.
- **The five plinths are one mesh.** `studio.plinth` builds the lathe once (`plinth`, 2,304 triangles) and
  every later vignette's plinth is a node of its own over the same mesh: four copies were 6,900 of the
  unique-triangle budget the chess set needed. A mesh with more than one user is kept out of `merge()`.
- The chess set is 1.e4 e5 with White's knight settling onto f3: a walnut frame wearing the shared wood,
  a field of maple and walnut squares 1.2 mm proud with the grain turned square by square, a brass inlay,
  and lathed Staunton pieces at 16 sides (half a pixel off round at the landing's size), the bishop's slit
  cut by a boolean and the knight's head an extruded profile thinned toward the snout. The set's pieces
  face the camera's side so a knight shows its profile.
- glTF PBR as authored - sheen on felt and baize, clearcoat on lacquer, chips, pawns and card stock -
  from `lib/looks.py`; the loader keeps every material except the decals.
- Shadows are BAKED, three decals per game: a floor pool graded to exactly `#0B1220` at its edge, and
  contact shadows on the plinth and the playing surface from a shadowed render divided by an open one
  (Cycles' shadow catcher came back empty under emissive panels). A `decal-*` material is drawn unlit,
  transparent, without writing depth and without tone mapping.
- **Nothing may be coplanar.** Cycles resolves two faces at one height one way and a depth buffer the
  other: the backgammon field sat exactly at the walnut board's top and rendered as walnut, and the
  contact decal sat at the lowest cards' height and drew black squares over them. Decals sit 0.1 mm
  above their surface and everything standing on it sits higher.
- `merge()` joins static meshes by material set and repeated pieces are `EXT_mesh_gpu_instancing`:
  83 draw calls. `inspect.mjs` gates each GLB - 2.5 MiB / 1.0 MiB, 40k unique and 120k drawn triangles,
  90 draw calls, the extension allow-list, root names equal to the `GAMES` ids, three decals per game.
  With five sets it reads 38,360 unique and 108,096 drawn triangles. The phone's playing-surface
  shadows are 384 px (512 the rest of its bakes): the fifth set put the phone cut 54 KB over its
  1.0 MiB, the surface decals were its largest images, and a soft contact shadow at 384 px still
  resolves a piece's footprint to about 27 px.
- Every vignette renders a Cycles preview into `tools/blender/out/` (git-ignored) with `NURA_PREVIEW=1`,
  because modelling from a script means never seeing the model otherwise. Judge the runtime, though:
  materials were tuned in the browser against `NeutralToneMapping` and written back into `looks.py`.
- `surfaces.py` renders the app's table cloths and is NOT part of the showcase; do not re-run it to
  touch the landing.
- **The settle clips are keyframed in the vignettes** (`lib/settle.py`: `drop` for a fall, a bounce and
  a rest) and the scene is set to their LAST frame before the bakes and the export. A settling piece is
  kept out of `merge()`, and a mesh it shares with instanced pieces is copied first, so the piece is a
  node of its own. The piece lands level and turns only about its vertical axis; the wobble is on the
  bounce, in the air, because a die tilted at resting height puts a corner through the board.
- **A settling piece casts no shadow into the shared decals**, because it is hidden until its drop and
  the board would show its shadow with nothing standing in it. Each one resting on the playing surface
  bakes a small footprint of its own (`decal-footprint-<piece>`, feathered at the edge) that scales in over
  the last three frames of the fall, so the shadow arrives with the piece. The poker chip lands on a stack
  rather than on the felt and has none. The chess knight is set down as a hand sets it: a little tilted
  and turning in the air, level when it lands.
- **Blender's glTF exporter points animation channels at the wrong nodes when
  `EXT_mesh_gpu_instancing` is on**: each channel's node index is off by the number of nodes the
  instancing collapsed, so the first build animated three unrelated props and dropped the poker clip
  entirely. `settle.retarget` rewrites every channel by its owner's name after the export and fails the
  build on a clip it cannot place, or on one that was not exported at all.

**Blender MCP** is installed (`.mcp.json`) for interactive authoring. It needs Blender open with
the addon connected (`N` → BlenderMCP → Connect) and cannot run headless. Anything arrived at
interactively must be written back into a script; the scripts stay the source of truth.
