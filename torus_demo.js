import * as THREE from 'three/webgpu'
import { pass, instancedBufferAttribute, uniform, shapeCircle, color, pointUV, positionLocal, uv, time, sin, vec3, vec2, attribute } from "three/tsl"




async function init() {
     // Canvas Setup
    const container = document.getElementById('torus-container');
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
    camera.position.z = 5;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

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
        torus_knot.rotateX(0.01);
        torus_knot.rotateY(0.01);
        render_pipeline.render(scene, camera);
    }
    renderer.setAnimationLoop(animate);
}


init();