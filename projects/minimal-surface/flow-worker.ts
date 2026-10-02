/// <reference lib="webworker" />

// flow-worker.ts — runs a mean curvature flow's integrate(h) continuously
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
// intact) copied straight out of the THREE.Mesh it built for the selected
// object, plus which flow to run on it (see utils/worker-header.ts's
// FlowVariant): the vendored ModifiedMeanCurvatureFlow for the bumpy sphere, or
// createPinnedBoundaryMeanCurvatureFlow() below for the tube. This worker
// reconstructs its own Vector/Mesh/Geometry from those primitives, then
// ping-pongs one Float32Array-backed
// ArrayBuffer back and forth with the main thread via transferable
// postMessage: each SET_RUNNING(true)/BUFFER_RETURN hands this worker a
// buffer to compute the next step into; each STEP_DONE hands that buffer's
// ownership back to the main thread to render.
import { loadClassicScriptBundleInWorker } from "../../utils/worker-lib-loader.js";
import type { MainToWorkerMessage, StepDoneMessage, WorkerToMainMessage } from "../../utils/worker-header.js";

// Populated once bootstrap() resolves, by destructuring
// loadClassicScriptBundleInWorker()'s returned bridge object — see
// worker-lib-loader.ts's header for why that bridge (not a bare-identifier
// ambient `declare const`) is what makes these usable here at all.
let Mesh: any, Geometry: any, Vector: any, DenseMatrix: any, EmscriptenMemoryManager: any, ModifiedMeanCurvatureFlow: any;

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
// Whichever flow INIT picked — both expose the same integrate(h), so
// runStep() never needs to know which one it's driving.
let flow: { integrate(h: number): void } | null = null;
// WASM-heap matrices that must survive memoryManager.deleteExcept() between
// steps (e.g. ModifiedMeanCurvatureFlow's frozen Laplacian A). Everything
// else a step allocates is freed right after it.
let keepAlive: any[] = [];
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
        'Mesh', 'Geometry', 'Vector', 'DenseMatrix', 'EmscriptenMemoryManager', 'ModifiedMeanCurvatureFlow',
    ]);
    ({ Mesh, Geometry, Vector, DenseMatrix, EmscriptenMemoryManager, ModifiedMeanCurvatureFlow } = lib);
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
    // normalizePositions=false: these are exactly the coordinates the main
    // thread is rendering (the bumpy sphere already normalized once via
    // loadStlMesh, the tube at its own spec size) — renormalizing here would
    // drift the solve away from what's on screen.
    geometry = new Geometry(mesh, polygonSoup.v, false);

    let flowDescription: string;
    if (message.flow === 'modified') {
        const modifiedMeanCurvatureFlow = new ModifiedMeanCurvatureFlow(geometry);
        flow = modifiedMeanCurvatureFlow;
        keepAlive = [modifiedMeanCurvatureFlow.A];
        flowDescription = 'modified MCF, free boundary';
    } else {
        const pinnedFlow = createPinnedBoundaryMeanCurvatureFlow(geometry);
        flow = pinnedFlow;
        keepAlive = [];
        flowDescription = `standard MCF, ${pinnedFlow.interiorCount} interior / ${pinnedFlow.pinnedCount} pinned`;
    }

    const initTimeMs = performance.now() - start;
    console.log(`[flow-worker] mesh/geometry/flow built in ${initTimeMs.toFixed(1)}ms (${vertexCount} vertices; ${flowDescription})`);

    // The buffer used to carry the initial positions is now free to reuse
    // as the first buffer to compute into, once running starts.
    runStep(message.positionsBuffer);
}

/**
 * createPinnedBoundaryMeanCurvatureFlow(geometry)
 *
 * Why: the vendored MeanCurvatureFlow/ModifiedMeanCurvatureFlow solve for
 * every vertex at once and then recenter the whole mesh, so a boundary can't
 * stay put. The tube needs its two end rings held fixed (Dirichlet boundary
 * conditions) while the interior flows toward the minimal surface spanning
 * them — and it needs the *standard* flow (Laplacian rebuilt from the current
 * shape every step), since only that settles on a true minimal surface.
 * ModifiedMeanCurvatureFlow's frozen Laplacian would instead settle on a
 * shape that's harmonic with respect to the starting cylinder.
 *
 * How: one backward-Euler MCF step is (M + hL) x' = M x, with L the cotan
 * Laplacian and M the diagonal mass matrix, both rebuilt from the current
 * positions. Numbering vertices interior-first (0..nI-1) and boundary-last
 * (nI..V-1) splits every matrix into blocks:
 *
 *   [ F_II  F_IB ] [ x'_I ]   [ M_II x_I ]
 *   [ F_BI  F_BB ] [ x'_B ] = [ M_BB x_B ],   F = M + hL
 *
 * Pinning makes x'_B = x_B known, so the boundary rows are dropped and the
 * known boundary term moves to the right-hand side of the interior rows:
 *
 *   F_II x'_I = M_II x_I - F_IB x_B
 *
 * F_II is a principal submatrix of a symmetric positive-definite matrix, so
 * it's SPD too, and the same Cholesky solve the vendored flows use still
 * applies. Only interior positions are written back, with no recentering.
 */
function createPinnedBoundaryMeanCurvatureFlow(geometry: any) {
    const vertices = geometry.mesh.vertices;
    const V = vertices.length;
    const interior = vertices.filter((v: any) => !v.onBoundary());
    const boundary = vertices.filter((v: any) => v.onBoundary());
    const nI = interior.length;

    // Same shape as the library's indexElements(): a plain object keyed by
    // vertex (Vertex.toString() returns its index), which laplaceMatrix()/
    // massMatrix() accept as-is — just with interior vertices numbered first.
    const vertexIndex: Record<string, number> = {};
    [...interior, ...boundary].forEach((v: any, i: number) => { vertexIndex[v] = i; });

    // The given vertices' current positions as an n x 3 DenseMatrix.
    function positionsMatrix(subset: any[]): any {
        const X = DenseMatrix.zeros(subset.length, 3);
        subset.forEach((v: any, i: number) => {
            const p = geometry.positions[v];
            X.set(p.x, i, 0);
            X.set(p.y, i, 1);
            X.set(p.z, i, 2);
        });
        return X;
    }

    function integrate(h: number): void {
        const L = geometry.laplaceMatrix(vertexIndex);
        const M = geometry.massMatrix(vertexIndex);
        const F = M.plus(L.timesReal(h));

        const F_II = F.subMatrix(0, nI, 0, nI);
        const F_IB = F.subMatrix(0, nI, nI, V);
        const M_II = M.subMatrix(0, nI, 0, nI);

        const rhs = M_II.timesDense(positionsMatrix(interior))
            .minus(F_IB.timesDense(positionsMatrix(boundary)));
        const xI = F_II.chol().solvePositiveDefinite(rhs);

        interior.forEach((v: any, i: number) => {
            const p = geometry.positions[v];
            p.x = xI.get(i, 0);
            p.y = xI.get(i, 1);
            p.z = xI.get(i, 2);
        });
    }

    return { integrate, interiorCount: nI, pinnedCount: V - nI };
}

function runStep(buffer: ArrayBuffer): void {
    if (!isRunning) {
        heldBuffer = buffer;
        return;
    }

    const integrateStart = performance.now();
    flow!.integrate(h);
    // Free this step's mass matrix, flow operator, Cholesky factor, and
    // right-hand sides from the WASM heap — the JS garbage collector can't
    // reach them (same call the vendored geometric-flow demo makes per step).
    (self as any).memoryManager.deleteExcept(keepAlive);
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
