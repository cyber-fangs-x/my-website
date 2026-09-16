// three@0.185.1 ships zero .d.ts files anywhere in the package — not for the
// classic "three" entry point, not for three/addons, and not for the
// three/webgpu and three/tsl subpaths this whole project is built on
// (WebGPURenderer, *NodeMaterial, TSL's Fn()/uniform()/color()/... node
// graph). @types/three (DefinitelyTyped) wouldn't help either: it targets
// the "three" import path, not "three/webgpu"/"three/tsl", and doesn't model
// the TSL node-graph API at all.
//
// Rather than hand-write and maintain real types against a fast-moving,
// still-stabilizing API surface, these are deliberate `any`-shims: a bodyless
// `declare module "x"` makes everything imported from "x" (default, named,
// or `import * as` namespace) resolve to `any`. Every import from these
// subpaths type-checks (so the *rest* of this project's code — Engine's
// options objects, utils/ function signatures, etc. — still gets full
// `strict` checking), but three's own API surface itself isn't modeled and
// isn't checked. Revisit/delete this file once three.js ships its own
// declarations for these entry points.
declare module "three/webgpu";
declare module "three/tsl";
declare module "three/addons/*";
