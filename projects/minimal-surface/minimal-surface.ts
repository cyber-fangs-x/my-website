import * as THREE from "three/webgpu"
import {
    Fn, float, color, vec3, vec4, mix, smoothstep, length,
    positionLocal, positionWorld, time, output, mx_noise_float
} from "three/tsl"
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { Engine } from "../../utils/engine-utils.js"
import { createArcballControls, enableArcballOnFirstInteraction } from "../../utils/arcball-utils.js"
import { initializeButton, setButtonToggled, initializeRadioGroup } from "../../utils/controls-utils.js"
import { loadStlMesh } from "../../utils/asset-loader.js"
import type { FlowVariant, MainToWorkerMessage, WorkerToMainMessage } from "../../utils/worker-header.js"

// Flow time step, shared by both objects' flows — fixed per this project's
// scope (Run/Stop/Reset only, no time-step slider; see notes/geometric-flow-
// blueprint.tex for what this controls). If one object settles too slowly,
// a per-object h on FlowObject is the next knob.
const H = 0.0005;

// Tube spec, from the three.js editor's TubeGeometry panel: a straight
// vertical path, open ends. Length is shortened from the editor's 1.0 to
// 0.6: a catenoid spanning two coaxial rings of radius R a distance d apart
// only exists for d/R <~ 1.3255, so at 1.0/0.5 = 2 the neck would pinch off.
// 0.6/0.5 = 1.2 settles on a catenoid with neck radius ~0.37 instead.
const TUBE_HALF_LENGTH = 0.7;
const TUBE_RADIUS = 0.3;
const TUBE_TUBULAR_SEGMENTS = 32;
const TUBE_RADIAL_SEGMENTS = 32;

// Bright studio staging, so the see-through soap film has something to
// reflect and refract. The floor is a step darker than the background so it
// reads as ground, then fades into the background color toward its rim.
const BACKGROUND_COLOR = 0x6d7582;
const FLOOR_COLOR = 0x202327;
// loadStlMesh() normalizes the bumpy sphere into the unit sphere, so y = -1
// sits below both objects (the tube only spans y = ±TUBE_HALF_LENGTH).
const FLOOR_Y = -1.0;
// The fade is complete before the geometry ends, so orbiting never shows an edge.
const FLOOR_RADIUS = 12.5;
const FLOOR_FADE_START = 8;
const FLOOR_FADE_END = 12;

// Soap-film thickness range in nanometers (see createSoapFilmMaterial()).
// The swirl is animated noise, sized to give a few bands across the tube.
const FILM_MIN_NM = 100;
const FILM_MAX_NM = 400;
const FILM_SWIRL_SCALE = 4.0;
const FILM_SWIRL_SPEED = 0.15;
const FILM_SWIRL_STRENGTH = 0.35;

const BUMPY_SPHERE_PATH = 'assets/bumpysphere.stl';
// loadStlMesh() returns the sphere at unit radius; this halves it.
const BUMPY_SPHERE_SCALE = 0.5;

// Integration steps either object may run before the flow stops for good
// (until Reset or an object switch starts it over at step 0).
const MAX_FLOW_STEPS = 90;

/** One selectable object: its render mesh, plus which flow the worker runs on it. */
interface FlowObject {
    threeMesh: any;
    flow: FlowVariant;
    /** shown after "Scene: " in index.html's scene tool-bar */
    label: string;
    /** integrate(h) steps allowed before the flow stops; Run does nothing once reached */
    maxSteps: number;
}

