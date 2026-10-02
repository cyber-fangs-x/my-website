import * as THREE from "three/webgpu"
import { texture, vec2, float } from "three/tsl"

// colormap-utils.ts — colormaps for graphics scripts, defined in plain JS and
// read in shaders through a texture.
//
// A colormap is described by a *sampler*: a JS function from t in [0, 1]
// (cold → hot) to an sRGB color. createColormap() bakes a sampler into a
// small lookup texture, and shaders read it back with one colormap(x) call.
// Defining a new colormap (a different base color, a matplotlib map, ...)
// means writing or picking a sampler, never editing shader code or copying
// hex stops into a mix()/smoothstep() cascade.

/** sRGB components in 0..1: the same values a hex code or a matplotlib table holds. */
export type RGB = [number, number, number];

/** A colormap definition: t in [0, 1] (cold → hot) to an sRGB color. */
export type ColormapSampler = (t: number) => RGB;

/**
 * createColormap(sample, size)
 *
 * Why: a lookup texture turns any colormap into a single texture read in the
 * shader, however many color stops it has. Filtering between texels gives a
 * smooth, piecewise-linear ramp. Swapping colormaps only rewrites the
 * texture's data: the texture node in the shader graph stays the same, so no
 * material needs a shader rebuild (unlike swapping a colorNode).
 *
 * How:
 *   1. The sampler is evaluated at `size` evenly spaced t values into a
 *      size×1 RGBA8 DataTexture tagged SRGBColorSpace. The GPU decodes that
 *      format to linear itself (rgba8unorm-srgb on WebGPU, SRGB8_ALPHA8 on
 *      WebGL2), before filtering, so the shader gets linear colors with no
 *      color-space code of its own.
 *   2. colormap(x) maps x in [0, 1] onto texel *centers*: texel i sits at
 *      u = (i + 0.5) / size, so x = 0 and x = 1 land exactly on the first and
 *      last samples. x is clamped first, so out-of-range inputs saturate at
 *      the cold/hot ends.
 *   3. The read uses .level(0) (textureSampleLevel). A plain textureSample
 *      needs screen-space derivatives to pick a mip level, which WGSL only
 *      allows outside per-pixel branches; naming the level removes that limit,
 *      so colormap() is safe inside If/Loop. The texture has no mipmaps anyway.
 *
 * @param sample - the starting colormap
 * @param size - number of texels (samples) in the lookup texture
 * @returns colormap(x), which builds the TSL lookup for a float node x, and
 *   setColormap(sampler), which rewrites the texture with a different colormap
 */
export function createColormap(sample: ColormapSampler, size: number = 256) {
    const data = new Uint8Array(size * 4);
    const lut = new THREE.DataTexture(data, size, 1);  // RGBA8, ClampToEdge, no mipmaps
    lut.colorSpace = THREE.SRGBColorSpace;
    lut.magFilter = THREE.LinearFilter;                // DataTexture defaults to Nearest
    lut.minFilter = THREE.LinearFilter;

    function setColormap(next: ColormapSampler) {
        for (let i = 0; i < size; i++) {
            const rgb = next(i / (size - 1));
            for (let c = 0; c < 3; c++) data[4 * i + c] = Math.round(Math.min(Math.max(rgb[c], 0), 1) * 255);
            data[4 * i + 3] = 255;
        }
        lut.needsUpdate = true;  // re-upload the texels on the next render
    }
    setColormap(sample);

    const colormap = (x: any) =>
        texture(lut, vec2(float(x).clamp().mul((size - 1) / size).add(0.5 / size), 0.5)).level(0).rgb;

    return { colormap, setColormap };
}

/**
 * monochromeColormap(base, lightness)
 *
 * Why: tints and shades of one color, without picking every stop by hand:
 * pass a single base color and get a full dark → light ramp of its hue.
 *
 * How: keeps the base color's HSL hue and saturation and sweeps HSL lightness
 * from lightness[0] (t = 0) to lightness[1] (t = 1). In HSL, lightness below
 * 0.5 mixes the pure hue toward black (shades) and above 0.5 toward white
 * (tints). The sRGB color space is passed explicitly: three's Color HSL
 * methods default to the linear working space, but HSL is defined on sRGB
 * values.
 *
 * @param base - any color three.js accepts, e.g. 0x23d1f6 or '#23d1f6'
 * @param lightness - [darkest, lightest] HSL lightness at t = 0 and t = 1
 */
