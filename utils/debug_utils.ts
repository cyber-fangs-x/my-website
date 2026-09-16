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
 * @param condition - value coerced to boolean; falsy triggers the assertion.
 * @param message - human-readable description of the violated invariant.
 * @param data - arbitrary extra values logged via console.error for
 *   debugging context before the Error is thrown.
 * @throws when `condition` is falsy and DEBUG_ENABLED is true.
 */
export function debugAssert(condition: unknown, message: string, ...data: unknown[]): void {
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
 * @param rootObject - root of the hierarchy to print; itself included.
 *   Untyped (`any`): three ships no types for three/webgpu (see
 *   types/three-shims.d.ts).
 */
export function debugPrintSceneGraph(rootObject: any): void {
    if (!DEBUG_ENABLED) return;
    if (rootObject == null) {
        console.warn("[debug_utils] debugPrintSceneGraph: rootObject is null/undefined");
        return;
    }

    const printNode = (object: any, depth: number) => {
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

/** Options accepted by {@link debugPrintTSLNode}. */
export interface DebugPrintTSLNodeOptions {
    /** maximum child-node recursion depth. @default 3 */
    maxDepth?: number;
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
 * @param tslNode - a TSL node instance (e.g. from uniform(), color(),
 *   Fn(), or any composed node graph). Duck-typed, not type-checked
 *   (`any`), since TSL nodes don't share one common exported base class to
 *   import here — see types/three-shims.d.ts.
 */
export function debugPrintTSLNode(tslNode: any, options: DebugPrintTSLNodeOptions = {}): void {
    if (!DEBUG_ENABLED) return;
    if (tslNode == null) {
        console.warn("[debug_utils] debugPrintTSLNode: tslNode is null/undefined");
        return;
    }

    const { maxDepth = 3 } = options;
    const visited = new Set<string>();

    const describe = (node: any): string => {
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
        } catch (err: any) {
            return `<unreadable node: ${err.message}>`;
        }
    };

    const printNode = (node: any, depth: number) => {
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

/** Options accepted by {@link debugAttachVisualHelpers}. */
export interface DebugVisualHelpersOptions {
    wireframeColor?: number;
    boxColor?: number;
    axesSize?: number;
}

/**
 * The three visual-debug helpers built by {@link debugAttachVisualHelpers}.
 * Untyped (`any` members): the real runtime types are THREE.LineSegments/
 * BoxHelper/AxesHelper, but three ships no types for three/webgpu at all
 * (see types/three-shims.d.ts) — `THREE.LineSegments` can't be used as a
 * type annotation when the `THREE` import itself resolves to `any`.
 */
export interface DebugVisualHelpers {
    wireframe: any;
    box: any;
    axes: any;
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
 * @param object3d - target whose geometry/bounds/axes are visualized.
 *   Untyped (`any`): three ships no types for three/webgpu (see
 *   types/three-shims.d.ts).
 * @returns the created helpers (all initially `.visible = false`), or
 *   `null` when DEBUG_ENABLED is false. Pass this into gui-utils.js's
 *   `addDebugVisualHelpersToggle()` to wire up on/off checkboxes on the
 *   project's shared lil-gui instance.
 */
export function debugAttachVisualHelpers(
    object3d: any,
    options: DebugVisualHelpersOptions = {},
): DebugVisualHelpers | null {
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

/** Options accepted by {@link debugCreateMaterial}. */
export interface DebugCreateMaterialOptions {
    /** which *Node slot the given TSL node is wired into. @default "color" */
    channel?: "color" | "emissive";
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
 * @param tslPropertyNode - a TSL node to visualize directly on a mesh
 *   surface (e.g. normalWorld, a uv attribute, or a uniform()). Untyped
 *   (`any`) — see types/three-shims.d.ts.
 * @returns a ready-to-assign debug material, or `null` when DEBUG_ENABLED
 *   is false.
 */
export function debugCreateMaterial(
    tslPropertyNode: any,
    options: DebugCreateMaterialOptions = {},
): any {
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