async function init() {
    const engine = await new Engine().init('minimal-surface-container', {
        cameraPosition: [0, 0, 1.6],
        backgroundColor: BACKGROUND_COLOR,
    });
    const { renderer, camera, scene } = engine;

    // Lighting: an even, sunny-day look with no directional key light. The
    // hemisphere light only adds diffuse light, so it lights the floor and
    // the bumpy sphere. The soap film is fully transmissive, so it has almost no
    // diffuse term. What it shows comes from the environment map below
    // (reflections) and from the floor behind it (refraction).
    const sky_light = new THREE.HemisphereLight(0xffffff, 0x8d8a85, 1.0);
    scene.add(sky_light);

    // Environment map, same bake as cube.ts. A clear film is almost all
    // reflection, so it needs something in the world to reflect. The room's
    // bright light panels give the iridescence highlights to show against.
    // This only affects lighting; the visible background stays solid gray.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();

    scene.add(createFloor());

    // One material per object, built once and reused across radio switches
    // (only geometry is disposed on a switch), so each shader compiles once.
    const soapFilmMaterial = createSoapFilmMaterial();
    const solidMaterial = new THREE.MeshStandardNodeMaterial({
        color: 0x8899aa,
        roughness: 0.6,
        metalness: 0.05,
    });

    // The live object plus a copy of its original positions, and its worker.
    // selectObject() replaces both on every radio change; Reset replaces just
    // the worker. initialPositions stays on the main thread (it's never
    // transferred to a worker, so it can't be detached), which lets Reset
    // start over from it as many times as it likes.
    let live: { object: FlowObject; initialPositions: Float32Array } | null = null;
    let worker: Worker | null = null;

    const sceneLabel = document.getElementById('minimal-surface-scene-label')!;
    const runButton = document.getElementById('flow-run-button');
    const stopButton = document.getElementById('flow-stop-button');
    const resetButton = document.getElementById('flow-reset-button');

    // Whether the flow should be running. Lives here rather than in any one
    // worker: every control that starts or stops the flow goes through
    // setRunning(), and a freshly spawned worker is told the current value
    // once it's READY (see spawnWorker), so Run pressed mid-load still counts.
    // Run/Stop are latched — Run stays sunken while running, Stop while
    // stopped — so the buttons show the state even after the shape settles
    // and stops visibly moving.
    //
    // stepCount is how many steps the live worker has finished. Once it
    // reaches the live object's maxSteps, setRunning(true) is refused, so the
    // flow can't be restarted past the cap; spawnWorker() zeroes it.
    let isRunning = false;
    let stepCount = 0;
    function setRunning(value: boolean) {
        isRunning = value && !(live && stepCount >= live.object.maxSteps);
        const message: MainToWorkerMessage = { type: 'SET_RUNNING', isRunning };
        worker?.postMessage(message);
        setButtonToggled(runButton, isRunning);
        setButtonToggled(stopButton, !isRunning);
    }
    setRunning(false);

    // Arcball drag-to-orbit — see CLAUDE.md's standing controls preference
    // for why ArcballControls over OrbitControls.
    const controls = createArcballControls(camera, renderer.domElement, scene, {
        minDistance: 1.3,
        maxDistance: 8,
    });
    enableArcballOnFirstInteraction(renderer.domElement, controls);

    // Gives `object` its material and puts it in the scene. Once per load —
    // Reset keeps the mesh that's already there.
    function attachObject(object: FlowObject, material: any) {
        object.threeMesh.material = material;
        scene.add(object.threeMesh);
    }

    // Writes `positions` into the object's mesh and spins up a fresh flow
    // worker that starts from them — used both for a new load and for Reset.
    // Returns that worker so killWorker() can terminate it later.
    function spawnWorker(object: FlowObject, positions: Float32Array): Worker {
        const threeGeometry = object.threeMesh.geometry;

        // Double-buffered transferable positions: bufferA stays attached to the
        // live render mesh, bufferB is handed to the worker to compute into.
        // Both start as copies of `positions`, so the mesh shows exactly that
        // shape right away (Reset's instant snap-back) and only changes again
        // when the first computed step comes back.
        const positionAttribute = threeGeometry.attributes.position as any;
        const vertexCount = positions.length / 3;

        const bufferA = new ArrayBuffer(positions.byteLength);
        const bufferB = new ArrayBuffer(positions.byteLength);
        new Float32Array(bufferA).set(positions);
        new Float32Array(bufferB).set(positions);

        positionAttribute.array = new Float32Array(bufferA);
        positionAttribute.needsUpdate = true;
        stepCount = 0;
        // After a Reset the normals still describe the flowed shape.
        threeGeometry.computeVertexNormals();

        // Copy (not transfer) the index array: transferring the buffer backing
        // threeGeometry.index would detach it from the live attribute and
        // corrupt rendering. Face connectivity never changes during the flow,
        // so this is sent once and never touched again. Uint32Array.from also
        // widens: the tube's index comes out Uint16 (three's setIndex(plainArray)
        // picks Uint16 below 65536 vertices), but the worker always reads Uint32.
        const indexCopy = Uint32Array.from(threeGeometry.index!.array as ArrayLike<number>);
        const faceCount = indexCopy.length / 3;

        const flowWorker = new Worker(new URL('./flow-worker.ts', import.meta.url), { type: 'module' });
        flowWorker.onerror = (event: ErrorEvent) => {
            console.error(`[minimal-surface] worker error: ${event.message} (${event.filename}:${event.lineno})`);
        };

        // Measures the send-buffer-back -> next-STEP_DONE gap, i.e. IPC/
        // scheduling overhead, separate from the worker-reported pure compute
        // time (integrateTimeMs/flattenTimeMs) — the two together show whether
        // the solve or the message-passing is the actual bottleneck.
        let roundTripStart = 0;

        flowWorker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
            const message = event.data;

            if (message.type === 'READY') {
                console.log(`[minimal-surface] worker library loaded in ${message.loadTimeMs.toFixed(1)}ms`);
                const initMessage: MainToWorkerMessage = {
                    type: 'INIT',
                    positionsBuffer: bufferB,
                    indexBuffer: indexCopy.buffer,
                    vertexCount,
                    faceCount,
                    h: H,
                    flow: object.flow,
                };
                flowWorker.postMessage(initMessage, [bufferB, indexCopy.buffer]);
                const runMessage: MainToWorkerMessage = { type: 'SET_RUNNING', isRunning };
                flowWorker.postMessage(runMessage);
                return;
            }

            if (message.type === 'STEP_DONE') {
                const roundTripMs = roundTripStart ? performance.now() - roundTripStart : 0;

                const oldBuffer = positionAttribute.array.buffer as ArrayBuffer;
                positionAttribute.array = new Float32Array(message.buffer);
                positionAttribute.needsUpdate = true;

                const normalsStart = performance.now();
                threeGeometry.computeVertexNormals();
                const normalsMs = performance.now() - normalsStart;

                console.log(
                    `[minimal-surface] step ${message.stepIndex}: ` +
                    `integrate=${message.integrateTimeMs.toFixed(1)}ms flatten=${message.flattenTimeMs.toFixed(1)}ms ` +
                    `computeVertexNormals=${normalsMs.toFixed(1)}ms roundTrip=${roundTripMs.toFixed(1)}ms`
                );

                // At the cap, stop before handing the buffer back. Messages
                // arrive in order, so the worker sees SET_RUNNING(false)
                // first and just holds the returned buffer instead of
                // computing another step.
                stepCount = message.stepIndex;
                if (stepCount >= object.maxSteps) {
                    console.log(`[minimal-surface] reached the ${object.maxSteps}-step cap; flow stopped`);
                    setRunning(false);
                }

                const returnMessage: MainToWorkerMessage = { type: 'BUFFER_RETURN', buffer: oldBuffer };
                roundTripStart = performance.now();
                flowWorker.postMessage(returnMessage, [oldBuffer]);
            }
        };

        return flowWorker;
    }

    // Stops the live worker for good. onmessage is detached first so a
    // STEP_DONE the old worker already queued can't land after this — Reset
    // writes the original positions into the same mesh right afterwards, and
    // a late step would overwrite them. terminate() also throws away the
    // worker's whole WASM heap, frozen Laplacian (keepAlive) included.
    function killWorker() {
        if (!worker) return;
        worker.onmessage = null;
        worker.terminate();
        worker = null;
    }

    // Swaps the live object: stops the flow and tears down the old mesh +
    // worker right away, then builds the new object and loads it at its
    // original shape, waiting for Run. (Re-clicking the already-selected
    // radio never gets here — initializeRadioGroup only fires on `change`.)
    // The generation counter drops a slow build (the bumpy sphere's fetch + parse)
    // that finishes after the user has already picked something else. The
    // scene label updates only once the new mesh is in, so it always names
    // what's actually rendered.
    let generation = 0;
    async function selectObject(build: () => FlowObject | Promise<FlowObject>, material: any) {
        const thisGeneration = ++generation;

        killWorker();
        setRunning(false);
        if (live) {
            scene.remove(live.object.threeMesh);
            live.object.threeMesh.geometry.dispose();
            live = null;
        }

        const object = await build();
        if (thisGeneration !== generation) {
            object.threeMesh.geometry.dispose();
            return;
        }
        attachObject(object, material);
        const initialPositions = Float32Array.from(object.threeMesh.geometry.attributes.position.array as Float32Array);
        live = { object, initialPositions };
        worker = spawnWorker(object, initialPositions);
        sceneLabel.textContent = `Scene: ${object.label}`;
    }

    // Flow buttons — index.html's #flow-controls. Run and Stop only flip the
    // running state (both are harmless to repeat). Reset puts the live object
    // back at its original shape, stopped, via a fresh worker rather than a
    // new "reset" message to the current one: terminate() is the simplest way
    // to drop any step in flight and free the old solver's memory, and it's
    // the same cleanup a radio switch already relies on. The cost is one
    // vendored-library reload (the worker's logged load time). With no live
    // object yet (the bumpy sphere still loading), Reset is just a Stop.
    initializeButton(runButton, () => setRunning(true));
    initializeButton(stopButton, () => setRunning(false));
    initializeButton(resetButton, () => {
        killWorker();
        setRunning(false);
        if (live) worker = spawnWorker(live.object, live.initialPositions);
    });

    // Object switcher — index.html's #flow-object-radios. The HTML-checked
    // option's onSelect runs once here to load the starting object.
    const onSelectFailed = (err: unknown) => console.error('[minimal-surface] object load failed:', err);
    initializeRadioGroup(document.getElementById('flow-object-radios'), {
        tube: { onSelect: () => { selectObject(buildTube, soapFilmMaterial).catch(onSelectFailed); } },
        bumpySphere: { onSelect: () => { selectObject(loadBumpySphere, solidMaterial).catch(onSelectFailed); } },
    });

    // No idle animation — the mesh only moves when the worker sends a new
    // buffer; this loop just drives controls + rendering.
    engine.run(() => {
        if (controls.enabled) controls.update();
    });
}