export function monochromeColormap(base: number | string, lightness: [number, number] = [0.3, 0.85]): ColormapSampler {
    const hsl = { h: 0, s: 0, l: 0 };
    new THREE.Color(base).getHSL(hsl, THREE.SRGBColorSpace);
    const [dark, light] = lightness;
    const out = new THREE.Color();
    const rgb = { r: 0, g: 0, b: 0 };
    return (t) => {
        out.setHSL(hsl.h, hsl.s, dark + t * (light - dark), THREE.SRGBColorSpace).getRGB(rgb, THREE.SRGBColorSpace);
        return [rgb.r, rgb.g, rgb.b];
    };
}

/**
 * gradientColormap(stops)
 *
 * Why: a hand-designed colormap (e.g. a physical look like glowing metal)
 * is easiest to describe as a few colors at chosen points, not as a formula.
 *
 * How: `stops` is a list of [t, color] pairs in increasing t; the first must
 * be at t = 0 and the last at t = 1. Between two stops the color is
 * interpolated linearly in sRGB, the space the hex codes were picked in, so
 * the midpoint of two stops looks like the color you'd mix by eye.
 *
 * @param stops - [t, color] pairs; color is anything three.js accepts, e.g. 0x5a5e64
 */
export function gradientColormap(stops: [number, number | string][]): ColormapSampler {
    const points = stops.map(([t, c]) => {
        const rgb = { r: 0, g: 0, b: 0 };
        new THREE.Color(c).getRGB(rgb, THREE.SRGBColorSpace);
        return { t, rgb: [rgb.r, rgb.g, rgb.b] as RGB };
    });
    return (t) => {
        let i = 1;
        while (i < points.length - 1 && t > points[i].t) i++;
        const a = points[i - 1], b = points[i];
        const s = Math.min(Math.max((t - a.t) / (b.t - a.t), 0), 1);
        return [0, 1, 2].map(ch => a.rgb[ch] + s * (b.rgb[ch] - a.rgb[ch])) as RGB;
    };
}

// Polynomial coefficients c0..c6, each [r, g, b], of Matt Zucker's CC0 fit to
// matplotlib's viridis (shadertoy.com/view/WlfXRN).
const VIRIDIS = [
    [0.2777273272234177, 0.005407344544966578, 0.3340998053353061],
    [0.1050930431085774, 1.404613529898575, 1.384590162594685],
    [-0.3308618287255563, 0.214847559468213, 0.09509516302823659],
    [-4.634230498983486, -5.799100973351585, -19.33244095627987],
    [6.228269936347081, 14.17993336680509, 56.69055260068105],
    [4.776384997670288, -13.74514537774601, -65.35303263337234],
    [-5.435455855934631, 4.645852612178535, 26.3124352495832],
];

/**
 * viridisColormap(t)
 *
 * Why: viridis is designed so that equal steps in t look like equal steps in
 * brightness, and it stays readable in grayscale and for common color-vision
 * deficiencies. An HSL lightness sweep (monochromeColormap) is monotonic but
 * not perceptually even.
 *
 * How: evaluates a degree-6 polynomial per channel instead of embedding
 * matplotlib's 256-row table. It is within 0.017 (about 4 of 255 levels) of
 * viridis's reference stops #440154, #3b528b, #21918c, #5ec962, #fde725.
 * Horner's method, c0 + t(c1 + t(c2 + ...)), is 6 multiply-adds per channel
 * and avoids computing large powers of t.
 */
export function viridisColormap(t: number): RGB {
    return [0, 1, 2].map(ch => VIRIDIS.reduceRight((acc, c) => acc * t + c[ch], 0)) as RGB;
}
