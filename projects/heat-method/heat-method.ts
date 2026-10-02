import * as THREE from "three/webgpu"
import { attribute, color, float, mix, smoothstep, uniform, Fn, cos, clamp, abs, exp,
    fract, fwidth, min, uniformArray, Loop, If, positionLocal, positionWorld, length, vec4, output } from "three/tsl"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { Engine } from "../../utils/engine-utils.js"
import { createArcballControls } from "../../utils/arcball-utils.js"
import { loadObjAsset, loadLinearAlgebraLib, loadHeatMethodLib } from "../../utils/asset-loader.js"
import { initializeRadioGroup } from "../../utils/controls-utils.js"
import { createColormap, gradientColormap, viridisColormap } from "../../utils/colormap-utils.js"

const MESH_PATH = 'assets/cat.obj';
// Heated metal: dark silver at rest, then through the colors steel glows as
// it heats up: dull red, bright red, orange, and yellow at the source. The
// silver -> red step passes through a dark brownish red, like the temper
// colors on real heated steel.
const HEATED_METAL = gradientColormap([
    [0.0, 0x5a5e64],   // dark silver (cold)
    [0.25, 0x7a1a0c],  // dull red
    [0.5, 0xd8300c],   // red
    [0.75, 0xff8a1a],  // orange
    [1.0, 0xffe36b],   // yellow (hottest)
]);
// One colormap texture shared by every mode: cold end = resting color, hot
// end = at the heat source. The Control Panel's colormap radios swap it live.
const { colormap, setColormap } = createColormap(HEATED_METAL);
const WAVE_DURATION = 5; // seconds for the wavefront to cross the whole mesh
const TAP_THRESHOLD_PX = 6; // pointerdown->pointerup movement below this counts as a tap, not a drag
// Same bright studio gray as minimal-surface.ts, so the cat reads against
// the background instead of disappearing into black.
const BACKGROUND_COLOR = 0x6d7582;
// Ground disc, same as minimal-surface.ts's: a step darker than the
// background, fading into it toward the rim. loadObjAsset() normalizes the
// cat into the unit sphere, so y = -1 sits just below it.
const FLOOR_COLOR = 0x202327;
const FLOOR_Y = -1.0;
// The fade is complete before the geometry ends, so orbiting never shows an edge.
const FLOOR_RADIUS = 12.5;
const FLOOR_FADE_START = 8;
const FLOOR_FADE_END = 12;

