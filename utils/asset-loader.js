import * as THREE from "three/webgpu"

// asset-loader.js — turns an .obj file into the two structures a discrete-
// differential-geometry graphics script needs, kept index-aligned with each
// other: a renderable THREE.Mesh, and the vendored geometry-processing-js
// library's halfedge Mesh + Geometry (see public/lib/geometry-processing-js-
// master/). This file only instantiates those objects — it never wraps them
// in anything new, so a script gets the real THREE.Mesh/Mesh/Geometry
// instances to build TSL shaders and DDG algorithms directly against.
//
// The geometry-processing-js files under public/lib/... are plain classic
// scripts with no `export` statements — they were written to run as a
// sequence of <script> tags sharing one global scope, not as ES modules.
// That's why this file can't `import` Mesh/Geometry/MeshIO the normal way,
// and instead injects those <script> tags itself at runtime, via
// loadGeometryProcessingLib() below.
//
// One wrinkle that isn't obvious up front: `class Mesh {...}` etc. are
// top-level `class` declarations, and — unlike `var` or `function`
// declarations — a top-level `class`/`let`/`const` in a classic script does
// NOT become a `window` property. It creates a binding in the shared
// global *scope*, so any later classic <script> can reference the bare
// identifier `Mesh` directly (that's how the vendored library's own demo
// pages use it), but `window.Mesh` is still `undefined`. An ES module (this
// file included) has no access to that shared global scope at all — only
// to real properties on `window` — so reading `window.Mesh` right after
// injecting the scripts doesn't work. bridgeGlobals() below is the fix: one
// more tiny inline classic <script>, injected after the rest, that does
// `window.__bridge = { Mesh, Geometry, MeshIO }` — being a classic script
// itself, it can see those bare identifiers, and assigning them onto
// `window` finally makes them real properties this module can read.
// loadGeometryProcessingLib() and loadLinearAlgebraLib() are the only two
// places in this file that ever touch `window` — every other function
// below gets its classes as an ordinary local value from one of them, so
// this global-scope wrinkle stays contained to those two functions.

const GP_LIB_BASE = `${import.meta.env.BASE_URL}lib/geometry-processing-js-master/`;

// Loads one classic <script> and resolves once it has run (or rejects on a
// network/parse error). Scripts are awaited one at a time by the callers
// below rather than fired off in parallel, so dependency order between
// files (e.g. core/mesh.js referencing the bare `Vertex`/`Edge`/... globals
// core/vertex.js etc. define) is always respected.
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`asset-loader: failed to load script "${src}"`));
        document.head.appendChild(script);
    });
}

async function loadScriptsInOrder(paths) {
    for (const path of paths) {
        await loadScript(GP_LIB_BASE + path);
    }
}

// See the file header comment for why this is needed: top-level `class`
// declarations in the classic scripts above never become `window`
// properties, so this bridges the requested names onto `window` via one
// more inline classic script that *can* see them as bare identifiers. Runs
// synchronously — an inline script (no `src`) executes immediately when
// inserted, so the bridged values are readable right after appendChild.
function bridgeGlobals(names) {
    const script = document.createElement('script');
    script.textContent = `window.__gpLibBridge = { ${names.join(', ')} };`;
    document.head.appendChild(script);
    const bridged = window.__gpLibBridge;
    delete window.__gpLibBridge;
    document.head.removeChild(script);
    return bridged;
}

let geometryProcessingLibPromise = null;

/**
 * loadGeometryProcessingLib()
 *
 * Idempotent: the first call injects the 9 vendored <script> tags this
 * loader needs (linear-algebra/vector.js, the core/*.js halfedge classes,
 * and utils/meshio.js) in dependency order and caches the resulting
 * promise; every later call — from this file or from a graphics script —
 * just awaits that same cached, already-resolved promise instead of
 * re-injecting anything. Safe to call as many times as needed.
 *
 * Only the classes this loader actually uses are loaded — Geometry's
 * laplaceMatrix()/massMatrix()/complexLaplaceMatrix() reference further
 * globals (SparseMatrix, Triplet, Complex, ...) inside their own method
 * bodies, but since this loader never calls those methods, that heavier
 * dependency chain is left to loadLinearAlgebraLib() (below) instead.
 *
 * @returns {Promise<{Mesh: Function, Geometry: Function, MeshIO: Object}>}
 *   the vendored library's classes, read off `window` once its scripts
 *   have run.
 */
export function loadGeometryProcessingLib() {
    if (!geometryProcessingLibPromise) {
        geometryProcessingLibPromise = loadScriptsInOrder([
            'linear-algebra/vector.js',
            'core/vertex.js',
            'core/edge.js',
            'core/face.js',
            'core/halfedge.js',
            'core/corner.js',
            'core/mesh.js',
            'core/geometry.js',
            'utils/meshio.js',
        ]).then(() => bridgeGlobals(['Mesh', 'Geometry', 'MeshIO']));
    }
    return geometryProcessingLibPromise;
}

let linearAlgebraLibPromise = null;

