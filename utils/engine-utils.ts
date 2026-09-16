import * as THREE from "three/webgpu"
import { pass } from "three/tsl"

// Engine — per-scene WebGPU boilerplate (renderer/camera/scene/render
// pipeline/resize), wrapped as a class since it's real per-instance state
// that belongs together, unlike the stateless helpers elsewhere in utils/.
// Every scene script constructs its own instance (`new Engine()`) and gets
// a fully independent WebGPURenderer/canvas/render loop — only the class
// definition is shared, never a runtime instance.

/** Options accepted by {@link Engine.init}. */
export interface EngineOptions {
    /** passed to WebGPURenderer. @default true */
    antialias?: boolean;
    /** @default 75 */
    fov?: number;
    /** @default 0.1 */
    near?: number;
    /** @default 1000 */
    far?: number;
    /** if omitted, the camera stays at three's default (0,0,0). */
    cameraPosition?: [number, number, number];
    /** @default 0x000000 */
    backgroundColor?: number;
    /**
     * Seam for a scene with its own post-processing (see
     * _createRenderPipeline() below). Both parameters and the return value
     * are TSL nodes, which — like the rest of the three/webgpu & three/tsl
     * surface — three ships no types for (see types/three-shims.d.ts), so
     * this stays untyped (`any`) rather than fighting the type system.
     */
    buildOutputNode?: (scenePassColor: any, scenePass: any) => any;
}

export class Engine {
    // Real runtime types are THREE.WebGPURenderer/PerspectiveCamera/Scene/
    // RenderPipeline, but three ships no .d.ts for three/webgpu at all (see
    // types/three-shims.d.ts) so these stay `any`, annotated with definite
    // assignment (`!`) since they're always set inside init() before any
    // other method runs — no caller ever observes them unset.
    container!: HTMLElement;
    renderer!: any;
    camera!: any;
    scene!: any;
    renderPipeline!: any;
    private _lastWidth!: number;
    private _lastHeight!: number;

    /**
     * init(containerId, options)
     *
     * Full renderer/camera/scene/render-pipeline setup. Returns `this`:
     *
     *   const engine = await new Engine().init('cube-container', { ... });
     *
     * @param containerId - id of this scene's container element.
     * @returns this, once renderer.init() has resolved.
     */
    async init(containerId: string, options: EngineOptions = {}): Promise<this> {
        const {
            antialias = true,
            fov = 75, near = 0.1, far = 1000, cameraPosition,
            backgroundColor = 0x000000,
            buildOutputNode,
        } = options;

        const container = document.getElementById(containerId);
        if (!container) {
            throw new Error(`Engine.init: no element found with id "${containerId}"`);
        }
        this.container = container;

        await this._createRenderer(antialias);
        this._createCamera(fov, near, far, cameraPosition);
        this._createScene(backgroundColor);
        this._createRenderPipeline(buildOutputNode);

        return this;
    }

    // Sized off the container, not the window, so multiple differently-sized
    // scenes coexist on one page. `setSize(w, h, false)` skips forcing the
    // canvas's own CSS size, since the container's CSS already controls that.
    private async _createRenderer(antialias: boolean): Promise<void> {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.renderer = new THREE.WebGPURenderer({ antialias });
        this.renderer.setSize(width, height, false);
        this.container.appendChild(this.renderer.domElement);
        await this.renderer.init();
        this._lastWidth = width;
        this._lastHeight = height;
    }

    private _createCamera(
        fov: number, near: number, far: number,
        cameraPosition?: [number, number, number],
    ): void {
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
        if (cameraPosition) this.camera.position.set(...cameraPosition);
    }

    private _createScene(backgroundColor: number): void {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(backgroundColor);
    }

    // pass(scene, camera) renders this scene/camera into a texture;
    // getTextureNode('output') exposes that texture as a node other nodes
    // can chain off of. Plain pass-through unless buildOutputNode is given
    // (background.js's bloom).
    private _createRenderPipeline(buildOutputNode?: EngineOptions["buildOutputNode"]): void {
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
    private _resizeIfNeeded(): void {
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
     */
    run(updateFrame: (time: number) => void): void {
        this.renderer.setAnimationLoop((time: number) => {
            this._resizeIfNeeded();
            updateFrame(time);
            this.renderPipeline.render(this.scene, this.camera);
        });
    }

    /** Stops the render loop. */
    dispose(): void {
        this.renderer.setAnimationLoop(null);
    }
}
