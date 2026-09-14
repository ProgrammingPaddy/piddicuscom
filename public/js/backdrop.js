/**
 * Ambient background: a lava-lamp wash and a sparse fall of petals.
 *
 * The lava lamp is a small canvas (a quarter of the viewport, scaled up by
 * CSS) painted as metaballs: solid blobs with defined edges that stretch,
 * merge and pinch apart as the masses wander on overlapping sine paths. It
 * redraws at a capped frame rate and only while the tab is visible.
 *
 * Under reduced motion a single frame is drawn and nothing moves.
 */

const LAVA = {
    scale: 0.25,              // canvas pixels per CSS pixel
    frameInterval: 1000 / 24,
    speed: 0.00009,           // radians per millisecond, base drift rate
    threshold: 1,             // field level that counts as "inside"
    edge: 0.05,               // antialias band either side of the threshold
    alpha: 0.9,               // pixel alpha inside a blob (canvas opacity is CSS)
    rim: 0.3,                 // how much brighter the edge is than the middle
    masses: [
        { color: [254, 198, 217], radius: 0.17, cx: 0.22, cy: 0.32, ax: 0.16, ay: 0.16, f1: 1.00, f2: 0.63, p: 0.0 },
        { color: [188, 122, 128], radius: 0.19, cx: 0.78, cy: 0.70, ax: 0.18, ay: 0.14, f1: 0.71, f2: 1.13, p: 1.7 },
        { color: [254, 198, 217], radius: 0.13, cx: 0.66, cy: 0.20, ax: 0.14, ay: 0.20, f1: 0.87, f2: 0.52, p: 3.1 },
        { color: [214, 190, 255], radius: 0.11, cx: 0.42, cy: 0.80, ax: 0.22, ay: 0.12, f1: 0.58, f2: 0.94, p: 4.4 },
        { color: [188, 122, 128], radius: 0.13, cx: 0.10, cy: 0.84, ax: 0.12, ay: 0.16, f1: 1.21, f2: 0.77, p: 5.6 },
        { color: [254, 198, 217], radius: 0.10, cx: 0.50, cy: 0.50, ax: 0.26, ay: 0.22, f1: 0.49, f2: 1.31, p: 2.3 },
    ],
};

const PETAL_COUNT = 10;
const SEED = 7;

/* Helpers ----------------------------------------------------------------- */