// A closed, bumpy sphere, run under ModifiedMeanCurvatureFlow with a free
// boundary (it has no boundary at all), which smooths the bumps away. The
// worker builds its own halfedge mesh from flattened arrays pulled off
// threeMesh.geometry (see utils/worker-header.ts), which is why loadStlMesh()
// only has to return a welded THREE.Mesh.
async function loadBumpySphere(): Promise<FlowObject> {
    const threeMesh = await loadStlMesh(BUMPY_SPHERE_PATH);
    // Scale the geometry itself, not threeMesh.scale: the worker flows the
    // raw position buffer, so a scale on the mesh's transform would never reach it.
    threeMesh.geometry.scale(BUMPY_SPHERE_SCALE, BUMPY_SPHERE_SCALE, BUMPY_SPHERE_SCALE);
    return { threeMesh, flow: 'modified', label: `"${BUMPY_SPHERE_PATH}"`, maxSteps: MAX_FLOW_STEPS };
}

// An open-ended vertical tube whose two end rings stay pinned while the
// interior runs standard mean curvature flow toward the catenoid spanning
// them (see the TUBE_* constants above for the dimensions).
function buildTube(): FlowObject {
    const path = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, TUBE_HALF_LENGTH, 0),
        new THREE.Vector3(0, -TUBE_HALF_LENGTH, 0),
    ]);
    const tubeGeometry = new THREE.TubeGeometry(path, TUBE_TUBULAR_SEGMENTS, TUBE_RADIUS, TUBE_RADIAL_SEGMENTS, false);

    // Weld the seam. TubeGeometry repeats each ring's first vertex at its end
    // (u = 0 and u = 1: same position, different UVs), giving 17 x 17
    // vertices. The halfedge mesh would read that repeated column as a slit —
    // a rectangle, not an annulus — and pin the slit as boundary too. With
    // uv/normal removed, mergeVertices() compares positions only, so the
    // duplicates collapse: 17 x 16 = 272 vertices, two 16-vertex end rings.
    tubeGeometry.deleteAttribute('uv');
    tubeGeometry.deleteAttribute('normal');
    const welded = mergeVertices(tubeGeometry);
    tubeGeometry.dispose();
    welded.computeVertexNormals();

    return { threeMesh: new THREE.Mesh(welded), flow: 'standard-pinned', label: 'tube', maxSteps: MAX_FLOW_STEPS };
}

