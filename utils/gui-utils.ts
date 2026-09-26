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
 * @param container - the DOM element the panel should live in.
 * @param options - any additional lil-gui GUI() constructor options (e.g.
 *   `title`), spread in after `container`.
 * @returns the created lil-gui panel instance.
 */
export function createGUI(container: HTMLElement, options: Record<string, any> = {}): GUI {
    return new GUI({ container, ...options });
}

/** Backing state for {@link addArcballGizmoToggle}. */
export interface ArcballGizmoToggleOptions {
    /** the checkbox's display label. @default "Show Gizmos" */
    label?: string;
    /**
     * initial gizmo visibility, matching ArcballControls' own default (its
     * gizmo Group is invisible unless told otherwise). @default false
     */
    defaultVisible?: boolean;
}

/**
 * addArcballGizmoToggle(gui, controls, options)
 *
 * Adds a checkbox bound to `controls.setGizmosVisible(bool)`. There's no
 * public getter for current gizmo visibility, so the checkbox's state is
 * tracked in a local `state` object (seeded from `options.defaultVisible`)
 * rather than read back off the controls.
 *
 * @param gui - the panel returned by createGUI() to add this control to.
 * @param controls - an ArcballControls instance. Untyped (`any`): three
 *   ships no types for three/addons (see types/three-shims.d.ts).
 * @returns the backing state object, in case the caller wants to read or
 *   drive it programmatically.
 */
export function addArcballGizmoToggle(
    gui: GUI,
    controls: any,
    options: ArcballGizmoToggleOptions = {},
): { showGizmos: boolean } {
    const { label = "Show Gizmos", defaultVisible = false } = options;

    const state = { showGizmos: defaultVisible };
    controls.setGizmosVisible(state.showGizmos);

    gui.add(state, "showGizmos")
        .name(label)
        .onChange((value: boolean) => controls.setGizmosVisible(value));

    return state;
}

/** Backing state for {@link addPlayPauseToggle}. */
export interface PlayPauseToggleOptions {
    /** the checkbox's display label. @default "Running" */
    label?: string;
    /** initial running state. @default false */
    defaultRunning?: boolean;
}

/**
 * addPlayPauseToggle(gui, onToggle, options)
 *
 * The play/pause control for a continuous background process (e.g. a Web
 * Worker's autoloop) — a checkbox bound to a boolean `isRunning` state,
 * same state-object + onChange shape as addArcballGizmoToggle() above,
 * rather than inventing a new lil-gui idiom. lil-gui has no dedicated
 * toggle-button widget; a checkbox bound to a boolean state key *is* this
 * codebase's toggle pattern.
 *
 * @param gui - the panel returned by createGUI() to add this control to.
 * @param onToggle - called with the new running state on every change —
 *   typically posting a SET_RUNNING message to a worker.
 * @returns the backing state object, in case the caller wants to read or
 *   drive it programmatically.
 */
export function addPlayPauseToggle(
    gui: GUI,
    onToggle: (isRunning: boolean) => void,
    options: PlayPauseToggleOptions = {},
): { isRunning: boolean } {
    const { label = "Running", defaultRunning = false } = options;

    const state = { isRunning: defaultRunning };

    gui.add(state, "isRunning")
        .name(label)
        .onChange((value: boolean) => onToggle(value));

    return state;
}

/** The three visual-debug helpers built by debug_utils.js's debugAttachVisualHelpers(). */
export interface DebugVisualHelpers {
    wireframe: any;
    box: any;
    axes: any;
}

/** Backing state for {@link addDebugVisualHelpersToggle}. */
export interface DebugVisualHelpersToggleOptions {
    defaultWireframe?: boolean;
    defaultBox?: boolean;
    defaultAxes?: boolean;
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
 * @param gui - the panel returned by createGUI() to add this control to.
 * @param helpers - the object returned by debug_utils.js's debugAttachVisualHelpers().
 * @returns the backing state object, in case the caller wants to read or
 *   drive it programmatically.
 */
export function addDebugVisualHelpersToggle(
    gui: GUI,
    helpers: DebugVisualHelpers,
    options: DebugVisualHelpersToggleOptions = {},
): { wireframe: boolean; box: boolean; axes: boolean } {
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
        .onChange((value: boolean) => { helpers.wireframe.visible = value; });
    folder.add(state, "box").name("Bounding Box")
        .onChange((value: boolean) => { helpers.box.visible = value; });
    folder.add(state, "axes").name("Axes")
        .onChange((value: boolean) => { helpers.axes.visible = value; });

    return state;
}
