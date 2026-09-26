/// <reference lib="webworker" />

// flow-worker.ts — runs ModifiedMeanCurvatureFlow.integrate(h) continuously
// in a dedicated Worker, off the main thread, so the render loop and
// ArcballControls in minimal-surface.ts stay responsive while the solve
// runs. This is the first Web Worker in the codebase; see
// utils/worker-lib-loader.ts's header comment for why the vendored library
// is loaded via fetch+eval here instead of utils/asset-loader.ts's DOM-
// script-tag injection or importScripts().
//
// Data flow: minimal-surface.ts sends one INIT message carrying flattened
// position/index typed arrays (not the .obj text, not Vector objects —
// Vector instances don't survive structured clone with their prototype
// intact) copied straight out of the THREE.Mesh it already built via
// loadObjAsset(). This worker reconstructs its own Vector/Mesh/Geometry
// from those primitives, then ping-pongs one Float32Array-backed
// ArrayBuffer back and forth with the main thread via transferable
// postMessage: each SET_RUNNING(true)/BUFFER_RETURN hands this worker a
// buffer to compute the next step into; each STEP_DONE hands that buffer's
// ownership back to the main thread to render.
import { loadClassicScriptBundleInWorker } from "../../utils/worker-lib-loader.js";
import type { MainToWorkerMessage, StepDoneMessage, WorkerToMainMessage } from "./worker-protocol.js";

// Populated once bootstrap() resolves, by destructuring
// loadClassicScriptBundleInWorker()'s returned bridge object — see
// worker-lib-loader.ts's header for why that bridge (not a bare-identifier
// ambient `declare const`) is what makes these usable here at all.
let Mesh: any, Geometry: any, Vector: any, EmscriptenMemoryManager: any, ModifiedMeanCurvatureFlow: any;

const LIB_BASE = `${import.meta.env.BASE_URL}lib/geometry-processing-js-master/`;

// No utils/meshio.js here — this worker never parses OBJ text, only
// already-flattened arrays (see the file header above), so MeshIO and its
// alert()-on-bad-input path (unsafe in a worker: alert doesn't exist) never
// come into play.
const LIBRARY_SCRIPTS = [
    'linear-algebra/vector.js',
    'core/vertex.js',
    'core/edge.js',
    'core/face.js',
    'core/halfedge.js',
    'core/corner.js',
    'core/mesh.js',
    'core/geometry.js',
    'linear-algebra/linear-algebra-asm.js',
    'linear-algebra/emscripten-memory-manager.js',
    'linear-algebra/dense-matrix.js',
    'linear-algebra/sparse-matrix.js',
    'projects/geometric-flow/mean-curvature-flow.js',
    'projects/geometric-flow/modified-mean-curvature-flow.js',
].map((path) => LIB_BASE + path);

let geometry: any = null;
let modifiedMeanCurvatureFlow: any = null;
let h = 0.001;
let isRunning = false;
let stepIndex = 0;
// The one buffer this worker currently owns, when isRunning is false (or
// no step is otherwise in flight) — held until SET_RUNNING(true) or the
// next BUFFER_RETURN hands it back into runStep().
let heldBuffer: ArrayBuffer | null = null;

function post(message: WorkerToMainMessage, transfer: Transferable[] = []): void {
    (self as any).postMessage(message, transfer);
}

async function bootstrap(): Promise<void> {
    const start = performance.now();
    const lib = await loadClassicScriptBundleInWorker(LIBRARY_SCRIPTS, [
        'Mesh', 'Geometry', 'Vector', 'EmscriptenMemoryManager', 'ModifiedMeanCurvatureFlow',
    ]);
    ({ Mesh, Geometry, Vector, EmscriptenMemoryManager, ModifiedMeanCurvatureFlow } = lib);
    // dense-matrix.js/sparse-matrix.js reference a bare `memoryManager`
    // global — must be a real property on `self`, not a bundler-scoped
    // `let`, since Vite may wrap this module's own code in a closure that
    // the eval'd vendored files (genuine top-level code) can't see into.
    (self as any).memoryManager = new EmscriptenMemoryManager();
    const loadTimeMs = performance.now() - start;
    console.log(`[flow-worker] vendored library loaded in ${loadTimeMs.toFixed(1)}ms`);
    post({ type: 'READY', loadTimeMs });
}

function handleInit(message: Extract<MainToWorkerMessage, { type: 'INIT' }>): void {
    const start = performance.now();

    const positions = new Float32Array(message.positionsBuffer);
    const indices = new Uint32Array(message.indexBuffer);
    const vertexCount = message.vertexCount;
    h = message.h;

    const v: any[] = new Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
        v[i] = new Vector(positions[3 * i + 0], positions[3 * i + 1], positions[3 * i + 2]);
    }
    const polygonSoup = { v, f: Array.from(indices) };

    const mesh = new Mesh();
    mesh.build(polygonSoup);
    // normalizePositions=false: the main thread already normalized these
    // exact coordinates once via loadObjAsset — renormalizing already-
    // normalized data here would just drift it away from what's rendered.
    geometry = new Geometry(mesh, polygonSoup.v, false);
    modifiedMeanCurvatureFlow = new ModifiedMeanCurvatureFlow(geometry);

    const initTimeMs = performance.now() - start;
    console.log(`[flow-worker] mesh/geometry/flow built in ${initTimeMs.toFixed(1)}ms (${vertexCount} vertices)`);

    // The buffer used to carry the initial positions is now free to reuse
    // as the first buffer to compute into, once running starts.
    runStep(message.positionsBuffer);
}

function runStep(buffer: ArrayBuffer): void {
    if (!isRunning) {
        heldBuffer = buffer;
        return;
    }

    const integrateStart = performance.now();
    modifiedMeanCurvatureFlow.integrate(h);
    const integrateTimeMs = performance.now() - integrateStart;

    const flattenStart = performance.now();
    const positions = new Float32Array(buffer);
    for (const vertex of geometry.mesh.vertices) {
        const i = vertex.index;
        const p = geometry.positions[vertex];
        positions[3 * i + 0] = p.x;
        positions[3 * i + 1] = p.y;
        positions[3 * i + 2] = p.z;
    }
    const flattenTimeMs = performance.now() - flattenStart;

    stepIndex++;
    console.log(`[flow-worker] step ${stepIndex}: integrate=${integrateTimeMs.toFixed(1)}ms flatten=${flattenTimeMs.toFixed(1)}ms`);

    const message: StepDoneMessage = { type: 'STEP_DONE', buffer, stepIndex, integrateTimeMs, flattenTimeMs };
    post(message, [buffer]);
}

(self as any).onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
    const message = event.data;
    switch (message.type) {
        case 'INIT':
            handleInit(message);
            break;
        case 'SET_RUNNING':
            isRunning = message.isRunning;
            if (isRunning && heldBuffer) {
                const buffer = heldBuffer;
                heldBuffer = null;
                runStep(buffer);
            }
            break;
        case 'BUFFER_RETURN':
            runStep(message.buffer);
            break;
    }
};

bootstrap();
