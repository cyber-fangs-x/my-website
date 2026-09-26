// worker-lib-loader.ts — loads a vendored classic-script (non-ESM) library
// inside a Web Worker, where utils/asset-loader.ts's DOM-based script-tag
// injection (document.createElement('script')) can't run at all — a worker
// has no `document`.
//
// The natural-looking substitute, importScripts(url, ...), doesn't work
// either for any worker constructed with `{ type: 'module' }`: Vite's dev
// server always serves a `new Worker(new URL(...), import.meta.url)` target
// as a genuine ES module worker (regardless of the eventual production
// build's worker.format setting), and importScripts() is spec-forbidden
// inside a module-type worker. A classic (non-module) worker would dodge
// that, but then can't use `import`/`export` TS syntax reliably under
// Vite's dev server — so module workers are the only option that's
// guaranteed to work the same way in both `npm run dev` and a production
// build, which rules out importScripts() entirely.
//
// The fix used here: fetch every vendored file's source as plain text,
// concatenate them into ONE script, and run that with a single *indirect*
// eval — `(0, eval)(combined)`. This has to be one eval call over the
// concatenation, not one eval call per file: per spec
// (EvalDeclarationInstantiation), each individual eval() call gets its own
// fresh, throwaway lexical environment for top-level `let`/`const`/`class`
// declarations, discarded as soon as that eval call returns — unlike
// separate classic <script> tags, which all install their top-level class
// declarations into the realm's one persistent Global Declarative
// Environment and so can see each other's bare identifiers indefinitely.
// (This was verified the hard way: evaluating mean-curvature-flow.js and
// modified-mean-curvature-flow.js via two separate eval() calls threw
// "MeanCurvatureFlow is not defined" on the second one, since the class
// declared by the first eval's lexical environment was already gone.)
// Concatenating first means every vendored class lives in the SAME shared
// lexical environment for the one eval call, so cross-file bare references
// (ModifiedMeanCurvatureFlow extends MeanCurvatureFlow, Geometry's methods
// calling SparseMatrix, dense-matrix.js's bare `memoryManager` global, ...)
// resolve correctly via closure — the same behavior separate <script> tags
// give you on the main thread, just reached a different way here.
//
// One remaining wrinkle: like `window.Mesh` on the main thread (see
// asset-loader.ts's header comment), nothing declared via `class`/`let`/
// `const` inside the eval becomes a `self.X` property automatically, so a
// bridging line is appended to the SAME combined source — `self.__bridge =
// { ...names }` — which, being part of that one eval call, can still see
// those bare identifiers, and assigns them onto `self` where this worker's
// own (separately-scoped, bundled ES module) code can finally read them.

/**
 * loadClassicScriptBundleInWorker(urls, exposeNames)
 *
 * Fetches every URL in `urls` (in parallel; order is still preserved for
 * concatenation) and evals them together as one script, in the given order
 * — dependency order matters here exactly as it does for asset-loader.ts's
 * loadScriptsInOrder(), since e.g. a vendored `class X extends Y` needs Y's
 * declaration to appear earlier in the combined source.
 *
 * @param urls - absolute or site-root-relative script URLs, in load order.
 * @param exposeNames - bare identifiers (e.g. class names) declared
 *   somewhere in those files that the caller needs back.
 * @returns an object with one property per name in `exposeNames`.
 */
export async function loadClassicScriptBundleInWorker(
    urls: string[],
    exposeNames: string[],
): Promise<Record<string, any>> {
    const sources = await Promise.all(urls.map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`worker-lib-loader: failed to fetch "${url}" (${response.status} ${response.statusText})`);
        }
        return response.text();
    }));

    // Joined with a leading `;` on each piece as a defensive separator
    // against ASI hazards at file boundaries (e.g. one file ending in an
    // expression that could otherwise be parsed as calling into the next).
    const bridgeLine = `self.__workerLibBridge = { ${exposeNames.join(', ')} };`;
    const combined = sources.map((src) => `;\n${src}\n`).join('') + bridgeLine;
    (0, eval)(combined);

    const bridged = (self as any).__workerLibBridge;
    delete (self as any).__workerLibBridge;
    return bridged;
}
