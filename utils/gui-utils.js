import GUI from "lil-gui"

// ============================================================================
// Modular lil-gui scaffold
//
// The goal of this file is to make adding, tweaking, or removing a debug/
// demo control a self-contained, one-line change in whatever scene file
// uses it — never a change that ripples across multiple files. It does
// this with two kinds of exports:
//
//   1. createGUI() — called ONCE per page to get a GUI panel instance.
//   2. one small "feature" function per control (e.g.
//      addArcballGizmoToggle below) — each takes the `gui` instance plus
//      whatever it needs to wire up (a controls object, a material, a
//      light, ...) and adds exactly one control to the panel. Deleting a
//      feature later means deleting its function and its single call site
//      in the scene file — nothing else to untangle.
//
// To add your own feature, copy the shape of addArcballGizmoToggle():
// hold whatever value(s) the control needs in a small local state object
// (lil-gui always binds to object properties, never bare values), call
// gui.add()/addColor()/etc. on that state, and do the real work — mutating
// a material, toggling a light, calling a controls method — from the
// onChange callback.
// ============================================================================

/**
 * createGUI(container, options)
 *
 * WHY: lil-gui's default behavior is to append itself to `document.body`
 * and fix itself to a corner of the viewport as an overlay — fine for a
 * quick debug panel, but not what you want when the GUI should be a real
 * element in the page's own layout, sitting next to (not floating over) a
 * specific canvas. Passing lil-gui a `container` element overrides that
 * default entirely: the panel is appended into that element as an
 * ordinary DOM child and laid out by your page's own CSS instead of a
 * fixed overlay. See the bottom of this file for more on placing/moving
 * that container.
 *
 * HOW: thin wrapper around `new GUI({ container, ...options })` — kept as
 * a function (rather than calling `new GUI(...)` directly in each scene
 * file) so every demo page constructs its GUI the same documented way,
 * and so a site-wide default (a title, a width, a theme option) can be
 * added here once later without touching every call site.
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
 * WHY: This is the demonstration feature for the "one function per
 * control" pattern described above. ArcballControls draws its virtual-
 * trackball rings via `controls.setGizmosVisible(bool)`; wiring that up to
 * a checkbox is a good template because it's the smallest possible case —
 * one boolean, one method call — that every future control (sliders,
 * colors, folders of related controls) can be built from by extension.
 *
 * HOW: lil-gui controls always bind to a property on a plain object, not
 * to a raw value, so this creates a tiny local `state` object to hold the
 * checkbox's current boolean, seeded from `options.defaultVisible` (there's
 * no public getter on ArcballControls for its current gizmo visibility —
 * only the `setGizmosVisible()` setter — so we track the value ourselves
 * rather than reaching into the controls' internals). It immediately calls
 * `controls.setGizmosVisible()` once to force the gizmos into that starting
 * state, adds a checkbox for it via `gui.add(state, 'showGizmos')`, and
 * calls `controls.setGizmosVisible()` again from the checkbox's `onChange`
 * handler — the checkbox and the gizmo rings stay in sync from then on.
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

// ----------------------------------------------------------------------------
// Using the GUI panel as its own HTML element, separate from the canvas
// ----------------------------------------------------------------------------
// createGUI() never touches document.body or applies any fixed/overlay
// styling itself — that behavior only happens inside lil-gui when you
// DON'T pass it a container. So the panel's placement is entirely decided
// by wherever you point `container`:
//
//   const guiContainer = document.getElementById('cube-gui-container');
//   const gui = createGUI(guiContainer);
//
// `guiContainer` just needs to be a normal element that already exists in
// the page's HTML (a sibling <div> next to the canvas' own container is
// the pattern used in this project — see index.html's #cube-gui-container
// next to #cube-container). Because it's a normal DOM node, you can:
//   - move it anywhere in the page's markup (above/below/beside the
//     canvas, in a sidebar, wherever) and the panel follows — no JS change;
//   - style it with ordinary CSS (width, position, margin, a border to
//     match .graphics-container, etc.) instead of fighting lil-gui's
//     built-in overlay positioning;
//   - reuse the exact same createGUI() call for a second/third canvas on
//     the same page, each pointed at its own container, so panels never
//     collide with each other or with a fixed corner-of-the-viewport spot.
// ============================================================================