async function init() {
    const engine = await new Engine().init('heat-method-container', {
        cameraPosition: [0, 0, 1.6],
        backgroundColor: BACKGROUND_COLOR,
    });
    const { renderer, camera, scene } = engine;

    // Lighting — minimal-surface.ts's rig: an even hemisphere light plus a
    // baked environment map, no directional key light. The cat is fully
    // metallic (metalnessNode = 1 below), and a metal has no diffuse term:
    // everything it shows is reflected, so with no environment it reflects
    // black. The RoomEnvironment's light panels give it something to mirror,
    // tinted by the colormap colorNode. This only affects lighting; the
    // visible background stays solid gray.
    const sky_light = new THREE.HemisphereLight(0xffffff, 0x8d8a85, 0.5);
    scene.add(sky_light);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();

    // Not hit by tap-to-pick: pickSourceVertex() raycasts only the cat.
    scene.add(createFloor());

    // Load the mesh — gpMesh/gpGeometry are the vendored halfedge structures
    // the heat method actually runs on; threeMesh is what gets rendered,
    // kept vertex-index-aligned with them by loadObjAsset.
    const { threeMesh, gpMesh, gpGeometry } = await loadObjAsset(MESH_PATH);

    // heatMethod solves for per-vertex geodesic distance from a source
    // vertex (see notes/heat-method-blueprint.tex for the full derivation).
    // memoryManager is required by the vendored DenseMatrix/SparseMatrix
    // classes to track and later free their WASM-heap-backed data — the
    // calling script's job, per loadLinearAlgebraLib()'s own doc comment.
    const { DenseMatrix, EmscriptenMemoryManager } = await loadLinearAlgebraLib();
    const { HeatMethod } = await loadHeatMethodLib();
    (window as any).memoryManager = new EmscriptenMemoryManager();
    const heatMethod = new HeatMethod(gpGeometry);
    const vertexCount = gpMesh.vertices.length;

    // V2 Wavefront
    const distances = new Float32Array(vertexCount).fill(1e4);
    const distanceAttribute = new THREE.BufferAttribute(distances, 1);
    threeMesh.geometry.setAttribute('geodesicDist', distanceAttribute);
    const { waveProgress, waveMaxDistance, waveGlowNode } = createHeatFlowMaterialRing();
    const { simulationTime, modularHeatNode } = createHeatFlowMaterialDiffuse();
    const { isolineNode, setSourceDots } = createHeatFlowMaterialIsolines(waveMaxDistance, threeMesh.geometry.attributes.position);
    const material = new THREE.MeshStandardNodeMaterial();
    // colorNode is set by the mode radio group below (its HTML-checked option).
    material.roughnessNode = float(0.1);
    material.metalnessNode = float(1.0);
    threeMesh.material = material;
    
    scene.add(threeMesh);

    // V2 Wavefront - Animation
    let sendWave = false;
    let animationStartTime = 0;

    // Heat sources. Ring/Diffusion hold one at a time; Isolines keeps every
    // tapped vertex (accumulateSources), like the original geodesic-distance
    // demo. selectedSource is the newest one, drawn as the orange dot.
    const sources = new Set<number>();
    let selectedSource: number | null = null;
    let accumulateSources = false;

    function diffuseFrom(sourceIndices: Iterable<number>) {
        const delta = DenseMatrix.zeros(vertexCount, 1);
        for (const i of sourceIndices) delta.set(1, i, 0);
        const phi = heatMethod.compute(delta);

        let maxDistance = 0;
        for (let i = 0; i < vertexCount; i++) {
            const d = phi.get(i, 0);
            distances[i] = d;
            if (d > maxDistance) maxDistance = d;
        }
        waveMaxDistance.value = maxDistance;
        waveProgress.value = 0.0;
        simulationTime.value = 0.01;
        distanceAttribute.needsUpdate = true;
        animationStartTime = performance.now();
        
        if (!sendWave) {
            sendWave = true;
            animationStartTime = performance.now();
        }

        // Free delta/phi/Cholesky-factorization intermediates from the WASM
        // heap; heatMethod.A/F must survive to the next click.
        (window as any).memoryManager.deleteExcept([heatMethod.A, heatMethod.F]);
    }

    function animateWave() {
        if (!sendWave) return;

        const currentTime = performance.now();
        const elapsed = (currentTime - animationStartTime) / 1000;
        const progress = Math.min(elapsed / WAVE_DURATION, 1);
        waveProgress.value = progress;


        simulationTime.value = elapsed;

        if (waveProgress.value >= 1.0) { 
            sendWave = false; // Stop the wave after it completes
        }
    }

    // Stops any running wave and pushes every vertex "infinitely" far from a
    // source, so every mode falls back to the colormap's cold end until the
    // next tap picks a new source.
    function stopWave() {
        sendWave = false;
        distances.fill(1e4);
        distanceAttribute.needsUpdate = true;
    }

    // Mode switcher — the Control Panel's radio group (see index.html). The
    // HTML-checked option's onSelect runs at init to set the starting
    // colorNode. needsUpdate forces a shader rebuild: WebGPURenderer compiles
    // the node graph into a cached pipeline and won't see a swapped colorNode
    // otherwise.
    initializeRadioGroup(document.getElementById('heat-mode-radios'), {
        ring: {
            onSelect: () => { material.colorNode = waveGlowNode(); material.needsUpdate = true; },
            onDeselect: () => { stopWave(); waveProgress.value = 0.0; },
        },
        diffuse: {
            onSelect: () => { material.colorNode = modularHeatNode(); material.needsUpdate = true; },
            onDeselect: () => { stopWave(); simulationTime.value = 0.01; },
        },
        isolines: {
            // Clearing here keeps a leftover Ring/Diffusion source from
            // silently becoming the first isolines source.
            onSelect: () => {
                accumulateSources = true;
                sources.clear();
                setSourceDots(sources, null);
                material.colorNode = isolineNode();
                material.needsUpdate = true;
            },
            onDeselect: () => { accumulateSources = false; stopWave(); },
        },
    });

    // Colormap switcher: rewrites the shared colormap texture in place, so
    // unlike the mode switch above there's no colorNode swap or shader rebuild.
    initializeRadioGroup(document.getElementById('colormap-radios'), {
        heatedMetal: { onSelect: () => setColormap(HEATED_METAL) },
        viridis: { onSelect: () => setColormap(viridisColormap) },
    });

    // pickSourceVertex(event): raycasts the pointer into the mesh and
    // returns whichever corner of the hit triangle is closest to the hit
    // point. That corner's index is already the correct row into
    // delta/heatMethod, since loadObjAsset keeps THREE.Mesh vertex indices
    // aligned with gpMesh.vertices.
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    function pickSourceVertex(event: PointerEvent): number | null {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointerNdc, camera);

        const [hit] = raycaster.intersectObject(threeMesh);
        if (!hit || !hit.face) return null;

        const position = threeMesh.geometry.attributes.position;
        let closest = hit.face.a;
        let closestDist = Infinity;
        for (const i of [hit.face.a, hit.face.b, hit.face.c]) {
            const dx = position.getX(i) - hit.point.x;
            const dy = position.getY(i) - hit.point.y;
            const dz = position.getZ(i) - hit.point.z;
            const dist = dx * dx + dy * dy + dz * dz;
            if (dist < closestDist) { closestDist = dist; closest = i; }
        }
        return closest;
    }

    // A tap (small pointerdown->pointerup movement) picks a new source; a
    // drag orbits the camera instead and shouldn't restart the diffusion.
    let pointerDownAt: { x: number; y: number } | null = null;
    renderer.domElement.addEventListener('pointerdown', (event: PointerEvent) => {
        pointerDownAt = { x: event.clientX, y: event.clientY };
    });
    renderer.domElement.addEventListener('pointerup', (event: PointerEvent) => {
        if (!pointerDownAt) return;
        const moved = Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y);
        pointerDownAt = null;
        if (moved > TAP_THRESHOLD_PX) return;

        const vertexIndex = pickSourceVertex(event);
        if (vertexIndex === null) return;

        // Ring/Diffusion replace the source on each tap. Isolines keeps every
        // tapped source, and shift-tap removes one, like the original demo.
        if (!accumulateSources) sources.clear();
        if (accumulateSources && event.shiftKey) {
            sources.delete(vertexIndex);
            if (selectedSource === vertexIndex) selectedSource = null;
        } else {
            sources.add(vertexIndex);
            selectedSource = vertexIndex;
        }
        setSourceDots(sources, selectedSource);
        if (sources.size > 0) diffuseFrom(sources); else stopWave();
    });

    // Arcball drag-to-orbit — always on for this demo (see CLAUDE.md's
    // standing controls preference for why ArcballControls over
    // OrbitControls). min/maxDistance sized for the cat's unit bounding
    // radius (loadObjAsset normalizes positions to it by default).
    const controls = createArcballControls(camera, renderer.domElement, scene, {
        minDistance: 1.3,
        maxDistance: 8,
        enabled: true,
    });

    // Animation loop: drive the camera, and while a wave is active, grow
    // waveRadius from 0 up to the source's farthest distance over
    // WAVE_DURATION seconds.
    engine.run(() => {
        if (controls.enabled) controls.update();
        animateWave();
    });
}

