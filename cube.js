import * as THREE from "three/webgpu"
import {
    Fn, uniform, color, float, vec3, mix,
    time, sin, positionLocal, positionWorld, normalWorld, cameraPosition
} from "three/tsl"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { Engine } from "./utils/engine-utils.js"
import { createArcballControls, enableArcballOnFirstInteraction } from "./utils/arcball-utils.js"
import { createGUI, addArcballGizmoToggle, addDebugVisualHelpersToggle } from "./utils/gui-utils.js"
import {
    debugAssert, debugPrintSceneGraph, debugPrintTSLNode,
    debugAttachVisualHelpers, debugCreateMaterial
} from "./utils/debug_utils.js"

// Flip these to change which Node Material the cube uses. GLASS_MODE wins if
// both are true; both false falls back to a plain grey material.
let GLASS_MODE = true;
let METALLIC_MODE = false;

const GLASS_COLOR = 0xaee2ff;
const METAL_COLOR = 0xae00ff; // site accent purple
const RIM_COLOR = 0xffffff;

async function init() {
    const engine = await new Engine().init('cube-container', { cameraPosition: [0, 0, 3.2] });
    const { renderer, camera, scene } = engine;

    // Environment map — both glass (transmission/refraction) and metal
    // (reflections) need something in the world to sample, or they just
    // read as flat black/invisible.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Lighting
    const key_light = new THREE.DirectionalLight(0xffffff, 2);
    key_light.position.set(3, 4, 5);
    scene.add(key_light);

    const fill_light = new THREE.HemisphereLight(0xffffff, 0x222233, 0.6);
    scene.add(fill_light);

    // Cube
    const geometry = new THREE.BoxGeometry(1.4, 1.4, 1.4, 4, 4, 4);
    const material = createCubeMaterial();
    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);

    // Cube auto-spins (see engine.run() below) until the user clicks/taps its
    // canvas, at which point control hands over to arcball drag-to-rotate.
    const controls = createArcballControls(camera, renderer.domElement, scene, {
        minDistance: 1.5,
        maxDistance: 8,
    });
    enableArcballOnFirstInteraction(renderer.domElement, controls);

    // Debug/demo GUI lives in its own #cube-gui-container element (see
    // index.html), not overlaid on the canvas.
    const guiContainer = document.getElementById('cube-gui-container');
    const gui = createGUI(guiContainer);
    addArcballGizmoToggle(gui, controls);

    // DEBUG (see utils/debug_utils.js — DEBUG_ENABLED flag lives there)
    debugAssert(cube.geometry.attributes.position, "cube must have a position attribute");
    debugPrintSceneGraph(scene);

    const helpers = debugAttachVisualHelpers(cube, { axesSize: 1.2 });
    if (helpers) addDebugVisualHelpersToggle(gui, helpers);

    const debugNormalMaterial = debugCreateMaterial(normalWorld);
    if (debugNormalMaterial) {
        const debugMaterialState = { previewDebugMaterial: false };
        gui.add(debugMaterialState, "previewDebugMaterial")
            .name("Preview Normal Debug Material")
            .onChange((on) => { cube.material = on ? debugNormalMaterial : material; });
    }

    // Animation loop
    engine.run(() => {
        // controls.enabled doubles as "has the user taken over?" — auto-spin
        // until they click/tap, then let ArcballControls drive the camera.
        if (controls.enabled) {
            controls.update();
        } else {
            cube.rotation.x += 0.006;
            cube.rotation.y += 0.01;
        }
    });
}

// Node Materials are configured by assigning TSL node graphs (Fn/uniform/
// math ops/attribute accessors like positionLocal, normalWorld) to *Node
// properties (colorNode, roughnessNode, ...) instead of plain values —
// those graphs get compiled to WGSL/GLSL by the renderer.
function createCubeMaterial() {
    const material = new THREE.MeshPhysicalNodeMaterial();

    // --- Shared TSL uniforms -------------------------------------------------
    // `uniform()` wraps a JS value so it can be updated at runtime (e.g. from
    // a GUI) without recompiling the shader. Here we just use it for the rim
    // color so it's easy to retint from outside createCubeMaterial().
    const rimColor = uniform(color(RIM_COLOR));

    // --- Shared TSL functions -------------------------------------------------
    // `Fn(() => {...})` defines a reusable node function, the TSL equivalent
    // of a GLSL/WGSL helper function. It's evaluated once per material to
    // build the node graph, not once per frame.
    const fresnel = Fn(() => {
        const viewDir = cameraPosition.sub(positionWorld).normalize();
        const nDotV = normalWorld.dot(viewDir).saturate();
        return float(1.0).sub(nDotV).pow(2.5);
    });

    // A gentle "breathing" scale driven by the built-in `time` node —
    // demonstrates a positionNode graph rather than static geometry.
    const breathe = float(1.0).add(sin(time.mul(2.0)).mul(0.015));
    material.positionNode = positionLocal.mul(breathe);

    if (GLASS_MODE) {
        material.colorNode = color(GLASS_COLOR);
        material.transmissionNode = float(0.95);
        material.roughnessNode = float(0.04);
        material.metalnessNode = float(0.0);
        material.iorNode = float(1.5);
        material.thicknessNode = float(0.8);
        material.attenuationColorNode = color(0xffffff);
        material.attenuationDistanceNode = float(1.2);
        material.emissiveNode = rimColor.mul(fresnel()).mul(0.5);
        material.transparent = true;
    } else if (METALLIC_MODE) {
        material.colorNode = color(METAL_COLOR);
        material.metalnessNode = float(1.0);
        // Roughness gets a slow animated wobble mixed in via `mix`, just to
        // show a node graph reacting to `time` instead of a bare constant.
        material.roughnessNode = mix(float(0.15), float(0.35), sin(time.mul(0.8)).mul(0.5).add(0.5));
        material.emissiveNode = rimColor.mul(fresnel()).mul(0.15);
    } else {
        // Fallback if someone flips both flags off.
        material.colorNode = color(0x888888);
        material.metalnessNode = float(0.0);
        material.roughnessNode = float(0.6);
        material.emissiveNode = vec3(0, 0, 0);
    }

    // --- Debug: inspect the composed node graph (see utils/debug_utils.js) ---
    debugPrintTSLNode(material.colorNode);

    return material;
}

init();
