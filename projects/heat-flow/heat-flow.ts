import * as THREE from "three/webgpu"
import { attribute, color, float, mix, smoothstep, vec3, uniform, Fn, cos, clamp, abs } from "three/tsl"
import { Engine } from "../../utils/engine-utils.js"
import { createArcballControls } from "../../utils/arcball-utils.js"
import { loadObjAsset, loadLinearAlgebraLib, loadHeatMethodLib } from "../../utils/asset-loader.js"

const CYAN = 0x00e5ff;
const MAGENTA = 0xff00e5;
const BASE_COLOR = color(0x00e5ff); // Cyan
const FIRE_COLOR_1 = color(0xff0000); // Red
const FIRE_COLOR_2 = color(0xffff00); // Yellow
const FIRE_COLOR_3 = color(MAGENTA); // White
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

    const fill_light = new THREE.HemisphereLight(0xffffff, 0x222233, 0.6);
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
    const { waveProgress, waveMaxDistance, waveGlowNode } = createHeatFlowMaterial();
    //const { waveProgress, modularHeatNode, coolingProgress } = createHeatFlowMaterial2();
    const material = new THREE.MeshStandardNodeMaterial();
    material.colorNode = waveGlowNode();
    //material.colorNode = modularHeatNode();
    material.roughnessNode = float(0.6);
    material.metalnessNode = float(0.0);
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
        // UNCOMMENT THIS LINE TO ENABLE MAX DISTANCE CONTROL
        // TODO: Fix starting over somewhere else
        waveMaxDistance.value = maxDistance;
        waveProgress.value = 0.0;
        //coolingProgress.value = 0.0;
        distanceAttribute.needsUpdate = true;
        
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
        // const progress = Math.min(elapsed / WAVE_DURATION, 1);
        // waveProgress.value = progress;

        // Goes from 0.0 to 1.0 over WAVE_DURATION
        const wProgress = Math.min(elapsed / WAVE_DURATION, 1.0);
        waveProgress.value = wProgress;
        
        // --- 2. Update Dissipation (coolingProgress) ---
        // Subtract the delay so cooling stays at 0.0 until the delay passes
        const coolingElapsed = Math.max(0, elapsed - COOLING_DELAY);
        const cProgress = Math.min(coolingElapsed / COOLING_DURATION, 1.0);
        // TODO: 
        // coolingProgress.value = cProgress;
        if (waveProgress >= 1.0) { // TODO:  OR CPROGRESS FOR COOLING
            sendWave = false; // Stop the wave after it completes
        }
    }

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




function createHeatFlowMaterial() {
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
    const i3 = clippedIntensity.mul(3.0);
    
    // Zone 1: Blend from Base to Red (when i3 is 0.0 to 1.0)
        const color_0_to_1 = mix(BASE_COLOR, FIRE_COLOR_1, i3);

        // Zone 2: Blend from Red to Yellow (when i3 is 1.0 to 2.0)
        const color_1_to_2 = mix(FIRE_COLOR_1, FIRE_COLOR_2, i3.sub(1.0));

        // Zone 3: Blend from Yellow to White (when i3 is 2.0 to 3.0)
        const color_2_to_3 = mix(FIRE_COLOR_2, FIRE_COLOR_3, i3.sub(2.0));

        // TSL "if/else" logic to pick the correct zone based on the intensity
        const finalColor = i3.lessThan(1.0).select(
            color_0_to_1,                  // IF i3 < 1.0, use the Base->Red mix
            i3.lessThan(2.0).select(       // ELSE
                color_1_to_2,              //   IF i3 < 2.0, use Red->Yellow mix
                color_2_to_3               //   ELSE use Yellow->White mix
            )
        );

        return finalColor;
    });

    return { waveProgress, waveMaxDistance, waveGlowNode };
}

function createHeatFlowMaterial2() {
    // --- 1. Structural Uniforms ---
    const waveProgress = uniform(0.0);
    const maxCoreRadius = uniform(0.1);    // The area that is 100% solid color
    const maxFalloffWidth = uniform(0.5); // How far it takes to fade to zero outside the core
    const coolingProgress = uniform(0.0); // Animate this from 0.0 to 1.0 independently

    const modularHeatNode = Fn(() => {
        const dist = attribute('geodesicDist', 'float');

        // 1. Calculate current sizes based on animation progress
        const currentCore = waveProgress.mul(maxCoreRadius);
        // Add a tiny epsilon (0.001) to prevent a divide-by-zero error on frame 1
        const currentFalloff = waveProgress.mul(maxFalloffWidth).add(0.001); 

        // 2. The New Falloff Math
        // smoothstep(min, max, value) returns 0.0 below min, 1.0 above max, and smoothly blends in between.
        const falloffFactor = smoothstep(
            currentCore, 
            currentCore.add(currentFalloff), 
            dist
        );
        
        // V1 cooling
        // Invert it so 1.0 is the hot center, and 0.0 is the cold outside
        //const intensity = uniform(1.0).sub(falloffFactor);
        // 1. Calculate the spatial heat (1.0 at center, 0.0 at edge)
        // const spatialIntensity = uniform(1.0).sub(falloffFactor);

        // // 2. Calculate the cooling over time
        // // If we just did (1.0 - waveProgress), the heat would fade away before it 
        // // ever fully expanded. Instead, we use smoothstep to delay the cooling.
        // // This means: Stay 100% hot from progress 0.0 to 0.5, 
        // // then gradually fade to 0.0 as progress goes from 0.5 to 1.0.
        // const coolingFactor = smoothstep(1.0, 0.5, waveProgress);

        // // 3. Apply the cooling to the final intensity
        // const intensity = spatialIntensity.mul(coolingFactor);

        // Inside your TSL node
        const spatialIntensity = uniform(1.0).sub(falloffFactor);
        const coolingFactor = uniform(1.0).sub(coolingProgress);
        const intensity = spatialIntensity.mul(coolingFactor);
    
        // --- 3. Modular Color Blending ---
        
       // 1. Scale intensity to 0.0 -> 3.0
        const i3 = intensity.mul(3.0);
        
       // Phase 1: Base to Fire 1 (Outer Edge)
        const factor1 = clamp(i3, 0.0, 1.0);
        const colorStep1 = mix(BASE_COLOR, FIRE_COLOR_1, factor1);
        
        // Phase 2: Fire 1 to Fire 2 (Mid-range)
        const factor2 = clamp(i3.sub(1.0), 0.0, 1.0);
        const colorStep2 = mix(colorStep1, FIRE_COLOR_2, factor2);
        
        // Phase 3: Fire 2 to Fire 3 (Hottest Core)
        const factor3 = clamp(i3.sub(2.0), 0.0, 1.0);
        return mix(colorStep2, FIRE_COLOR_3, factor3);
    });

    return { waveProgress, modularHeatNode, coolingProgress };

}



init();
