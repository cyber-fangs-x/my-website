# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal portfolio/graphics-demo site ("cyber-fang" — Visual Computing Developer) built as a
static multi-page site with Vite, using Three.js WebGPU + TSL (Three.js Shading Language) for
interactive 3D scenes embedded directly in the pages.

## Commands

- `npm run dev` — start the Vite dev server (`server.host: true`, so it's reachable on the LAN too).
- `npm run build` — production build via Vite, output to `dist/`.
- There is no lint or test setup (`npm test` is a placeholder that exits with an error).

Deployment is automatic: `.github/workflows/deploy.yaml` runs `npm ci` + `npm run build` and
publishes `dist/` to GitHub Pages on every push to `main`. `vite.config.js` sets
`base: '/my-website/'` to match the Pages subpath — keep that in sync with the repo name if it
ever changes.

## Architecture

**Multi-page app, explicit Rollup inputs.** This is not a JS framework SPA — each top-level page
is its own static `.html` file (`index.html`, `about.html`, `contact.html`, `projects.html`,
`projects/project-1.html`) with its own `<script type="module">` tags. Every new page must be
added to `rollupOptions.input` in `vite.config.js` or Vite won't build/bundle it. Pages nested
under `projects/` use `../`-relative paths back to shared assets (`style.css`, `background.js`,
`imgs/`).

**Scene files are page-level entry points, not a shared engine.** `background.js`, `torus_demo.js`,
and `cube.js` are independent `async function init(); init();` modules, each one grabbing its own
DOM container by id (e.g. `#cube-container`) and driving a self-contained WebGPURenderer + scene +
render loop. A page includes whichever scene scripts it wants via `<script type="module"
src="...">` tags in `<head>`; there's no central scene registry or app shell. (A shared single-
renderer/scissor-viewport engine — one `WebGPURenderer`, per-view GPU scissor/viewport, a
`utils/engine.js` — was tried and reverted in a session that never got committed. It kept hitting
real bugs (a WebGPU-vs-WebGL scissor Y-origin difference, `THREE.RenderPipeline`'s `pass()` always
sizing its offscreen target to the full canvas regardless of the calling view's viewport, a
`DOMContentLoaded` timing race from the added async import chain) and a still-unresolved scroll-
time stutter, for a hardware-context-limit problem this site was never actually close to hitting
at 2-3 simultaneous scenes. Not worth the complexity at this site's scale — don't reintroduce it
without a concrete need.)

Each script's own renderer/camera/scene/render-pipeline/resize setup goes through
`utils/engine-utils.js`'s `Engine` class instead of being re-typed per file — see that file for
the full why/how. The shape is `const engine = await new Engine().init(containerId, options);`
followed by whatever's actually unique to that scene (meshes, materials, lights, controls), then
`engine.run(updateFrame)` in place of a hand-written `function animate() {...};
renderer.setAnimationLoop(animate)`. **This is not the reverted shared engine above** — every
script still calls `new Engine()` for itself and gets its own independent
WebGPURenderer/canvas/render loop; only the boilerplate class definition is shared, never a
runtime instance. `options.buildOutputNode(sceneColor, scenePass)` is the seam for a scene with
real post-processing (`background.js`'s bloom); everything else gets a plain pass-through.

**Three.js via WebGPU + TSL, not the classic material/uniform API.** Import from `three/webgpu`
and `three/tsl`. Materials are `*NodeMaterial`s (e.g. `MeshPhysicalNodeMaterial`) configured by
assigning TSL node graphs (built from `Fn`, `uniform`, `color`, `float`, math ops, and builtins
like `positionLocal`/`normalWorld`/`time`) to `*Node` properties (`colorNode`, `roughnessNode`,
`positionNode`, `emissiveNode`, ...) instead of plain numeric/texture values — see `cube.js` for
the fullest example, including a `Fn(() => {...})`-defined fresnel helper reused across material
modes. Post-processing goes through `THREE.RenderPipeline` + `pass(scene, camera)` +
`getTextureNode('output')`, not the older `EffectComposer` pattern (`background.js` layers a
`bloom()` node on top of this) — this wiring now lives inside `Engine` (see above), reached via
`options.buildOutputNode` rather than written out per scene file.

**Shared behavior lives in `utils/`, exported as small single-purpose functions — mostly not
classes.** `Engine` (`utils/engine-utils.js`) is the one deliberate exception: it bundles real
per-instance state (a renderer/camera/scene/pipeline lifecycle that all belong together and live
as long as one scene does), which is what a class is for, unlike the stateless helpers below.
- `utils/engine-utils.js` — `Engine`, described above.
- `utils/arcball-utils.js` — `createArcballControls()` / `enableArcballOnFirstInteraction()`
  implement the site's "auto-spin until the user clicks/taps, then hand off to drag-to-orbit"
  interaction pattern, generic over any camera/canvas/scene triple.
- `utils/gui-utils.js` — `createGUI()` / one function per lil-gui control (e.g.
  `addArcballGizmoToggle()`) for debug/demo panels.

When extending either file, follow the existing convention: one exported function per
feature/control, each documented with a header comment covering both *why* (the design rationale)
and *how* (the implementation mechanics) — see either file for the pattern to match.

**Terminology: "graphics scripts."** When the user says "graphics script(s)," they mean JS files
that instantiate the `Engine` class and implement a graphics algorithm (e.g. from a SIGGRAPH
paper) — `cube.js` and `torus_demo.js` are examples; `background.js` is not, since it's page
chrome rather than an algorithm demo. A request for a new "graphics script" means: copy the shape
of `torus_demo.js` (an `Engine` instance driving a WebGPU scene) and wire it into a page's
`.graphics-container` element.

**Standing controls/GUI preferences for this project** (steered by the user in a prior session):
- Use `ArcballControls`, not `OrbitControls`, for click/tap-to-orbit on any three.js canvas here.
  `OrbitControls` locks to a fixed up-axis and orbits in azimuth/polar, which visibly fights a mesh
  that was auto-spinning on independent Euler angles before the user takes over (reads as unwanted
  "roll" once control hands off from an arbitrary tumbled pose). `ArcballControls` is a
  quaternion-based virtual trackball with no fixed up-axis, so it handles an arbitrary starting
  orientation cleanly, and it ships its own toggleable gizmo rings
  (`controls.setGizmosVisible()`).
- Give a `lil-gui` panel its own dedicated container element in the page's normal layout (via
  lil-gui's `container` constructor option) rather than letting it default to a fixed overlay on
  `document.body` — see `#cube-gui-container` sitting beside `#cube-container` in `index.html` /
  `projects/project-1.html` for the pattern.

**Theming.** `<body data-theme-color="purple|blue|green|red">` selects an accent color;
`background.js` reads that attribute on `DOMContentLoaded`, brightens the base hex via
`adjustColorCSS()`, and sets it as the `--primary-color` CSS custom property consumed by
`style.css`. The same attribute also picks the grid color for the animated WebGPU background
scene (`THIS_COLOR`).

**`scraps/`** holds retired/reference page markup (`og_projects.html`, `original.html`,
`otto_ex.html`) kept for reference — not wired into the Vite build.