/**
 * loadLinearAlgebraLib()
 *
 * Idempotent, same pattern as loadGeometryProcessingLib() — but for the
 * separate, heavier dependency chain behind Geometry's laplaceMatrix()/
 * massMatrix()/complexLaplaceMatrix(): an Emscripten/asm.js-compiled
 * sparse-linear-algebra engine (linear-algebra-asm.js, which defines the
 * global `Module` those methods call into), plus the DenseMatrix/
 * SparseMatrix/Complex/ComplexSparseMatrix wrapper classes built on it.
 *
 * Not called by loadObjAsset() by default — only call this (directly, or
 * via loadObjAsset's `options.linearAlgebra`) from a script that actually
 * needs Laplacian-style matrix math. One thing this loader deliberately
 * does *not* set up: DenseMatrix/SparseMatrix/Complex constructors all
 * reference a bare `memoryManager` global (see emscripten-memory-manager.js)
 * that the *calling script* must create itself — e.g.
 * `window.memoryManager = new EmscriptenMemoryManager();` — and later call
 * `memoryManager.deleteExcept([...])` on to free heap-allocated matrices,
 * since the JS garbage collector can't reach them. That lifecycle is
 * algorithm-specific (which matrices to keep alive, and when to free the
 * rest), so it belongs in each algorithm script, not in a generic loader.
 *
 * @returns {Promise<{DenseMatrix: Function, SparseMatrix: Function,
 *   Triplet: Function, Complex: Function, ComplexSparseMatrix: Function,
 *   ComplexTriplet: Function, EmscriptenMemoryManager: Function}>}
 */
export function loadLinearAlgebraLib() {
    if (!linearAlgebraLibPromise) {
        linearAlgebraLibPromise = loadScriptsInOrder([
            'linear-algebra/linear-algebra-asm.js',
            'linear-algebra/emscripten-memory-manager.js',
            'linear-algebra/dense-matrix.js',
            'linear-algebra/sparse-matrix.js',
            'linear-algebra/complex.js',
            'linear-algebra/complex-sparse-matrix.js',
        ]).then(() => bridgeGlobals([
            'DenseMatrix', 'SparseMatrix', 'Triplet',
            'Complex', 'ComplexSparseMatrix', 'ComplexTriplet',
            'EmscriptenMemoryManager',
        ]));
    }
    return linearAlgebraLibPromise;
}

/**
 * fetchObjText(filepath)
 *
 * Fetches the raw text of an .obj file. `filepath` is resolved against
 * `import.meta.env.BASE_URL` (Vite's configured site-root prefix — '/' in
 * dev, '/my-website/' in the GitHub Pages build) rather than the calling
 * page's own URL, so the same relative path (e.g. 'assets/bunny.obj') works
 * identically no matter which page a graphics script runs on, and survives
 * `npm run build` unchanged as long as the file lives under public/.
 *
 * @param {string} filepath - path under the site root, e.g. 'assets/bunny.obj'.
 * @returns {Promise<string>} the file's contents.
 */
export async function fetchObjText(filepath) {
    const url = import.meta.env.BASE_URL + filepath;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`asset-loader: failed to fetch "${url}" (${response.status} ${response.statusText})`);
    }
    return response.text();
}

/**
 * parsePolygonSoup(objText)
 *
 * Thin call to MeshIO.readOBJ(), which turns raw .obj text into a "polygon
 * soup" — `{ v: Vector[], f: number[] }`, a flat 0-indexed triangle list.
 * Only triangulated meshes are supported; the library itself only reports
 * that failure via a browser `alert()` and returns `undefined`, so this
 * turns that into a real, catchable Error instead.
 *
 * @param {string} objText
 * @returns {Promise<{v: Object[], f: number[]}>} the polygon soup.
 */
export async function parsePolygonSoup(objText) {
    const { MeshIO } = await loadGeometryProcessingLib();
    const polygonSoup = MeshIO.readOBJ(objText);
    if (!polygonSoup) {
        throw new Error('asset-loader: MeshIO.readOBJ() failed to parse this .obj text — only triangulated meshes are supported.');
    }
    return polygonSoup;
}

/**
 * buildGpMesh(polygonSoup)
 *
 * Builds geometry-processing-js's halfedge Mesh — pure connectivity
 * (vertices/edges/faces/halfedges/corners and how they link), with no
 * coordinates at all. On success every element gets a 0-based `.index`,
 * which is what keeps this mesh, its eventual Geometry, and the THREE.Mesh
 * built from them all aligned to the same vertex/face numbering.
 *
 * @param {{v: Object[], f: number[]}} polygonSoup
 * @returns {Promise<Object>} the built Mesh instance.
 */
export async function buildGpMesh(polygonSoup) {
    const { Mesh } = await loadGeometryProcessingLib();
    const gpMesh = new Mesh();
    const ok = gpMesh.build(polygonSoup);
    if (!ok) {
        throw new Error('asset-loader: Mesh.build() failed — not a valid manifold mesh (non-manifold or isolated vertices/faces).');
    }
    return gpMesh;
}

