import * as THREE from "three/webgpu"
import { attribute, color, float, mix, smoothstep, vec3, uniform, Fn, cos, clamp, abs, exp } from "three/tsl"
import { Engine } from "../../utils/engine-utils.js"
import { createArcballControls } from "../../utils/arcball-utils.js"
import { loadObjAsset, loadLinearAlgebraLib, loadHeatMethodLib } from "../../utils/asset-loader.js"
import { initializeRadioGroup } from "../../utils/controls-utils.js"

const CYAN = 0x00e5ff;
const LIGHT_BLUE = 0xa0f9ff;
const AQUA = 0x5efefc;
const BLUE = 0x23d1f6;
const SEA_BLUE = 0x009fd7;
const DARK_BLUE = 0x0564b8;
const BASE_COLOR = color(CYAN);
const FIRE_COLOR_1 = color(DARK_BLUE);
const FIRE_COLOR_2 = color(BLUE);
const FIRE_COLOR_3 = color(LIGHT_BLUE);
// Example of a dynamic uniform color you could change later:
// const FIRE_COLOR_3 = uniform(new THREE.Color(0xffffff)); // White
const WAVE_DURATION = 5; // seconds for the wavefront to cross the whole mesh
const COOLING_DELAY = 0; // seconds to wait before starting the cooling fade
const COOLING_DURATION = 3; // seconds for the cooling fade to complete
const TAP_THRESHOLD_PX = 6; // pointerdown->pointerup movement below this counts as a tap, not a drag

async function init() {
    const engine = await new Engine().init('heat-flow-container', { cameraPosition: [0, 0, 1.6] });
    const { renderer, camera, scene } = engine;

    // Lighting — cube.js's fill + key rig, reused as-is: a directional key
    // light for real highlights/shaded creases (so the bunny's surface
    // detail reads clearly from any angle), plus a soft hemisphere fill so
    // the shadowed side never goes fully black.
    const key_light = new THREE.DirectionalLight(0xffffff, 2);
    key_light.position.set(3, 4, 5);
    scene.add(key_light);

    const fill_light = new THREE.HemisphereLight(0xffffff, 0x222233, 1.0);
    scene.add(fill_light);

    // Load the mesh — gpMesh/gpGeometry are the vendored halfedge structures
    // the heat method actually runs on; threeMesh is what gets rendered,
    // kept vertex-index-aligned with them by loadObjAsset.
    const { threeMesh, gpMesh, gpGeometry } = await loadObjAsset('assets/bunny.obj');

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
    const material = new THREE.MeshStandardNodeMaterial();
    // colorNode is set by the mode radio group below (its HTML-checked option).
    material.roughnessNode = float(0.6);
    material.metalnessNode = float(0.8);
    threeMesh.material = material;
    
    scene.add(threeMesh);

    // V2 Wavefront - Animation
    let sendWave = false;
    let animationStartTime = 0;

    function diffuseFrom(vertexIndex: number) {
        const delta = DenseMatrix.zeros(vertexCount, 1);
        delta.set(1, vertexIndex, 0);
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
    // source, so both color modes fall back to plain BASE_COLOR until the
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
        if (vertexIndex !== null) diffuseFrom(vertexIndex);
    });

    // Arcball drag-to-orbit — always on for this demo (see CLAUDE.md's
    // standing controls preference for why ArcballControls over
    // OrbitControls). min/maxDistance sized for the bunny's unit bounding
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

    // ---------------------------------------------------------
    // FIRE COLOR MAPPING IN TSL
    // ---------------------------------------------------------
    
    // Multiply intensity by 3 so channels can activate sequentially
    // const i3 = clippedIntensity.mul(3.0);
    
    // // Zone 1: Blend from Base to Red (when i3 is 0.0 to 1.0)
    //     const color_0_to_1 = mix(BASE_COLOR, FIRE_COLOR_1, i3);

    //     // Zone 2: Blend from Red to Yellow (when i3 is 1.0 to 2.0)
    //     const color_1_to_2 = mix(FIRE_COLOR_1, FIRE_COLOR_2, i3.sub(1.0));

    //     // Zone 3: Blend from Yellow to White (when i3 is 2.0 to 3.0)
    //     const color_2_to_3 = mix(FIRE_COLOR_2, FIRE_COLOR_3, i3.sub(2.0));

    //     // TSL "if/else" logic to pick the correct zone based on the intensity
    //     const finalColor = i3.lessThan(1.0).select(
    //         color_0_to_1,                  // IF i3 < 1.0, use the Base->Red mix
    //         i3.lessThan(2.0).select(       // ELSE
    //             color_1_to_2,              //   IF i3 < 2.0, use Red->Yellow mix
    //             color_2_to_3               //   ELSE use Yellow->White mix
    //         )
    //     );

    // FIXED BANDING
        // ---------------------------------------------------------
        // NEW FIRE COLOR MAPPING IN TSL (Smooth, No Branching)
        // ---------------------------------------------------------

        // We keep clippedIntensity in its natural 0.0 -> 1.0 range.
        // Replace the sharp .select() if/else logic with smoothstep overlapping.
        // This creates an S-curve blend that completely eliminates color banding.
        // TODO: Fix comments
        // Zone 1: Base to Red (lower third of the intensity)
        const factor1 = smoothstep(0.0, 0.33, clippedIntensity);
        
        // Zone 2: Red to Yellow (middle third of the intensity)
        const factor2 = smoothstep(0.33, 0.66, clippedIntensity);
        
        // Zone 3: Yellow to White (top third of the intensity)
        const factor3 = smoothstep(0.66, 1.0, clippedIntensity);

        // Cascade the mixes continuously. The GPU processes this linearly without waiting on branches.
        const color_0_to_1 = mix(BASE_COLOR, FIRE_COLOR_1, factor1);
        const color_1_to_2 = mix(color_0_to_1, FIRE_COLOR_2, factor2);
        const finalColor = mix(color_1_to_2, FIRE_COLOR_3, factor3);

        return finalColor;
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
    const thermalDiffusivity = uniform(0.05); 
    // controls the starting brightness/energy of the heat burst
    const initialEnergy = uniform(0.05); 

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

        // --- 3. Modular Smooth Color Blending ---
        // Normalize temperature so we can safely map it to our colors (0.0 to 1.0)
        //const tNorm = clamp(temperature, 0.0, 1.0);
        const tNorm = temperature; // No clamping, let the color mapping handle it

        // Replace sharp clamps with smoothsteps. 
        // smoothstep creates an S-curve, completely eliminating visual color banding.
        const factor1 = smoothstep(0.0, 0.33, tNorm);
        const factor2 = smoothstep(0.33, 0.66, tNorm);
        const factor3 = smoothstep(0.66, 1.0, tNorm);

        const colorStep1 = mix(BASE_COLOR, FIRE_COLOR_1, factor1);
        const colorStep2 = mix(colorStep1, FIRE_COLOR_2, factor2);
        const finalColor = mix(colorStep2, FIRE_COLOR_3, factor3);

        return finalColor;
    });

    return { simulationTime, modularHeatNode };
}



init();
