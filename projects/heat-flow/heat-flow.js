import * as THREE from "three/webgpu"
import { color, float } from "three/tsl"
import { Engine } from "../../utils/engine-utils.js"
import { createArcballControls, enableArcballOnFirstInteraction } from "../../utils/arcball-utils.js"
import { loadObjAsset } from "../../utils/asset-loader.js"

async function init() {
    const engine = await new Engine().init('heat-flow-container', { cameraPosition: [0, 0, 2.6] });
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

    // Load the mesh — threeMesh is all this scaffold renders for now;
    // gpMesh/gpGeometry (see asset-loader.js) are what the eventual
    // heat-diffusion math will run on.
    const { threeMesh } = await loadObjAsset('assets/bunny.obj');
    threeMesh.material = createHeatFlowMaterial();
    scene.add(threeMesh);

    // Auto-spin until the user clicks/taps, then hand off to arcball
    // drag-to-orbit — this project's standing interaction pattern (see
    // cube.js). min/maxDistance are sized for the bunny's unit bounding
    // radius (loadObjAsset normalizes positions to it by default).
    const controls = createArcballControls(camera, renderer.domElement, scene, {
        minDistance: 1.3,
        maxDistance: 8,
    });
    enableArcballOnFirstInteraction(renderer.domElement, controls);

    // Animation loop
    engine.run(() => {
        if (controls.enabled) {
            controls.update();
        } else {
            threeMesh.rotation.y += 0.006;
        }
    });
}

// Plain grey, non-metallic — there's no data to color the surface by yet.
// This colorNode is the slot a later heat-diffusion-driven shader replaces.
function createHeatFlowMaterial() {
    const material = new THREE.MeshStandardNodeMaterial();
    material.colorNode = color(0x999999);
    material.roughnessNode = float(0.6);
    material.metalnessNode = float(0.0);
    return material;
}

init();
