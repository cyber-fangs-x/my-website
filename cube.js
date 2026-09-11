import * as THREE from "three/webgpu"
import {
    pass, Fn, uniform, color, float, vec3, mix,
    time, sin, positionLocal, positionWorld, normalWorld, cameraPosition
} from "three/tsl"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { createArcballControls, enableArcballOnFirstInteraction } from "./utils/arcball-controls-utils.js"
import { createGUI, addArcballGizmoToggle } from "./utils/gui-utils.js"

// ============================================================================
// MATERIAL MODE FLAGS
//
// This is the switch mentioned in the brief: flip these two booleans (by
// hand, in source) to change which Node Material the cube is built with.
// GLASS_MODE takes priority if both happen to be true; if both are false the
// cube falls back to a plain grey MeshPhysicalNodeMaterial.
// ============================================================================
let GLASS_MODE = true;
let METALLIC_MODE = false;

const GLASS_COLOR = 0xaee2ff;
const METAL_COLOR = 0xae00ff; // site accent purple
const RIM_COLOR = 0xffffff;

async function init() {
    // Canvas Setup
    const container = document.getElementById('cube-container');
    const w = container.clientWidth;
    const h = container.clientHeight;
    const renderer = new THREE.WebGPURenderer({ antialias: true });
    renderer.setSize(w, h, false);
    container.appendChild(renderer.domElement);
    await renderer.init();

    // Three.js Setup
    const fov = 75;
    const aspect = w / h;
    const near = 0.1;
    const far = 1000;
    const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    camera.position.set(0, 0, 3.2);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

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

    // Arcball controls — the cube auto-spins (see animate() below) until the
    // user clicks (desktop) or taps (mobile) its canvas, at which point
    // control hands over to drag-to-rotate / wheel-or-pinch-to-zoom via a
    // true virtual trackball. See arcball-controls-utils.js for the
    // "why"/"how" of these helpers — they're generic over any
    // camera/canvas/scene triple, not cube-specific.
    const controls = createArcballControls(camera, renderer.domElement, scene, {
        minDistance: 1.5,
        maxDistance: 8,
    });
    // Hand off control to the user on the first click/tap.
    enableArcballOnFirstInteraction(renderer.domElement, controls); 

    // Debug/demo GUI — lives in its own #cube-gui-container element (see
    // index.html), not overlaid on the canvas. See gui-utils.js for the
    // "why"/"how" and for the pattern to follow when adding more controls.
    const guiContainer = document.getElementById('cube-gui-container');
    const gui = createGUI(guiContainer);
    addArcballGizmoToggle(gui, controls);

    // Post Processing
    const render_pipeline = new THREE.RenderPipeline(renderer);
    const scene_pass = pass(scene, camera);
    const scene_pass_color = scene_pass.getTextureNode('output');
    render_pipeline.outputNode = scene_pass_color;

    // Handle window resize
    window.addEventListener('resize', () => {
        const newWidth = container.clientWidth;
        const newHeight = container.clientHeight;
        camera.aspect = newWidth / newHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(newWidth, newHeight, false);
    });

    // Animation loop
    function animate() {
        // controls.enabled doubles as our "has the user taken over?" flag
        // (see arcball-controls-utils.js) — auto-spin until they click/tap,
        // then let ArcballControls drive the camera instead. ArcballControls
        // drives its own damping/focus animations internally and doesn't
        // require update() to be called externally, but calling it is
        // harmless and keeps its gizmo position in sync with `target` if
        // that's ever changed elsewhere.
        if (controls.enabled) {
            controls.update();
        } else {
            cube.rotation.x += 0.006;
            cube.rotation.y += 0.01;
        }
        render_pipeline.render(scene, camera);
    }
    renderer.setAnimationLoop(animate);
}

// ============================================================================
// TSL / Node Material construction
//
// A THREE.js Node Material (MeshPhysicalNodeMaterial here) is configured by
// assigning TSL node graphs — small functions built from `Fn`, `uniform`,
// math ops, and attribute accessors like `positionLocal` / `normalWorld` —
// to its *Node properties (colorNode, roughnessNode, positionNode, ...)
// instead of plain numeric/texture values. Those graphs are compiled to
// WGSL/GLSL shader code by the renderer.
// ============================================================================
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

    return material;
}

init();
