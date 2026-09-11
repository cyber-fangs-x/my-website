import { ArcballControls } from "three/addons/controls/ArcballControls.js"

// ============================================================================
// Reusable "click/tap to orbit" helpers — ArcballControls edition
//
// These two functions are intentionally generic — they only ever touch the
// `camera`, `domElement` (a renderer's canvas), `scene`, and `controls`
// objects that are passed in. Any three.js scene in this project (or a
// future one) can wire up the same "auto-play until the user grabs it"
// interaction by calling createArcballControls() once during setup and
// enableArcballOnFirstInteraction() to gate it behind a click/tap, with no
// per-scene interaction code of its own.
//
// Why ArcballControls instead of OrbitControls: OrbitControls locks the
// camera to a fixed "up" axis and orbits it in azimuth/polar around that —
// mathematically it can never roll, but that also means it fights against
// an object that isn't already sitting axis-aligned. ArcballControls is a
// true virtual-trackball: dragging maps cursor/finger movement onto a
// sphere and rotates the camera with a single quaternion, so any drag
// direction (including a deliberate twist) produces the rotation you'd
// physically expect from "grabbing" the object — no fixed up-axis to fight,
// and it ships its own gizmo rings that visualize the trackball itself.
// ============================================================================

/**
 * createArcballControls(camera, domElement, scene, options)
 *
 * WHY: A scene that auto-rotates for show (like our idle-spinning cube)
 * needs a way to hand control to the user without the two behaviors
 * fighting each other. ArcballControls (like all three.js controls)
 * defaults to `enabled = true` the instant it's constructed, which would
 * silently steal drag/scroll/pinch events from the very first frame —
 * building it with `enabled = false` up front keeps it inert until
 * something explicitly turns it on.
 *
 * ArcballControls also needs the `scene` reference (its 3rd constructor
 * argument) purely so it has somewhere to add its rotation-gizmo rings —
 * without it, the controls still work but no gizmo can ever be shown.
 *
 * HOW: Instantiates ArcballControls bound to the given camera/canvas/scene,
 * applies zoom-distance limits (so the user can't dolly through the model
 * or fly off into empty space) — defaulted for a small demo canvas but
 * overridable via `options` since different scenes have different scales —
 * then forces `enabled = false`. Returns the controls instance so the
 * caller can read `controls.enabled` later as a simple "has the user taken
 * over yet?" flag — no extra state tracking needed.
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

    // Inert until enableArcballOnFirstInteraction() (or the caller directly)
    // flips this on — see the WHY above.
    controls.enabled = false;

    return controls;
}

/**
 * enableArcballOnFirstInteraction(domElement, controls, onActivate)
 *
 * WHY: The desired UX is "the model spins on its own until you reach out
 * and grab it — click on desktop, tap on mobile — at which point it's
 * yours to rotate and zoom." That's the same gesture-detection problem for
 * any canvas on the site, so it belongs here once instead of being
 * reimplemented (with subtly different mouse-vs-touch handling) in every
 * scene file.
 *
 * HOW: Listens for a single 'pointerdown' event on `domElement`. Pointer
 * events are used instead of separate 'click'/'touchstart' handlers
 * because 'pointerdown' fires uniformly for mouse, touch, and pen input —
 * one code path covers both the desktop-click and mobile-tap cases the
 * caller asked for. `{ once: true }` removes the listener after it fires,
 * so this is a one-way "activate" trigger, not a toggle. On that first
 * interaction it: (1) enables the controls, so ArcballControls starts
 * processing subsequent drag/wheel/pinch input, and (2) sets
 * `touch-action: none` on the canvas, which stops mobile browsers from
 * interpreting a one-finger drag as a page scroll — without it, orbiting
 * on a touch device would fight the browser's native scroll gesture. The
 * optional `onActivate` callback lets a caller react too — e.g. resetting
 * an auto-spinning mesh's rotation to identity so the user always starts
 * from a clean, axis-aligned pose instead of whatever orientation the
 * auto-spin happened to freeze at.
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