// A gray ground disc under both objects. It stays opaque on purpose: WebGPU
// transmission refracts what the opaque pass already drew, so an opaque
// floor shows through the soap film and a transparent one wouldn't. The rim
// fades into the background in outputNode. `output` is the fully lit floor
// color, and mixing it toward BACKGROUND_COLOR (both in linear working space,
// like scene.background) makes the horizon seamless at any zoom. Scene fog
// could do the same, but it would also haze the tube when zoomed out.
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

// Soap-bubble film for the tube: a TSL port of a classic MeshPhysicalMaterial
// (clear, fully transmissive, iridescent, clearcoated), with each property
// set as a *Node instead of a plain value.
//
// The one real change is film thickness. The classic
// iridescenceThicknessRange: [100, 400] only uses its minimum when there's an
// iridescenceThicknessMap. Without one, three renders a constant 400 nm film
// (see MaterialNode.js's IRIDESCENCE_THICKNESS case). Thin-film color comes
// from thickness: light reflected off the film's top and bottom surfaces
// interferes, and which wavelengths reinforce depends on the extra path
// 2·n·d·cosθ. So a constant d only gives a rainbow that shifts with viewing
// angle. filmThickness() below varies d per pixel across the full range:
// - a drainage gradient: gravity thins a real film at the top (100 nm) and
//   pools it at the bottom (400 nm);
// - plus slowly drifting 3D Perlin noise for the swirling bands.
// Setting iridescenceThicknessNode = float(FILM_MAX_NM) restores the exact
// classic behavior.
function createSoapFilmMaterial() {
    const material = new THREE.MeshPhysicalNodeMaterial();

    // DoubleSide so the tube's inner wall shows through its open ends
    // instead of being culled. For a transparent DoubleSide material WebGPU
    // draws the back faces, then the front faces.
    material.side = THREE.DoubleSide;
    material.transparent = true;

    material.colorNode = color(0xffffff);
    material.roughnessNode = float(0.0);        // perfectly smooth surface
    material.metalnessNode = float(0.0);        // dielectric, not metal
    material.opacityNode = float(1.0);          // keep 1 so reflections stay visible

    // Fully transmissive, with a thin volume. `ior` is 1.0 (air), not the
    // classic material's 1.333. three models iridescence as a film lying on
    // a base whose index comes from `ior`. Film colors need reflections off
    // both of the film's surfaces, and the bottom one reflects
    // ((n_base - n_film) / (n_base + n_film))². With ior = iridescenceIOR =
    // 1.333 that's 0, so the film shows no color and reads as plain glass
    // (see evalIridescence's R1 in PhysicalLightingModel.js). A real bubble is
    // air | film | air: the base is air, and iridescenceIOR is the film. It
    // also means no refraction bending, as with a real bubble's thin shell.
    material.transmissionNode = float(1.0);
    material.iorNode = float(1.0);
    material.thicknessNode = float(0.1);

    // The soap-film rainbow.
    const filmThickness = Fn(() => {
        // 0 at the bottom ring, 1 at the top ring. The rings stay pinned at
        // ±TUBE_HALF_LENGTH while the flow runs, so this range holds.
        const height = positionLocal.y.div(TUBE_HALF_LENGTH).mul(0.5).add(0.5).saturate();
        const swirl = mx_noise_float(
            positionLocal.mul(FILM_SWIRL_SCALE).add(vec3(0, time.mul(FILM_SWIRL_SPEED), 0))
        );
        const t = height.oneMinus().add(swirl.mul(FILM_SWIRL_STRENGTH)).saturate();
        return mix(float(FILM_MIN_NM), float(FILM_MAX_NM), t);
    });
    material.iridescenceNode = float(1.0);
    material.iridescenceIORNode = float(1.333);
    material.iridescenceThicknessNode = filmThickness();

    // Extra reflective outer coat.
    material.clearcoatNode = float(1.0);
    material.clearcoatRoughnessNode = float(0.0);

    return material;
}

init().catch((err) => console.error('[minimal-surface] init() failed:', err));