// A gray ground disc under the cat — a copy of minimal-surface.ts's
// createFloor(). The rim fades into the background in outputNode: `output`
// is the fully lit floor color, and mixing it toward BACKGROUND_COLOR (both
// in linear working space, like scene.background) makes the horizon
// seamless at any zoom.
function createFloor() {
    const geometry = new THREE.CircleGeometry(FLOOR_RADIUS, 64);
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.MeshStandardNodeMaterial({
        color: FLOOR_COLOR,
        roughness: 0.9,
        metalness: 0.0,
    });
    const fade = smoothstep(FLOOR_FADE_START, FLOOR_FADE_END, length(positionWorld.xz));
    material.outputNode = vec4(mix(output.rgb, color(BACKGROUND_COLOR), fade), output.a);

    const floor = new THREE.Mesh(geometry, material);
    floor.position.y = FLOOR_Y;
    return floor;
}

function createHeatFlowMaterialRing() {
    // 1. Create uniforms to pass our animation progress (0.0 to 1.0) into the GPU
    const waveProgress = uniform(0.0);
    // This will be set to the farthest distance from the source vertex
    const waveMaxDistance = uniform(1.0); 

    // Define configuration constants mirroring your array math
    const WAVE_LENGTH = 0.1; // Wavelength in world units

    // Define total distance boundaries for the center to travel
    const startPos = -WAVE_LENGTH / 2;

    // 2. Build the GPU Wave Node using TSL
    const waveGlowNode = Fn(() => {
    // 1. Calculate wave center based on progress
    const endPos = waveMaxDistance.add(WAVE_LENGTH / 2);
    const waveCenter = waveProgress.mul(endPos.sub(startPos)).add(startPos);
    
    // Use the CPU-calculated distance attribute from the heat method
    const vertexGeodesicDistance = attribute('geodesicDist', 'float');
    const distance = vertexGeodesicDistance.sub(waveCenter);

    // 2. Normalize and create the cosine wave
    const normalizedDistance = distance.div(WAVE_LENGTH / 2);
    const waveIntensity = cos(normalizedDistance.mul(Math.PI)).add(1.0).div(2.0);
    
    // 3. Mask to only the active wave area
    const isInsideWave = abs(normalizedDistance).lessThan(1.0);
    const finalIntensity = isInsideWave.select(waveIntensity, 0.0);
    
    // 4. Clean cutoff at the end of the animation
    const clippedIntensity = clamp(finalIntensity, 0.0, 1.0).mul(waveProgress.lessThan(1.0).select(1.0, 0.0));

    // 5. Color: no wave = the colormap's cold end, wave crest = its hot end
    return colormap(clippedIntensity);
    });

    return { waveProgress, waveMaxDistance, waveGlowNode };
}

