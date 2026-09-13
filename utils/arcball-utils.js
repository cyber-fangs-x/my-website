import { ArcballControls } from "three/addons/controls/ArcballControls.js"

// Reusable "click/tap to orbit" helpers, generic over any camera/canvas/
// scene triple. ArcballControls (not OrbitControls) because OrbitControls
// locks to a fixed up-axis and fights an object that isn't already
// axis-aligned; ArcballControls is a true virtual trackball (single
// quaternion, no fixed up-axis) and ships its own gizmo rings.

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
 * @param {THREE.Camera} camera - the camera ArcballControls should move.
 * @param {HTMLElement} domElement - the renderer's canvas to listen on.
 * @param {THREE.Scene} scene - the scene the gizmo rings get added to.
 * @param {Object} [options]
 * @param {number} [options.minDistance=1] - closest allowed zoom distance.
 * @param {number} [options.maxDistance=10] - farthest allowed zoom distance.
 * @returns {ArcballControls} a ready-to-use, initially-disabled controls instance.
 */
export function createArcballControls(camera, domElement, scene, options = {}) {
    const {
        minDistance = 1,
        maxDistance = 10,
    } = options;

    const controls = new ArcballControls(camera, domElement, scene);
    controls.minDistance = minDistance;
    controls.maxDistance = maxDistance;
    controls.enabled = false;

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
 * @param {HTMLElement} domElement - the renderer's canvas to listen on.
 * @param {ArcballControls} controls - the controls to activate on interaction.
 * @param {() => void} [onActivate] - optional extra callback fired once, on activation.
 */
export function enableArcballOnFirstInteraction(domElement, controls, onActivate) {
    domElement.addEventListener('pointerdown', () => {
        controls.enabled = true;
        domElement.style.touchAction = 'none';
        if (onActivate) onActivate();
    }, { once: true });
}
