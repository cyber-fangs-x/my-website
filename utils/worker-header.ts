// worker-header.ts — the postMessage contract between a graphics script's
// main thread and its flow worker (today: projects/minimal-surface/'s
// minimal-surface.ts and flow-worker.ts). Type-only: erased at build time,
// kept here just so both ends of the channel agree on what shape crosses it.
// Lives in utils/ so a future worker-backed graphics script can reuse the
// INIT / SET_RUNNING / BUFFER_RETURN / STEP_DONE handshake.

/**
 * Which curvature flow the worker runs on the object it's given:
 * - 'modified': ModifiedMeanCurvatureFlow — cotan Laplacian frozen at the
 *   starting shape, free boundary, mesh recentered every step (the bumpy
 *   sphere).
 * - 'standard-pinned': standard mean curvature flow — cotan Laplacian
 *   rebuilt from the current shape every step, boundary vertices held fixed
 *   so only the interior moves (the tube with pinned end rings).
 */
export type FlowVariant = 'modified' | 'standard-pinned';

/**
 * Sent once, right after the worker reports READY. Carries everything the
 * worker needs to build its own gpMesh/gpGeometry/flow without re-fetching
 * or re-parsing anything: flattened position/index data pulled straight
 * from whichever THREE.Mesh the main thread built for the selected object
 * (the bumpy sphere via loadStlMesh(), the tube via TubeGeometry).
 */
export interface InitMessage {
    type: 'INIT';
    /** flattened Vx3 vertex positions, used as-is (never renormalized). */
    positionsBuffer: ArrayBuffer;
    /** flattened Fx3 triangle corner indices. */
    indexBuffer: ArrayBuffer;
    vertexCount: number;
    faceCount: number;
    /** flow time step. */
    h: number;
    /** which flow to run — see {@link FlowVariant}. */
    flow: FlowVariant;
}

/**
 * Starts or stops the worker's integrate(h) autoloop. Idempotent: sending
 * the state the worker is already in does nothing.
 */
export interface SetRunningMessage {
    type: 'SET_RUNNING';
    isRunning: boolean;
}

/** Hands a just-displaced buffer's ownership back to the worker to reuse. */
export interface BufferReturnMessage {
    type: 'BUFFER_RETURN';
    buffer: ArrayBuffer;
}

export type MainToWorkerMessage = InitMessage | SetRunningMessage | BufferReturnMessage;

/** The vendored library finished loading; the worker is ready for INIT. */
export interface ReadyMessage {
    type: 'READY';
    loadTimeMs: number;
}

/** One integrate(h) step finished; buffer holds the new flattened positions. */
export interface StepDoneMessage {
    type: 'STEP_DONE';
    buffer: ArrayBuffer;
    stepIndex: number;
    integrateTimeMs: number;
    flattenTimeMs: number;
}

export type WorkerToMainMessage = ReadyMessage | StepDoneMessage;
