import * as THREE from "three/webgpu"
import { instancedBufferAttribute, uniform, shapeCircle, color, pointUV, positionLocal, uv, time, sin, vec3, vec2, attribute } from "three/tsl"
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { Engine } from "./utils/engine-utils.js"

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

function applyThemeColor() {
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
}

// Run immediately if DOMContentLoaded already fired, rather than only ever
// listening for it — guards against a race if this script ever gains an
// async dependency that delays its own execution past that event.
if (document.readyState === 'loading') {
    document.addEventListener("DOMContentLoaded", applyThemeColor);
} else {
    applyThemeColor();
}

async function init() {
    // buildOutputNode layers this scene's bloom on top of the plain render,
    // through Engine's own RenderPipeline setup rather than around it.
    const engine = await new Engine().init('background-container', {
        backgroundColor: BLACK,
        buildOutputNode: (sceneColor) => sceneColor.add(bloom(sceneColor, 0.5, 0.4, 0.01)),
    });
    const { camera, scene } = engine;

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

    engine.run(() => updateCameraPosition());
}

init();