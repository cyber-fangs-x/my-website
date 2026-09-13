import * as THREE from "three/webgpu"

// Debug/dev-tooling toolkit — assertions, inspection, and visual debugging
// for Object3D and TSL node workflows. Every export is `debug`-prefixed so a
// call site stays unmistakable in a diff (see cube.js's DEBUG sections).
// DEBUG_ENABLED is the single kill-switch: every export's first statement is
// a guard clause that returns before any work when it's false.
const DEBUG_ENABLED = true;

/**
 * debugAssert(condition, message, ...data)
 *
 * Throws (rather than warning) when `condition` is falsy, so a broken debug
 * invariant actually stops the code path instead of scrolling past in the
 * console. Extra `...data` is logged via `console.error` first, since Error
 * messages only stringify their contents.
 *
 * @param {*} condition - value coerced to boolean; falsy triggers the assertion.
 * @param {string} message - human-readable description of the violated invariant.
 * @param {...*} data - arbitrary extra values logged via console.error for
 *   debugging context before the Error is thrown.
 * @returns {void}
 * @throws {Error} when `condition` is falsy and DEBUG_ENABLED is true.
 */
export function debugAssert(condition, message, ...data) {
    if (!DEBUG_ENABLED) return;
    if (condition) return;

    if (data.length > 0) {
        console.error("[debug_utils] assert context:", ...data);
    }
    throw new Error(`[debug_utils] ${message}`);
}

/**
 * debugPrintSceneGraph(rootObject)
 *
 * Walks `.children` recursively (not `object.traverse()`, which discards
 * depth) and logs each node — type, truncated uuid, visibility, transform —
 * as a nested `console.group` so DevTools renders a collapsible tree.
 *
 * @param {THREE.Object3D} rootObject - root of the hierarchy to print; itself included.
 * @returns {void}
 */
export function debugPrintSceneGraph(rootObject) {
    if (!DEBUG_ENABLED) return;
    if (rootObject == null) {
        console.warn("[debug_utils] debugPrintSceneGraph: rootObject is null/undefined");
        return;
    }

    const printNode = (object, depth) => {
        const indent = "  ".repeat(depth);
        const type = object.type || object.constructor?.name || "Object3D";
        const uuid = object.uuid ? object.uuid.slice(0, 8) : "n/a";
        const p = object.position;
        const r = object.rotation;
        const s = object.scale;
        const layout =
            `pos=(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) ` +
            `rot=(${r.x.toFixed(2)}, ${r.y.toFixed(2)}, ${r.z.toFixed(2)}) ` +
            `scale=(${s.x.toFixed(2)}, ${s.y.toFixed(2)}, ${s.z.toFixed(2)})`;
        const label = `${indent}${type} (${uuid}) visible=${object.visible} ${layout}`;

        const children = object.children || [];
        if (children.length > 0) {
            console.group(label);
            for (const child of children) printNode(child, depth + 1);
            console.groupEnd();
        } else {
            console.log(label);
        }
    };

    printNode(rootObject, 0);
}

/**
 * debugPrintTSLNode(tslNode, options)
 *
 * Prints a TSL node graph's structure read-only, without triggering any
 * shader compilation (`.build()`/`.setup()`/`.generate()`/`.toJSON()` are
 * never called). Child nodes are found by scanning the node's own
 * enumerable properties (TSL stores them under free-form names like
 * `aNode`/`bNode`, not a fixed `children` array) for anything with
 * `.isNode === true`, recursing up to `options.maxDepth` and guarding
 * against cycles with a visited-`uuid` Set. Can't show compiled shader
 * variable names, since those only exist after a real `.build()` pass.
 *
 * @typedef {Object} DebugPrintTSLNodeOptions
 * @property {number} [maxDepth=3] - maximum child-node recursion depth.
 *
 * @param {Object} tslNode - a TSL node instance (e.g. from uniform(), color(),
 *   Fn(), or any composed node graph). Duck-typed, not type-checked, since
 *   TSL nodes don't share one common exported base class to import here.
 * @param {DebugPrintTSLNodeOptions} [options]
 * @returns {void}
 */
export function debugPrintTSLNode(tslNode, options = {}) {
    if (!DEBUG_ENABLED) return;
    if (tslNode == null) {
        console.warn("[debug_utils] debugPrintTSLNode: tslNode is null/undefined");
        return;
    }

    const { maxDepth = 3 } = options;
    const visited = new Set();

    const describe = (node) => {
        try {
            const type = node.type || node.nodeType || node.constructor?.name || "Node";
            const uuid = node.uuid ? node.uuid.slice(0, 8) : "n/a";
            let value = "—";
            if ("value" in node) {
                try {
                    value = JSON.stringify(node.value);
                } catch {
                    value = String(node.value);
                }
            }
            return `${type} value=${value} uuid=${uuid}`;
        } catch (err) {
            return `<unreadable node: ${err.message}>`;
        }
    };

    const printNode = (node, depth) => {
        try {
            if (node?.uuid) {
                if (visited.has(node.uuid)) {
                    console.log(`(already visited: ${node.uuid.slice(0, 8)})`);
                    return;
                }
                visited.add(node.uuid);
            }

            const childEntries = depth < maxDepth
                ? Object.keys(node).filter((key) => node[key]?.isNode === true)
                : [];

            if (childEntries.length > 0) {
                console.group(describe(node));
                for (const key of childEntries) {
                    console.group(`${key}:`);
                    printNode(node[key], depth + 1);
                    console.groupEnd();
                }
                console.groupEnd();
            } else {
                console.log(describe(node));
            }
        } catch (err) {
            console.warn("[debug_utils] debugPrintTSLNode: failed to inspect node", err);
        }
    };

    printNode(tslNode, 0);
}

