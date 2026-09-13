import * as THREE from "three/webgpu"
import { pass } from "three/tsl"

// Engine — per-scene WebGPU boilerplate (renderer/camera/scene/render
// pipeline/resize), wrapped as a class since it's real per-instance state
// that belongs together, unlike the stateless helpers elsewhere in utils/.
// Every scene script constructs its own instance (`new Engine()`) and gets
// a fully independent WebGPURenderer/canvas/render loop — only the class
// definition is shared, never a runtime instance.
export class Engine {
    constructor() {
        this.container = null;
        this.renderer = null;
        this.camera = null;
        this.scene = null;
        this.renderPipeline = null;
        this._lastWidth = null;
        this._lastHeight = null;
    }

    /**
     * init(containerId, options)
     *
     * Full renderer/camera/scene/render-pipeline setup. Returns `this`:
     *
     *   const engine = await new Engine().init('cube-container', { ... });
     *
     * @param {string} containerId - id of this scene's container element.
     * @param {Object} [options]
     * @param {boolean} [options.antialias=true] - passed to WebGPURenderer.
     * @param {number} [options.fov=75]
     * @param {number} [options.near=0.1]
     * @param {number} [options.far=1000]
     * @param {[number,number,number]} [options.cameraPosition] - if omitted,
     *   the camera stays at three's default (0,0,0).
     * @param {number} [options.backgroundColor=0x000000]
     * @param {(scenePassColor, scenePass) => *} [options.buildOutputNode] -
     *   seam for a scene with its own post-processing (see
     *   _createRenderPipeline() below).
     * @returns {Promise<Engine>} this, once renderer.init() has resolved.
     */
    async init(containerId, options = {}) {
        const {
            antialias = true,
            fov = 75, near = 0.1, far = 1000, cameraPosition,
            backgroundColor = 0x000000,
            buildOutputNode,
        } = options;

        this.container = document.getElementById(containerId);

        await this._createRenderer(antialias);
        this._createCamera(fov, near, far, cameraPosition);
        this._createScene(backgroundColor);
        this._createRenderPipeline(buildOutputNode);

        return this;
    }

    // Sized off the container, not the window, so multiple differently-sized
    // scenes coexist on one page. `setSize(w, h, false)` skips forcing the
    // canvas's own CSS size, since the container's CSS already controls that.
    async _createRenderer(antialias) {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.renderer = new THREE.WebGPURenderer({ antialias });
        this.renderer.setSize(width, height, false);
        this.container.appendChild(this.renderer.domElement);
        await this.renderer.init();
        this._lastWidth = width;
        this._lastHeight = height;
    }

    _createCamera(fov, near, far, cameraPosition) {
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
        if (cameraPosition) this.camera.position.set(...cameraPosition);
    }

    _createScene(backgroundColor) {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(backgroundColor);
    }

    // pass(scene, camera) renders this scene/camera into a texture;
    // getTextureNode('output') exposes that texture as a node other nodes
    // can chain off of. Plain pass-through unless buildOutputNode is given
    // (background.js's bloom).
    _createRenderPipeline(buildOutputNode) {
        this.renderPipeline = new THREE.RenderPipeline(this.renderer);
        const scenePass = pass(this.scene, this.camera);
        const scenePassColor = scenePass.getTextureNode('output');
        this.renderPipeline.outputNode = buildOutputNode
            ? buildOutputNode(scenePassColor, scenePass)
            : scenePassColor;
    }

    // Checked once per rendered frame (from run(), below) rather than off a
    // resize event: renderer.setSize() reconfigures the canvas's GPU swap
    // chain, and event-driven resize (window 'resize', or a ResizeObserver)
    // can fire far more often than a frame renders, flooding that
    // reconfiguration and leaving the canvas black mid-drag. Rate-limiting
    // to once per frame caps it at the GPU's own pace instead.
    _resizeIfNeeded() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (width === this._lastWidth && height === this._lastHeight) return;
        this._lastWidth = width;
        this._lastHeight = height;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
    }

    /**
     * run(updateFrame)
     *
     * Drives the render loop. `updateFrame(time)` runs once per frame,
     * before this engine renders — a plain callback free to close over
     * whatever the calling scene needs (meshes, controls, etc.).
     *
     * @param {(time: number) => void} updateFrame
     */
    run(updateFrame) {
        this.renderer.setAnimationLoop((time) => {
            this._resizeIfNeeded();
            updateFrame(time);
            this.renderPipeline.render(this.scene, this.camera);
        });
    }

    /** Stops the render loop. */
    dispose() {
        this.renderer.setAnimationLoop(null);
    }
}
