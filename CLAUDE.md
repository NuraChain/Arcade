# Nura Games — working notes for Claude Code

A cinematic 3D landing experience for a social gaming platform. One npm workspace, `application/`,
plus `tools/blender/` which is where the 3D assets come from. Everything below is drawn from the
repository as it stands — if a rule here disagrees with the code, the code is right and this file
needs fixing.

## Commands

```sh
npm run dev            # vite on 3100
npm run check          # azeroth-tsc + eslint — the gate
npm run build          # client bundle, SSR bundle, prerender
npm test               # every suite
npm run test:shuffle   # every suite in random order — the isolation gate
npm run assets         # rebuild the GLB kit from tools/blender (needs Blender 5.2)
```

`npm run check`, `npm test` and `npm run test:shuffle` must all pass before a change is done.

## House rules

**No comments in code.** Names and structure carry the meaning. This file, and the tests, are
where reasoning is written down.

Allman braces, 4-space indent, single quotes, no trailing comma, LF endings. All of it is
enforced by `eslint.config.ts` — `npm run check` will tell you.

## The framework is local

`azerothjs` and every `@azerothjs/*` package is consumed from `../../AzerothJS` through `file:`
specs, which npm installs as Windows junctions.

- **`AzerothJS` must be built** (`npm run build` there) before anything here resolves — every
  package's `exports` points at `dist/`, and npm does not run `prepare` for a linked directory.
  Rebuild it after any framework edit.
- **`npm ls azerothjs` must show exactly one node.** Two copies of the runtime means two
  independent signal graphs: effects stop firing, `onCleanup` never runs, and nothing throws.
  `vite.config.ts` carries `resolve.dedupe` for this reason, and `preserveSymlinks` must stay off.
- TypeScript is pinned to `^6.0.3`. typescript@7 ships the native CLI without the JS compiler API
  that the language server needs.

## Frontend architecture

**AzerothJS — not React.** `.azeroth` single-file components, signals (`state`, `derived`,
`effect`), `<Show>` and `<For>`. There are no hooks, no VDOM, no JSX runtime.

```
application/src/
  world/            THE 3D MARKET. Zero AzerothJS imports.
    world.ts          lifecycle: build, run, dispose
    bridge.ts         the only UI <-> 3D contract
    camera/           path.ts (pure maths) · shots.ts (the shot list) · rig.ts (damping)
    quality/          tiers.ts (capability probe) · governor.ts (runtime downgrade)
    scene/            market.ts · lamps.ts · atmosphere.ts · procedural.ts · textures.ts
    render/materials.ts   five shared material families
    assets/loader.ts      GLB load + material remap
  components/world/ the ONE component that touches three.js
  sections/         one component per cinematic scene
  data/games.ts     the catalogue — read by the DOM roster AND by the 3D market
  stores/           theme · locale · focus · scroll
  styles/tokens.css every colour, font and motion value
```

**`world/` importing nothing from AzerothJS is load-bearing.** It is what lets the camera maths,
tier selection and governor hysteresis be unit-tested with no GPU, and it keeps three.js out of
the page's bundle — the world is a dynamic import inside `mount { }`, so it never reaches the
prerenderer and never blocks first paint.

## The fallback is the default state

The landing route is `render: 'static'`. Every heading, blurb and CTA is in the prerendered HTML.
The canvas lives behind `<Show when={ ready }>`, and `ready` flips inside `mount` — after
hydration has adopted the server's markup.

If WebGL is missing, the kit fails to load, or the device cannot cope, `ready` never flips and the
page stays exactly as it prerendered. Nobody has to remember to write a fallback branch.

## Design system

Tailwind v4, CSS-first. **There is no `tailwind.config.js` and none should be created.**

Two themes, `[data-theme='dark']` (Dusk, the default) and `[data-theme='light']` (Dawn). Surfaces
`void → field → raised`, borders `line`, text `text → muted → faint`, accent `lamp`.

