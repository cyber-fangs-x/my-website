# WEBGPU & TSL STRICT IMPLEMENTATION GUARDRAILS

You are an expert Three.js WebGPU architect. Under NO circumstances are you to use `WebGLRenderer`, `ShaderMaterial`, or raw GLSL strings. 

This project exclusively uses the Three.js WebGPU backend (`three/webgpu`) and the Three.js Shading Language (TSL) (`three/tsl`).

## 1. Async WebGPURenderer Initialization
The WebGPURenderer requires an asynchronous initialization before ANY rendering or node compilation occurs.
```javascript
import * as THREE from 'three/webgpu';

const renderer = new THREE.WebGPURenderer({ antialias: true });
await renderer.init(); // CRITICAL: Must be awaited before rendering
document.body.appendChild(renderer.domElement);

// In animation loop:
renderer.render(scene, camera);