/**
 * debugAttachVisualHelpers(object3d, options)
 *
 * Builds a wireframe overlay, a bounding-box helper, and an axes helper for
 * `object3d` in one call, all initially invisible (toggled via
 * `addDebugVisualHelpersToggle()` in gui-utils.js). The wireframe/axes are
 * added as children of `object3d` so they track its transform; `BoxHelper`
 * computes its own world-space box and must sit outside that hierarchy, so
 * it's added to the parent scene instead (found by walking `.parent` up
 * from `object3d` until `.isScene`).
 *
 * @typedef {Object} DebugVisualHelpersOptions
 * @property {number} [wireframeColor=0x00ff00]
 * @property {number} [boxColor=0xffff00]
 * @property {number} [axesSize=1]
 *
 * @param {THREE.Object3D} object3d - target whose geometry/bounds/axes are visualized.
 * @param {DebugVisualHelpersOptions} [options]
 * @returns {?{wireframe: THREE.LineSegments, box: THREE.BoxHelper, axes: THREE.AxesHelper}}
 *   the created helpers (all initially `.visible = false`), or `null` when
 *   DEBUG_ENABLED is false. Pass this into gui-utils.js's
 *   `addDebugVisualHelpersToggle()` to wire up on/off checkboxes on the
 *   project's shared lil-gui instance.
 */
export function debugAttachVisualHelpers(object3d, options = {}) {
    if (!DEBUG_ENABLED) return null;

    const { wireframeColor = 0x00ff00, boxColor = 0xffff00, axesSize = 1 } = options;

    let scene = object3d;
    while (scene && !scene.isScene) scene = scene.parent;
    if (!scene) {
        console.warn("[debug_utils] debugAttachVisualHelpers: no Scene ancestor found for object3d; falling back to object3d.parent");
        scene = object3d.parent;
    }

    // Must build BoxHelper before parenting wireframe/axes onto object3d —
    // it measures object3d's current children, and AxesHelper's asymmetric
    // geometry would skew the computed box off-center.
    const box = new THREE.BoxHelper(object3d, boxColor);
    box.visible = false;
    if (scene) scene.add(box);

    const wireframe = new THREE.LineSegments(
        new THREE.WireframeGeometry(object3d.geometry),
        new THREE.LineBasicMaterial({ color: wireframeColor })
    );
    wireframe.visible = false;
    object3d.add(wireframe);

    const axes = new THREE.AxesHelper(axesSize);
    axes.visible = false;
    object3d.add(axes);

    return { wireframe, box, axes };
}

/**
 * debugCreateMaterial(tslPropertyNode, options)
 *
 * Wraps `tslPropertyNode` in an unlit `THREE.MeshBasicNodeMaterial` so a raw
 * TSL property (normals, UVs, a uniform) reaches the screen unmodified,
 * instead of being distorted by a lit PBR material's roughness/lighting.
 * `options.channel` picks `colorNode` (default) or `emissiveNode` (for
 * borrowing the node into an existing lit material). Never clones
 * `tslPropertyNode` — safe to pass the same instance already wired
 * elsewhere, since TSL nodes aren't generally safe to deep-clone.
 *
 * @typedef {Object} DebugCreateMaterialOptions
 * @property {'color'|'emissive'} [channel='color'] - which *Node slot the
 *   given TSL node is wired into.
 *
 * @param {Object} tslPropertyNode - a TSL node to visualize directly on a
 *   mesh surface (e.g. normalWorld, a uv attribute, or a uniform()).
 * @param {DebugCreateMaterialOptions} [options]
 * @returns {?THREE.MeshBasicNodeMaterial} a ready-to-assign debug material,
 *   or `null` when DEBUG_ENABLED is false.
 */
export function debugCreateMaterial(tslPropertyNode, options = {}) {
    if (!DEBUG_ENABLED) return null;

    debugAssert(
        typeof tslPropertyNode?.isNode === "boolean",
        "debugCreateMaterial expected a TSL node (got a value with no .isNode flag)",
        tslPropertyNode
    );

    const { channel = "color" } = options;
    const material = new THREE.MeshBasicNodeMaterial();
    if (channel === "emissive") {
        material.emissiveNode = tslPropertyNode;
    } else {
        material.colorNode = tslPropertyNode;
    }
    return material;
}