`madder` is **functional**: it means a table is playing for something. It is never decoration.

The `--world-*` tokens in `tokens.css` are read by the WebGL layer at runtime, so the market and
the page take their palette from one file and the theme switch relights the scene.

## The 3D asset kit

`tools/blender/assets/*.py` are the source of truth. `npm run assets` runs Blender headless and
writes GLBs into `application/public/world/`. **The GLBs are committed**, so `npm run build` and CI
never need Blender.

- Stylised realism at real dimensions, smooth-shaded, bevelled with `kit.finish` (Bevel +
  Weighted Normal, applied through `meshes.new_from_object`) and lathed with `kit.lathe` /
  `kit.sweep`. Vertex colour carries tint and baked contact AO (`kit.bake_ao`, Cycles).
- Two shared textures live outside the GLBs: `atlas-2048.webp` (`lib/atlas.py`: cards, chips,
  dice, Ludo field, score sheet — drawn with numpy SDFs + `blf`) and the tileable walnut pair
  `wood-512.webp` / `wood-normal-512.webp` (`lib/wood.py`). The `print` and `wood` families are
  `Image × Color Attribute → Base Color` through a Mix node with **Factor exactly 1.0**, or the
  exporter drops COLOR_0 and the mesh renders black under `vertexColors`. `kit.export` swaps the
  images for an 8×8 stub so nothing is embedded; three loads the atlas with `flipY = false`.
- Thirteen material families by name; the loader swaps every GLB material for one shared
  instance. Avatars are three metaball figures (`lib/figure.py`) instanced per variant; the
  `Shirt` mesh is the only one tinted per instance.
- Seats come from `seatAround()` in `data/games.ts`: a circle for round tables, a rail-normal
  offset for the poker oval. Tables and sets both get `rotation.y = -game.rotation`; a figure
  built facing Blender +Y faces three −Z, so its yaw is `π/2 − facing`.
- **Paint after every geometry op.** Faces created after `paint` have no colour and render white.
- Budgets are enforced by `build.mjs`. `node tools/blender/inspect.mjs --colours` reports
  triangles, attributes, embedded images and the linear value each palette entry converts to.
- Every set script renders Cycles previews into `tools/blender/out/` (git-ignored) from the
  landing-page dolly distance — modelling from a script means never seeing the model otherwise.

**Blender MCP** is installed (`.mcp.json`) for interactive authoring. It needs Blender open with
the addon connected (`N` → BlenderMCP → Connect) and cannot run headless. Anything arrived at
interactively must be written back into a script; the scripts stay the source of truth.

## Performance

| | budget | actual |
|---|---|---|
| initial JS, gzip | < 60 KB | 40.4 KB |
| three.js chunk | lazy | 160.9 KB gzip, after first paint |
| GLB kit + textures | < 4.5 MB | see `npm run assets` |
| kit triangles | — | ~190k, ~20% of it instanced figures |

Three quality tiers picked from a capability probe, then policed by a frame-time governor that
only ever steps **down**. Most lamps are not lights: they are emissive geometry plus an additive
sprite and a painted light pool, which is why a market of lit tables affords at most four real
point lights.

## RTL

English and Persian. **Logical properties only** — `ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`,
`border-s`/`border-e`. Every seat count wears `tally` so a range cannot reverse inside a mirrored
line. The 3D world does not mirror; the UI over it does.

Locale is switched client-side and remembered in storage, not carried in the url, because
AzerothJS prefix routing is recorded as broken in the framework's own `framework-bugs.md`.

## Verification

`npm run check` · `npm test` · `npm run test:shuffle` · `npm run build`, then a browser pass:
three viewports × two directions, console clean, and the disposal check — repeatedly create and
dispose the world and confirm no "Too many active WebGL contexts" warning appears. That leak has
happened twice already: once from an unreleased capability-probe context, once because
`renderer.dispose()` alone does not free the GL context (`forceContextLoss()` does).
