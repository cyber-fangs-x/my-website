import { ArcballControls } from "three/addons/controls/ArcballControls.js"

// Reusable "click/tap to orbit" helpers, generic over any camera/canvas/
// scene triple. ArcballControls (not OrbitControls) because OrbitControls
// locks to a fixed up-axis and fights an object that isn't already
// axis-aligned; ArcballControls is a true virtual trackball (single
// quaternion, no fixed up-axis) and ships its own gizmo rings.

/** Options accepted by {@link createArcballControls}. */
export interface CreateArcballControlsOptions {
    /** closest allowed zoom distance. @default 1 */
    minDistance?: number;
    /** farthest allowed zoom distance. @default 10 */
    maxDistance?: number;
    /** whether the controls start enabled. @default false */
    enabled?: boolean;
    /** whether the gizmo rings are visible. @default false */
    gizmosVisible?: boolean;
}

/**
 * createArcballControls(camera, domElement, scene, options)
 *
 * Builds ArcballControls bound to the given camera/canvas/scene, applies
 * zoom-distance limits, and forces `enabled = false` so it stays inert
 * until enableArcballOnFirstInteraction() (or the caller) turns it on —
 * otherwise it would start stealing drag/scroll input immediately.
 * `scene` is only needed so the controls have somewhere to add their
 * gizmo rings.
 *
 * @param camera - the camera ArcballControls should move. Untyped (`any`):
 *   three ships no types for three/webgpu (see types/three-shims.d.ts).
 * @param domElement - the renderer's canvas to listen on.
 * @param scene - the scene the gizmo rings get added to. Untyped for the
 *   same reason as `camera`.
 * @returns a ready-to-use, initially-disabled controls instance. Untyped
 *   (`any`): three ships no types for three/addons either (see
 *   types/three-shims.d.ts), so the imported `ArcballControls` itself
 *   resolves to `any` and can't be used as a type annotation.
 */
export function createArcballControls(
    camera: any,
    domElement: HTMLElement,
    scene: any,
    options: CreateArcballControlsOptions = {},
): any {
    const {
        minDistance = 1,
        maxDistance = 10,
        enabled = false,
        gizmosVisible = false,
    } = options;

    const controls = new ArcballControls(camera, domElement, scene);
    controls.minDistance = minDistance;
    controls.maxDistance = maxDistance;
    controls.enabled = enabled;
    controls.setGizmosVisible(gizmosVisible);

    return controls;
}

/**
 * enableArcballOnFirstInteraction(domElement, controls, onActivate)
 *
 * Enables `controls` on the first pointerdown on `domElement` (pointer
 * events cover mouse/touch/pen in one handler), then removes itself
 * (`{ once: true }`). Also sets `touch-action: none` on the canvas so a
 * one-finger drag orbits instead of scrolling the page. `onActivate` is an
 * optional extra callback — e.g. resetting an auto-spinning mesh's
 * rotation to identity so the user starts from a clean pose.
 *
 * @param domElement - the renderer's canvas to listen on.
 * @param controls - the controls to activate on interaction. Untyped
 *   (`any`) — see the note on createArcballControls()'s return type above.
 * @param onActivate - optional extra callback fired once, on activation.
 */
export function enableArcballOnFirstInteraction(
    domElement: HTMLElement,
    controls: any,
    onActivate?: () => void,
): void {
    domElement.addEventListener('pointerdown', () => {
        controls.enabled = true;
        domElement.style.touchAction = 'none';
        if (onActivate) onActivate();
    }, { once: true });
}