function createHeatFlowMaterialDiffuse() {
    // --- 1. Structural Uniforms ---
    // Instead of separate wave and cooling progress, we use a single physical time parameter.
    // Animate `simulationTime` starting from a tiny fraction (e.g., 0.01) up to your max duration (e.g., 5.0)
    const simulationTime = uniform(0.01); 
    
    // alpha controls how fast the heat diffuses through the material (distance^2 / time)
    // silver = 0.000174, copper = 0.000117, aluminum = 0.000097
    const thermalDiffusivity = uniform(0.005); 
    // controls the starting brightness/energy of the heat burst
    const initialEnergy = uniform(0.02); 

    const modularHeatNode = Fn(() => {
        const dist = attribute('geodesicDist', 'float');

        // --- 2. The Heat Equation (Gaussian Diffusion) ---
        // Variance (how wide the heat has spread) = 4 * alpha * t
        const spread = thermalDiffusivity.mul(simulationTime).mul(4.0);

        // Amplitude (how hot the center is) decays as heat spreads out: A = energy / spread
        const amplitude = initialEnergy.div(spread);

        // Gaussian exponent: -(d^2) / spread
        const distSq = dist.mul(dist);
        // We use negate() to make it negative distance squared
        const exponent = distSq.div(spread).negate(); 

        // Calculate exact physical temperature: T = A * e^(-d^2 / spread)
        const temperature = amplitude.mul(exp(exponent));

        // --- 3. Color ---
        // colormap() clamps its input, so temperatures above 1 saturate at
        // the hot end.
        return colormap(temperature);
    });

    return { simulationTime, modularHeatNode };
}