/**
 * buildGpGeometry(gpMesh, polygonSoup, normalizePositions)
 *
 * Builds geometry-processing-js's Geometry — the geometric realization laid
 * on top of a built Mesh, holding actual vertex positions and every method
 * that needs them (lengths, areas, normals, curvatures, Laplacians). Kept
 * separate from Mesh because a Mesh's combinatorics don't need positions at
 * all, and (elsewhere in the library) the same Mesh can carry more than one
 * Geometry — e.g. a second, flattened (u,v) one.
 *
 * When `normalizePositions` is true (the library's own default), the
 * constructor re-centers and rescales `polygonSoup.v`'s Vector objects *in
 * place* to fit a unit sphere — buildThreeMesh() below must run after this,
 * reading positions from `gpGeometry.positions`, never `polygonSoup.v`
 * directly, so it always sees the final, post-normalization coordinates.
 *
 * @param {Object} gpMesh - a Mesh already built via buildGpMesh().
 * @param {{v: Object[], f: number[]}} polygonSoup - the same polygon soup gpMesh was built from.
 * @param {boolean} [normalizePositions=true]
 * @returns {Promise<Object>} the built Geometry instance.
 */
export async function buildGpGeometry(gpMesh, polygonSoup, normalizePositions = true) {
    const { Geometry } = await loadGeometryProcessingLib();
    return new Geometry(gpMesh, polygonSoup.v, normalizePositions);
}

/**
 * buildThreeMesh(gpMesh, gpGeometry)
 *
 * Builds a plain THREE.Mesh from gpMesh/gpGeometry: one position per vertex
 * (from `gpGeometry.positions[v]`, written at that vertex's `.index` so the
 * buffer offsets line up with gpMesh.vertices/gpGeometry.positions), one
 * triangle per face (from `f.adjacentVertices()`), and normals computed by
 * three's own `computeVertexNormals()` — not a geometry-processing-js
 * normal formula, so this step stays independent of whichever discrete
 * normal convention (equally-weighted, area-weighted, ...) an algorithm
 * script wants to study or compare against later.
 *
 * No material is assigned — this project's materials are always an
 * explicit TSL `*NodeMaterial` graph (see cube.js), which the calling
 * script builds and assigns itself; a generic loader has no business
 * guessing one.
 *
 * @param {Object} gpMesh - a Mesh already built via buildGpMesh().
 * @param {Object} gpGeometry - a Geometry already built via buildGpGeometry() for gpMesh.
 * @returns {THREE.Mesh}
 */
export function buildThreeMesh(gpMesh, gpGeometry) {
    const vertexCount = gpMesh.vertices.length;
    const positions = new Float32Array(vertexCount * 3);
    for (const v of gpMesh.vertices) {
        const p = gpGeometry.positions[v];
        positions[3 * v.index + 0] = p.x;
        positions[3 * v.index + 1] = p.y;
        positions[3 * v.index + 2] = p.z;
    }

    const faceCount = gpMesh.faces.length;
    const indices = new Uint32Array(faceCount * 3);
    for (const f of gpMesh.faces) {
        let i = 0;
        for (const v of f.adjacentVertices()) {
            indices[3 * f.index + i] = v.index;
            i++;
        }
    }

    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    bufferGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
    bufferGeometry.computeVertexNormals();

    return new THREE.Mesh(bufferGeometry);
}

/**
 * loadObjAsset(filepath, options)
 *
 * The master function: loads an .obj file and builds every structure a
 * graphics script needs from it, in as few lines as this file can manage:
 *
 *   const { threeMesh, gpMesh, gpGeometry } = await loadObjAsset('assets/bunny.obj');
 *
 * Internally this is just steps 1-6 above run in the order their data
 * dependencies require (fetch → parse → build Mesh → build Geometry →
 * build THREE.Mesh) — call the individual functions directly instead if a
 * script only needs one step, or needs to re-run just one of them.
 *
 * @param {string} filepath - path under the site root, e.g. 'assets/bunny.obj'.
 * @param {Object} [options]
 * @param {boolean} [options.normalizePositions=true] - forwarded to buildGpGeometry().
 * @param {boolean} [options.linearAlgebra=false] - also await loadLinearAlgebraLib()
 *   before returning, for a script that will call gpGeometry.laplaceMatrix()/
 *   massMatrix()/complexLaplaceMatrix().
 * @returns {Promise<{threeMesh: THREE.Mesh, gpMesh: Object, gpGeometry: Object,
 *   polygonSoup: {v: Object[], f: number[]}}>}
 */
export async function loadObjAsset(filepath, options = {}) {
    const { normalizePositions = true, linearAlgebra = false } = options;

    await loadGeometryProcessingLib();
    if (linearAlgebra) await loadLinearAlgebraLib();

    const objText = await fetchObjText(filepath);
    const polygonSoup = await parsePolygonSoup(objText);
    const gpMesh = await buildGpMesh(polygonSoup);
    const gpGeometry = await buildGpGeometry(gpMesh, polygonSoup, normalizePositions);
    const threeMesh = buildThreeMesh(gpMesh, gpGeometry);

    return { threeMesh, gpMesh, gpGeometry, polygonSoup };
}
