import GUI from "lil-gui"

// Modular lil-gui scaffold: createGUI() builds one panel per page, and one
// small "feature" function per control (e.g. addArcballGizmoToggle) wires a
// single control into it. Adding/removing a control is then a self-contained
// change — its function plus its one call site in the scene file. To add a
// new feature, hold its value in a small local state object (lil-gui always
// binds to object properties, never bare values), call gui.add()/addColor()
// on it, and do the real work from the onChange callback.

/**
 * createGUI(container, options)
 *
 * Passing lil-gui a `container` element (rather than letting it default to
 * a fixed corner-of-viewport overlay on document.body) makes the panel an
 * ordinary DOM child laid out by the page's own CSS — see index.html's
 * `#cube-gui-container` sitting beside `#cube-container` for the pattern.
 *
 * @param {HTMLElement} container - the DOM element the panel should live in.
 * @param {Object} [options] - any additional lil-gui GUI() constructor options
 *   (e.g. `title`), spread in after `container`.
 * @returns {GUI} the created lil-gui panel instance.
 */
export function createGUI(container, options = {}) {
    return new GUI({ container, ...options });
}

/**
 * addArcballGizmoToggle(gui, controls, options)
 *
 * Adds a checkbox bound to `controls.setGizmosVisible(bool)`. There's no
 * public getter for current gizmo visibility, so the checkbox's state is
 * tracked in a local `state` object (seeded from `options.defaultVisible`)
 * rather than read back off the controls.
 *
 * @param {GUI} gui - the panel returned by createGUI() to add this control to.
 * @param {import("three/addons/controls/ArcballControls.js").ArcballControls} controls
 * @param {Object} [options]
 * @param {string} [options.label="Show Gizmos"] - the checkbox's display label.
 * @param {boolean} [options.defaultVisible=false] - initial gizmo visibility,
 *   matching ArcballControls' own default (its gizmo Group is invisible unless
 *   told otherwise).
 * @returns {{ showGizmos: boolean }} the backing state object, in case the
 *   caller wants to read or drive it programmatically.
 */
export function addArcballGizmoToggle(gui, controls, options = {}) {
    const { label = "Show Gizmos", defaultVisible = false } = options;

    const state = { showGizmos: defaultVisible };
    controls.setGizmosVisible(state.showGizmos);

    gui.add(state, "showGizmos")
        .name(label)
        .onChange((value) => controls.setGizmosVisible(value));

    return state;
}

/**
 * addDebugVisualHelpersToggle(gui, helpers, options)
 *
 * Adds on/off checkboxes (grouped in a folder) for the wireframe/box/axes
 * helpers built by `debug_utils.js`'s `debugAttachVisualHelpers()`, which
 * leaves them invisible by default. Each checkbox just flips the matching
 * helper's `.visible`. Named with the `debug` prefix since it exists purely
 * to support that debug toolkit.
 *
 * @param {GUI} gui - the panel returned by createGUI() to add this control to.
 * @param {{wireframe: THREE.Object3D, box: THREE.Object3D, axes: THREE.Object3D}} helpers
 *   the object returned by debug_utils.js's debugAttachVisualHelpers().
 * @param {Object} [options]
 * @param {boolean} [options.defaultWireframe=false]
 * @param {boolean} [options.defaultBox=false]
 * @param {boolean} [options.defaultAxes=false]
 * @returns {{ wireframe: boolean, box: boolean, axes: boolean }} the backing
 *   state object, in case the caller wants to read or drive it programmatically.
 */
export function addDebugVisualHelpersToggle(gui, helpers, options = {}) {
    const {
        defaultWireframe = false,
        defaultBox = false,
        defaultAxes = false,
    } = options;

    const state = { wireframe: defaultWireframe, box: defaultBox, axes: defaultAxes };
    helpers.wireframe.visible = state.wireframe;
    helpers.box.visible = state.box;
    helpers.axes.visible = state.axes;

    const folder = gui.addFolder("Visual Debug Helpers");
    folder.add(state, "wireframe").name("Wireframe")
        .onChange((value) => { helpers.wireframe.visible = value; });
    folder.add(state, "box").name("Bounding Box")
        .onChange((value) => { helpers.box.visible = value; });
    folder.add(state, "axes").name("Axes")
        .onChange((value) => { helpers.axes.visible = value; });

    return state;
}