/** Small deterministic PRNG (mulberry32), returns numbers in [0, 1). */
function createRandom(seed) {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function setVars(node, vars) {
    for (const [key, value] of Object.entries(vars)) {
        node.style.setProperty(`--${key}`, value);
    }
}

/* Lava lamp --------------------------------------------------------------- */

/**
 * Metaballs. Every pixel sums the influence of each mass (radius squared
 * over distance squared); pixels above the threshold are painted, with a
 * thin smoothed band at the isoline. Colour is the influence-weighted mix
 * of the masses touching that pixel, so blobs blend where they merge.
 */
function initLava(canvas, animate) {
    const context = canvas.getContext("2d", { alpha: true });
    let width = 0;
    let height = 0;
    let image = null;
    let pixels = null;
    let lastDraw = 0;
    let lastTime = 0;

    function resize() {
        width = Math.max(16, Math.round(window.innerWidth * LAVA.scale));
        height = Math.max(16, Math.round(window.innerHeight * LAVA.scale));
        canvas.width = width;
        canvas.height = height;
        image = context.createImageData(width, height);
        pixels = new Uint32Array(image.data.buffer);
    }

    function positions(time) {
        const t = time * LAVA.speed;
        const span = Math.min(width, height);

        return LAVA.masses.map((mass) => {
            /* Two sines per axis at unrelated frequencies: never repeats
               visibly, never looks mechanical. The radius breathes a little. */
            const x = mass.cx + mass.ax * Math.sin(t * mass.f1 + mass.p) + mass.ax * 0.5 * Math.sin(t * mass.f2 * 1.7 + mass.p * 2);
            const y = mass.cy + mass.ay * Math.sin(t * mass.f2 + mass.p * 1.3) + mass.ay * 0.5 * Math.sin(t * mass.f1 * 1.3 + mass.p);
            const radius = mass.radius * span * (1 + 0.1 * Math.sin(t * 0.9 + mass.p));

            return { x: x * width, y: y * height, r2: radius * radius, color: mass.color };
        });
    }

    function draw(time) {
        lastTime = time;
        const masses = positions(time);
        const count = masses.length;
        const low = LAVA.threshold * (1 - LAVA.edge);
        const high = LAVA.threshold * (1 + LAVA.edge);
        const band = high - low;
        const skipBelow = low * 0.5;

        let index = 0;

        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                let field = 0;
                let red = 0;
                let green = 0;
                let blue = 0;

                for (let i = 0; i < count; i += 1) {
                    const mass = masses[i];
                    const dx = x - mass.x;
                    const dy = y - mass.y;
                    const influence = mass.r2 / (dx * dx + dy * dy + 1);

                    field += influence;
                    red += influence * mass.color[0];
                    green += influence * mass.color[1];
                    blue += influence * mass.color[2];
                }

                if (field < skipBelow) {
                    pixels[index] = 0;
                    index += 1;
                    continue;
                }

                /* Smoothstep across the band around the threshold. */
                let coverage = (field - low) / band;
                coverage = coverage < 0 ? 0 : coverage > 1 ? 1 : coverage;
                coverage = coverage * coverage * (3 - 2 * coverage);

                if (coverage === 0) {
                    pixels[index] = 0;
                    index += 1;
                    continue;
                }

                /* Brighter towards the edge, like light through the rim. */
                let depth = (field - LAVA.threshold) / LAVA.threshold;
                depth = depth < 0 ? 0 : depth > 1 ? 1 : depth;
                const glow = (1 + LAVA.rim * (1 - depth)) / field;

                const r = Math.min(255, red * glow) | 0;
                const g = Math.min(255, green * glow) | 0;
                const b = Math.min(255, blue * glow) | 0;
                const a = (coverage * LAVA.alpha * 255) | 0;

                pixels[index] = (a << 24) | (b << 16) | (g << 8) | r;
                index += 1;
            }
        }

        context.putImageData(image, 0, 0);
    }

    function frame(now) {
        if (now - lastDraw >= LAVA.frameInterval) {
            lastDraw = now;
            draw(now);
        }

        requestAnimationFrame(frame);
    }

    resize();
    draw(0);

    /* Resizing clears the canvas, so repaint at once rather than showing a
       stretched stale frame until the next animation frame. */
    window.addEventListener("resize", () => {
        resize();
        draw(lastTime);
    }, { passive: true });

    if (animate) {
        requestAnimationFrame(frame);
    }
}

/* Petals ------------------------------------------------------------------ */

function createPetal(random) {
    const petal = document.createElement("div");
    petal.className = "petal";

    setVars(petal, {
        x: `${(random() * 100).toFixed(1)}vw`,
        size: `${(6 + random() * 7).toFixed(0)}px`,
        fall: `${(22 + random() * 16).toFixed(1)}s`,
        sway: `${(3 + random() * 3).toFixed(1)}s`,
        delay: `${(-random() * 38).toFixed(1)}s`,
        alpha: (0.3 + random() * 0.3).toFixed(2),
        spin: `${(random() > 0.5 ? 1 : -1) * (360 + random() * 360).toFixed(0)}deg`,
    });

    return petal;
}

/* Bootstrap --------------------------------------------------------------- */

function init() {
    const canvas = document.querySelector(".backdrop__lava");
    const petalHost = document.querySelector(".backdrop__petals");

    if (!canvas || !petalHost) {
        return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    initLava(canvas, !reducedMotion);

    if (!reducedMotion) {
        const random = createRandom(SEED);
        petalHost.append(...Array.from({ length: PETAL_COUNT }, () => createPetal(random)));
    }
}

init();