// Port of geometry-processing-js's geodesic-distance demo (public/lib/
// geometry-processing-js-master/projects/geodesic-distance/index.html).
//
// Why: the original needs four CPU-side mechanisms for this: a Map of sphere
// meshes added to/removed from the scene, a persistent delta matrix, edge-
// marching that rebuilds a LineSegments mesh on every click, and colormap.js's
// 512-row lookup table. All of the visible output is a function of data this
// script already has on the GPU (the geodesicDist attribute and waveMaxDistance),
// plus the list of source positions, so all of it lives in one colorNode here.
// Swapping colorNode away hides the lines and dots too, with no scene bookkeeping.
//
// How:
//   1. Colors: the shared colormap, hot end at the sources (the original's
//      reversed colormap(maxPhi - phi, ...)).
//   2. Isolines: the rasterizer interpolates geodesicDist linearly across each
//      triangle, the same linear function the original's edge-lerp solves on,
//      so its level sets are the same segments. fract() finds them and
//      fwidth() keeps them ~1px wide at any zoom.
//   3. Dots: painted where the fragment is within the original sphere radius
//      of a source position (a uniformArray, filled by setSourceDots()).
// The original's other hard-coded choices (20 lines, black lines, dot size
// and colors) are kept as-is below.
function createHeatFlowMaterialIsolines(maxDistance: any, position: any) {
    const ISOLINE_COUNT = 20;                     // distBetweenLines = maxPhi / 20
    const LINE_COLOR = color(0x000000);
    const SELECTED_DOT_COLOR = color(0x000000);   // newest source
    const OTHER_DOT_COLOR = color(0x000000);
    const DOT_RADIUS = 0.015;                     // SphereGeometry(0.015)
    const MAX_SOURCES = 32;                       // new: uniformArray needs a fixed size

    const sourcePositions = uniformArray(Array.from({ length: MAX_SOURCES }, () => new THREE.Vector3()), 'vec3');
    const sourceCount = uniform(0, 'int');
    const selectedIndex = uniform(-1, 'int');     // -1 = none (original: selectedVertex = undefined)

    const isolineNode = Fn(() => {
        const dist = attribute('geodesicDist', 'float');

        // 1. Colormap, hot end at the sources: colormap(maxPhi - phi, 0, maxPhi, ...)
        const x = float(1.0).sub(dist.div(maxDistance)).clamp();
        const heat = colormap(x);

        // 2. Isolines: level k sits where t == k. min(fract, 1 - fract) is the
        // distance to the nearest level in bands; dividing by fwidth(t) (how
        // much t changes per pixel) turns that into pixels. Levels 0 (the
        // source point) and 20 (the farthest vertex) are skipped, as in the original.
        const t = dist.div(maxDistance).mul(ISOLINE_COUNT);
        const pixelsToLine = min(fract(t), fract(t).oneMinus()).div(fwidth(t));
        const inRange = t.greaterThan(0.5).and(t.lessThan(ISOLINE_COUNT - 0.5));
        const onLine = inRange.select(smoothstep(0.0, 1.0, pixelsToLine).oneMinus(), 0.0);
        const surfaceColor = mix(heat, LINE_COLOR, onLine).toVar();

        // 3. Source dots: newest orange, the rest yellow.
        Loop(sourceCount, ({ i }: any) => {
            If(positionLocal.distance(sourcePositions.element(i)).lessThan(DOT_RADIUS), () => {
                surfaceColor.assign(i.equal(selectedIndex).select(SELECTED_DOT_COLOR, OTHER_DOT_COLOR));
            });
        });

        // No sources: plain cold end. stopWave()'s 1e4 fill puts x at 0, so
        // heat already is the cold end; it also makes the line math above
        // NaN, but select() never returns that branch here.
        return sourceCount.equal(0).select(heat, surfaceColor);
    });

    // Copies the source set into the uniforms the dots read. Sources past
    // MAX_SOURCES still count toward the distance; only their dots are dropped.
    function setSourceDots(sources: Iterable<number>, selected: number | null) {
        let n = 0;
        selectedIndex.value = -1;
        for (const v of sources) {
            if (n === MAX_SOURCES) break;
            if (v === selected) selectedIndex.value = n;
            sourcePositions.array[n++].fromBufferAttribute(position, v);
        }
        sourceCount.value = n;
    }

    return { isolineNode, setSourceDots };
}



init();
