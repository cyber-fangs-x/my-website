import * as THREE from "three/webgpu"
import { pass, instancedBufferAttribute, uniform, shapeCircle, color, pointUV, positionLocal, uv, time, sin, vec3, vec2, attribute } from "three/tsl"
import { bloom } from "three/addons/tsl/display/BloomNode.js";

const PURPLE = 0x7900B2; //0xAE00FF;
const BLUE = 0x00B2FF; //0x00D4FF;
const GREEN = 0x00B200; //0x00FFB2;
const WHITE = 0xFFFFFF;
const RED = 0xB20000;
const BLACK = 0x000000;
let THIS_COLOR = PURPLE;

const adjustColorCSS = (num, factor = 1.43) => {
    // Brighten Color
    const r = Math.min(255, Math.round(((num >> 16) & 0xFF) * factor));
    const g = Math.min(255, Math.round(((num >> 8) & 0xFF) * factor));
    const b = Math.min(255, Math.round((num & 0xFF) * factor));
    const newHex = (r << 16) | (g << 8) | b;

    // Tranform for CSS
    const toCssHex = (num) => `#${num.toString(16).padStart(6, '0')}`;
    return toCssHex(newHex);
};

document.addEventListener("DOMContentLoaded", () => {
    const body = document.body;
    const themeColor = body.getAttribute("data-theme-color");
    
    switch (themeColor) {
        case "purple":
            THIS_COLOR = PURPLE;
            document.documentElement.style.setProperty('--primary-color', adjustColorCSS(PURPLE));
            break;
        case "blue":
            THIS_COLOR = BLUE;
            document.documentElement.style.setProperty('--primary-color', adjustColorCSS(BLUE, 1.1));
            break;
        case "green":
            THIS_COLOR = GREEN;
            document.documentElement.style.setProperty('--primary-color', adjustColorCSS(GREEN));
            break;
        case "red":
            THIS_COLOR = RED;
            document.documentElement.style.setProperty('--primary-color', adjustColorCSS(RED));
            break;
        default:
            THIS_COLOR = WHITE; // Default to purple if no valid theme color is found
    }
});

async function init() {
     // Canvas Setup
    const container = document.getElementById('background-container');
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

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BLACK);

    // Grid Background
    const bottom_grid = new THREE.GridHelper(1000, 100, THIS_COLOR, THIS_COLOR);
    bottom_grid.position.z = -500;
    scene.add(bottom_grid);

    const top_grid = new THREE.GridHelper(1000, 100, THIS_COLOR, THIS_COLOR);
    top_grid.position.z = -500;
    top_grid.position.y = 100;
    top_grid.material.side = THREE.DoubleSide;
    top_grid.material.depthWrite = false;
    scene.add(top_grid);

    const fog = new THREE.FogExp2(0x000000, 0.005);
    scene.fog = fog;       

    //Glow Effect
    const render_pipeline = new THREE.RenderPipeline(renderer);
    const scene_pass = pass(scene, camera);
    const scene_pass_color = scene_pass.getTextureNode('output');
    const bloomPass = bloom(scene_pass_color, 0.5, 0.4, 0.01);
    render_pipeline.outputNode = scene_pass_color.add(bloomPass);

    // Handle window resize
    window.addEventListener('resize', () => {
        const newWidth = container.clientWidth;
        const newHeight = container.clientHeight;
        camera.aspect = newWidth / newHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(newWidth, newHeight, false);
    });

    // Camera Scroll Effect
    function updateCameraPosition() {
        const scroll_max = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        const scroll_position = document.documentElement.scrollTop;
        const scroll_ratio = document.documentElement.clientHeight / document.documentElement.scrollHeight;
        const scroll_percentage = scroll_max > 0 ? scroll_position / scroll_max : 0;
        const scroll_amount = 50 * (1 - scroll_ratio);
        camera.position.y = 50 - scroll_percentage * scroll_amount;
    }

    // Particle Animation

    
    function animate(t=0) {
        updateCameraPosition();
        render_pipeline.render(scene, camera);
    }
    renderer.setAnimationLoop(animate);
}

init();