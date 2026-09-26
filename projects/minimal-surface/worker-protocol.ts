// worker-protocol.ts — the postMessage contract between minimal-surface.ts
// (main thread) and flow-worker.ts. Type-only: erased at build time, kept
// here just so both ends of the channel agree on what shape crosses it.

/**
 * Sent once, right after the worker reports READY. Carries everything the
 * worker needs to build its own gpMesh/gpGeometry/ModifiedMeanCurvatureFlow
 * without re-fetching or re-parsing the .obj file: flattened, already-
 * normalized position/index data pulled straight from the THREE.Mesh the
 * main thread already built via loadObjAsset().
 */
export interface InitMessage {
    type: 'INIT';
    /** flattened Vx3 vertex positions (already centered/unit-scaled). */
    positionsBuffer: ArrayBuffer;
    /** flattened Fx3 triangle corner indices. */
    indexBuffer: ArrayBuffer;
    vertexCount: number;
    faceCount: number;
    /** ModifiedMeanCurvatureFlow time step. */
    h: number;
}

/** Toggles the worker's integrate(h) autoloop on/off. */
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
