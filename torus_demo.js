import * as THREE from 'three/webgpu'
import { instancedBufferAttribute, uniform, shapeCircle, color, pointUV, positionLocal, uv, time, sin, vec3, vec2, attribute } from "three/tsl"
import { Engine } from "./utils/engine-utils.js"




async function init() {
    // Renderer/camera/scene/pipeline/resize, all handled by Engine
    const engine = await new Engine().init('torus-container', { cameraPosition: [0, 0, 5] });
    const { scene } = engine;

    // Create a simple cube
    const geometry = new THREE.TorusKnotGeometry();
    const material = new THREE.MeshPhongMaterial({ color: 0x777777, specular : 0xffffff, shininess: 1000, wireframe: false });
    const torus_knot = new THREE.Mesh(geometry, material);
    scene.add(torus_knot);

    // Lighting
    const d_light = new THREE.DirectionalLight(0xffffff, 1);
    d_light.position.set(0, 5, 5);
    const h_light = new THREE.HemisphereLight();
    scene.add(d_light);

    // Animation loop
    engine.run(() => {
        torus_knot.rotateX(0.01);
        torus_knot.rotateY(0.01);
    });
}


init();