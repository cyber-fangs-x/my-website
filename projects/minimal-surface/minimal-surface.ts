import * as THREE from "three/webgpu"
import { Engine } from "../../utils/engine-utils.js"
import { createArcballControls, enableArcballOnFirstInteraction } from "../../utils/arcball-utils.js"
import { createGUI, addPlayPauseToggle } from "../../utils/gui-utils.js"
import { loadObjAsset } from "../../utils/asset-loader.js"
import type { MainToWorkerMessage, WorkerToMainMessage } from "./worker-protocol.js"

// ModifiedMeanCurvatureFlow time step — fixed per this project's scope
// (play/pause only, no time-step slider; see notes/geometric-flow-
// blueprint.tex for what this controls).
const H = 0.0001;

async function init() {
    const engine = await new Engine().init('minimal-surface-container', { cameraPosition: [0, 0, 1.6] });
    const { renderer, camera, scene } = engine;

    // Lighting — heat-flow.ts's key + fill rig, reused as-is.
    const key_light = new THREE.DirectionalLight(0xffffff, 2);
    key_light.position.set(3, 4, 5);
    scene.add(key_light);

    const fill_light = new THREE.HemisphereLight(0xffffff, 0x222233, 0.6);
    scene.add(fill_light);

    // Only threeMesh is used going forward — gpMesh/gpGeometry from this
    // call are discarded; the worker builds its own from flattened arrays
    // pulled off threeMesh.geometry below (see worker-protocol.ts).
    const { threeMesh } = await loadObjAsset('assets/bunny.obj');
    const threeGeometry = threeMesh.geometry;

    const material = new THREE.MeshStandardNodeMaterial({
        color: 0x8899aa,
        roughness: 0.6,
        metalness: 0.05,
    });
    threeMesh.material = material;
    scene.add(threeMesh);

    // Double-buffered transferable positions: bufferA stays attached to the
    // live render mesh, bufferB is handed to the worker to compute into.
    // Both start as copies of the same normalized positions loadObjAsset
    // already built, so the mesh never visibly changes until the first
    // computed step comes back.
    const positionAttribute = threeGeometry.attributes.position as any;
    const initialPositions = positionAttribute.array as Float32Array;
    const vertexCount = initialPositions.length / 3;

    const bufferA = new ArrayBuffer(initialPositions.byteLength);
    const bufferB = new ArrayBuffer(initialPositions.byteLength);
    new Float32Array(bufferA).set(initialPositions);
    new Float32Array(bufferB).set(initialPositions);

    positionAttribute.array = new Float32Array(bufferA);
    positionAttribute.needsUpdate = true;

    // Copy (not transfer) the index array: transferring the buffer backing
    // threeGeometry.index would detach it from the live attribute and
    // corrupt rendering. Face connectivity never changes during the flow,
    // so this is sent once and never touched again.
    const indexArray = threeGeometry.index!.array as Uint32Array;
    const indexCopy = indexArray.slice();
    const faceCount = indexCopy.length / 3;

    const worker = new Worker(new URL('./flow-worker.ts', import.meta.url), { type: 'module' });
    worker.onerror = (event: ErrorEvent) => {
        console.error(`[minimal-surface] worker error: ${event.message} (${event.filename}:${event.lineno})`);
    };

    // Measures the send-buffer-back -> next-STEP_DONE gap, i.e. IPC/
    // scheduling overhead, separate from the worker-reported pure compute
    // time (integrateTimeMs/flattenTimeMs) — the two together show whether
    // the solve or the message-passing is the actual bottleneck.
    let roundTripStart = 0;

    worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
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
            };
            worker.postMessage(initMessage, [bufferB, indexCopy.buffer]);
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

            const returnMessage: MainToWorkerMessage = { type: 'BUFFER_RETURN', buffer: oldBuffer };
            roundTripStart = performance.now();
            worker.postMessage(returnMessage, [oldBuffer]);
        }
    };

    const gui = createGUI(document.getElementById('minimal-surface-gui-container')!);
    addPlayPauseToggle(gui, (isRunning: boolean) => {
        const message: MainToWorkerMessage = { type: 'SET_RUNNING', isRunning };
        worker.postMessage(message);
    }, { label: "Run Flow" });

    // Arcball drag-to-orbit — see CLAUDE.md's standing controls preference
    // for why ArcballControls over OrbitControls.
    const controls = createArcballControls(camera, renderer.domElement, scene, {
        minDistance: 1.3,
        maxDistance: 8,
    });
    enableArcballOnFirstInteraction(renderer.domElement, controls);

    // No idle animation — the mesh only moves when the worker sends a new
    // buffer; this loop just drives controls + rendering.
    engine.run(() => {
        if (controls.enabled) controls.update();
    });
}

init().catch((err) => console.error('[minimal-surface] init() failed:', err));
