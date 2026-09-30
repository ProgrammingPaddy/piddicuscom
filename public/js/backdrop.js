/**
 * Ambient background: a canvas scene chosen by the theme, and a sparse fall
 * of petals (or whatever the theme makes of them).
 *
 * Scenes, picked by the --backdrop-scene token:
 *
 *   lava    A lava-lamp wash: metaballs with defined edges that stretch,
 *           merge and pinch apart as the masses wander. Colours are the
 *           --lava-1..3 tokens.
 *   forge   A pour seen close up: streams of molten metal fall in from
 *           above on gentle curves, glowing gold with bright runs and thin
 *           filaments along them, throwing light and sparks; each in turn
 *           stops flowing and cools to dull bronze from the top down, and
 *           when all have set the pour fades and another begins. The metal
 *           is painted on a half-resolution layer and its light on a much
 *           smaller one, both scaled up (which turns stepped strokes into
 *           smooth gradients); only the fine detail is drawn at full
 *           size. Colours are the --forge-* tokens.
 *   wave    Inside the barrel of a wave, looking out along it to the point
 *           where the wave's bottom and top meet by the horizon; through
 *           the open side lie sky, sun, a distant island and calm sea.
 *           Water climbs the face and goes over, foam clings to the lip,
 *           and a surfer rides the face who can be picked up and thrown.
 *           Colours are the --wave-* tokens.
 *
 * Both paint a canvas that CSS stretches over the viewport (the lava lamp
 * at half resolution, being per-pixel work), redraw at a capped frame rate
 * and only while the tab is visible, and read their
 * tokens again on a theme change. Under reduced motion one still frame is
 * drawn: the lava at rest, the forge with its cast cooling.
 */

const LAVA = {
    scale: 0.5,               // canvas pixels per CSS pixel
    interval: 1000 / 20,      // ms between frames
    speed: 0.00009,           // radians per millisecond, base drift rate
    threshold: 1,             // field level that counts as "inside"
    edge: 0.05,               // antialias band either side of the threshold
    alpha: 0.9,               // pixel alpha inside a blob (canvas opacity is CSS)
    rim: 0.3,                 // how much brighter the edge is than the middle
    tones: 3,                 // number of --lava-N colour tokens
    masses: [
        { tone: 1, radius: 0.17, cx: 0.22, cy: 0.32, ax: 0.16, ay: 0.16, f1: 1.00, f2: 0.63, p: 0.0 },
        { tone: 2, radius: 0.19, cx: 0.78, cy: 0.70, ax: 0.18, ay: 0.14, f1: 0.71, f2: 1.13, p: 1.7 },
        { tone: 1, radius: 0.13, cx: 0.66, cy: 0.20, ax: 0.14, ay: 0.20, f1: 0.87, f2: 0.52, p: 3.1 },
        { tone: 3, radius: 0.11, cx: 0.42, cy: 0.80, ax: 0.22, ay: 0.12, f1: 0.58, f2: 0.94, p: 4.4 },
        { tone: 2, radius: 0.13, cx: 0.10, cy: 0.84, ax: 0.12, ay: 0.16, f1: 1.21, f2: 0.77, p: 5.6 },
        { tone: 1, radius: 0.10, cx: 0.50, cy: 0.50, ax: 0.26, ay: 0.22, f1: 0.49, f2: 1.31, p: 2.3 },
    ],
};

const FORGE = {
    speed: 150,               // CSS px per second the molten front travels
    stagger: 5,               // seconds between one stream starting and the next
    flow: 12,                 // seconds (roughly) a stream keeps flowing once it is full
    heat: 60,                 // seconds from liquid to cast after a stream's flow stops
    lag: 8,                   // seconds the foot of a stream lags the head in cooling
    stops: [0, 8, 26, 60],    // ages (s) of the hot, glow, ember and cast colours
    bloom: 7,                 // strokes in the light falloff around a stream
    glowScale: 1 / 8,         // the glow layer's resolution, relative to CSS px
    body: [[1.5, 0.14], [1.3, 0.22], [1.12, 0.35], [0.95, 0.75]],   // [width factor, alpha] per body stroke
    core: [[0.5, 0.5], [0.26, 0.9]],                                // the white-hot middle, same shape
    metalScale: 1 / 2,        // the metal layer's resolution, relative to CSS px
    hold: 4,                  // seconds the cooled cast rests before fading
    fade: 5,                  // seconds the streams take to fade before the next pour
    lut: 64,                  // heat colours precomputed across `heat`
    sparks: 24,               // most sparks alive at once
    gravity: 700,             // CSS px per second squared
};

const WAVE = {
    scale: 0.5,               // canvas pixels per CSS pixel
    rings: 44,                // cross-sections painted between the far point and the viewer
    reach: 1.8,               // how far past the bottom of the view the nearest section lies
    squash: 0.9,              // sections are a little wider than tall
    streaks: 64,              // striations climbing the wall
    flare: 0.5,               // how far a striation moves out to hug the curl at the crest
    crash: 48,                // blobs in the mask that shapes the crashing whitewater
    ripples: 9,               // ripples on the calm water
    glitter: 60,              // flecks of sun on the calm water
    spray: 220,               // most spray drops alive at once
    surfer: 0.1,              // the surfer's height, as a fraction of the unit
    foamSize: 256,            // px, the foam tile (seamless)
    gravity: 520,             // CSS px per second squared
};

const PETAL_COUNT = 10;
const SEED = 7;
const TAU = Math.PI * 2;

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

function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * A colour token as [r, g, b, a]. Whatever form a theme writes it in, the
 * browser resolves it once it is used as the canvas's colour.
 */
function readColor(canvas, token) {
    canvas.style.color = `var(${token})`;
    const parts = (getComputedStyle(canvas).color.match(/[\d.]+/g) || []).map(Number);
    canvas.style.color = "";

    return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts.length > 3 ? parts[3] : 1];
}

function rgba([r, g, b, a], alpha = 1) {
    return `rgba(${r}, ${g}, ${b}, ${(a * alpha).toFixed(3)})`;
}

function mix(a, b, f) {
    return a.map((value, i) => value + (b[i] - value) * f);
}

/* Lava lamp --------------------------------------------------------------- */

/**
 * Metaballs. Every pixel sums the influence of each mass (radius squared
 * over distance squared); pixels above the threshold are painted, with a
 * thin smoothed band at the isoline. Colour is the influence-weighted mix
 * of the masses touching that pixel, so blobs blend where they merge.
 */
function createLavaScene(canvas, context) {
    let width = 0;
    let height = 0;
    let image = null;
    let pixels = null;
    let tones = readTones();

    function readTones() {
        return Array.from({ length: LAVA.tones }, (_, i) => readColor(canvas, `--lava-${i + 1}`));
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

            return { x: x * width, y: y * height, r2: radius * radius, color: tones[mass.tone - 1] };
        });
    }

    return {
        scale: LAVA.scale,
        interval: LAVA.interval,

        resize(w, h) {
            width = w;
            height = h;
            image = context.createImageData(width, height);
            pixels = new Uint32Array(image.data.buffer);
        },

        recolour() {
            tones = readTones();
        },

        draw(time) {
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

            context.setTransform(1, 0, 0, 1, 0, 0);
            context.putImageData(image, 0, 0);
        },
    };
}

/* Forge ------------------------------------------------------------------- */

/**
 * Lay out a pour in CSS px: several streams of molten metal falling in from
 * above, each wandering on its own sweeping curve. All streams are traced
 * together a row at a time: each has a heading that swings with two slow
 * sines and eases back towards straight down, neighbours that come close
 * turn a little away from each other, and the left-to-right order is kept,
 * so they never cross. Two thin filaments ride along each stream a little
 * off its centre line; they are what makes it read as liquid. Each stream
 * starts, stops and cools on its own schedule.
 */
function buildPour(width, height, random) {
    const count = width < 700 ? 3 : width < 1300 ? 4 : 6;
    const step = 16;
    const rows = Math.ceil((height + 240) / step) + 1;
    const margin = 24;

    /* Starting positions: random, but not on top of each other. */
    const starts = [];

    for (let tries = 0; starts.length < count && tries < 2000; tries += 1) {
        const x = margin + random() * (width - margin * 2);

        if (starts.every((other) => Math.abs(other - x) >= 70)) {
            starts.push(x);
        }
    }

    while (starts.length < count) {
        starts.push(margin + random() * (width - margin * 2));
    }

    starts.sort((a, b) => a - b);

    const streams = starts.map((x) => ({
        x,
        width: 20 + random() * 30,
        avoid: 0,
        lean: (random() - 0.5) * 1.3,            // radians off vertical to begin with
        swing: 0.35 + random() * 0.45,           // radians of sway at full swing
        wavelength: 600 + random() * 900,        // px of fall per sway cycle
        swayPhase: random() * TAU,
        wobble: 0.12 + random() * 0.12,          // a second, quicker sway
        wobbleLength: 220 + random() * 260,
        wobblePhase: random() * TAU,
        heading: 0,
        points: [],
        cumulative: [],
    }));

    const fall = (rows - 1) * step;

    for (let row = 0; row < rows; row += 1) {
        const travelled = row * step;
        const progress = travelled / fall;

        for (const stream of streams) {
            /* The opening lean eases out over the fall; the sways carry on. */
            stream.heading = stream.lean * (1 - progress * 0.75)
                + stream.swing * Math.sin((travelled / stream.wavelength) * TAU + stream.swayPhase)
                + stream.wobble * Math.sin((travelled / stream.wobbleLength) * TAU + stream.wobblePhase);
        }

        /* Neighbours that come close turn away from each other, easing
           into the turn and out of it again rather than snapping. */
        for (const stream of streams) {
            stream.wanted = 0;
        }

        for (let i = 1; i < streams.length; i += 1) {
            const left = streams[i - 1];
            const right = streams[i];
            const gap = 30 + (left.width + right.width) * 1.2;
            const distance = right.x - left.x;

            if (distance < gap * 4) {
                const turn = (1 - distance / (gap * 4)) ** 2 * 0.22;
                left.wanted -= turn;
                right.wanted += turn;
            }
        }

        for (const stream of streams) {
            stream.avoid += (stream.wanted - stream.avoid) * 0.05;
            stream.heading += stream.avoid;
        }

        for (const stream of streams) {
            if (stream.x < margin + 40) {
                stream.heading += 0.25;
            } else if (stream.x > width - margin - 40) {
                stream.heading -= 0.25;
            }

            stream.heading = Math.max(-1.1, Math.min(1.1, stream.heading));
            stream.x += Math.tan(stream.heading) * step;
        }

        /* Whatever else happens, the order never changes. */
        for (let i = 1; i < streams.length; i += 1) {
            const left = streams[i - 1];
            const right = streams[i];
            const gap = 30 + (left.width + right.width) * 1.2;

            if (right.x - left.x < gap) {
                const middle = (left.x + right.x) / 2;
                left.x = middle - gap / 2;
                right.x = middle + gap / 2;
            }
        }

        for (const stream of streams) {
            stream.points.push({ x: stream.x, y: -120 + travelled });
            stream.cumulative.push(travelled);
        }
    }

    /** The path shifted sideways by an amount that wanders along it. */
    function filament(path, amplitude, phase) {
        const last = path.points.length - 1;
        const points = path.points.map((point, i) => {
            const before = path.points[Math.max(0, i - 1)];
            const after = path.points[Math.min(last, i + 1)];
            const dx = after.x - before.x;
            const dy = after.y - before.y;
            const d = Math.hypot(dx, dy) || 1;
            const offset = amplitude * Math.sin(path.cumulative[i] * 0.011 + phase);

            return { x: point.x - (dy / d) * offset, y: point.y + (dx / d) * offset };
        });

        return { points, cumulative: path.cumulative, length: path.length };
    }

    /* Start order is shuffled so the pour does not sweep left to right. */
    const order = streams.map((_, i) => i).sort(() => random() - 0.5);

    order.forEach((index, k) => {
        const stream = streams[index];
        const w = stream.width;
        const start = k * FORGE.stagger + random() * FORGE.stagger;

        /* Distances along the path, which is longer than the fall when it leans. */
        let travelled = 0;
        stream.cumulative = stream.points.map((point, i) => {
            if (i > 0) {
                travelled += Math.hypot(point.x - stream.points[i - 1].x, point.y - stream.points[i - 1].y);
            }

            return travelled;
        });

        stream.length = travelled;
        stream.start = start;
        stream.arrive = start + stream.length / FORGE.speed;
        stream.stop = stream.arrive + FORGE.flow * (0.6 + random() * 0.8);
        stream.phase = random() * 1000;
        stream.filaments = [
            filament(stream, w * 0.34, random() * TAU),
            filament(stream, w * 0.26, random() * TAU),
        ];
    });

    const end = Math.max(...streams.map((stream) => stream.stop)) + FORGE.heat;

    return { streams, end };
}

/** The point `distance` along a path, and the vertex it follows. */
function pointAlong(path, distance) {
    const { points, cumulative } = path;
    let i = 0;

    while (i < cumulative.length - 2 && cumulative[i + 1] < distance) {
        i += 1;
    }

    const span = cumulative[i + 1] - cumulative[i] || 1;
    const f = clamp01((distance - cumulative[i]) / span);

    return {
        x: points[i].x + (points[i + 1].x - points[i].x) * f,
        y: points[i].y + (points[i + 1].y - points[i].y) * f,
        index: i,
    };
}

function createForgeScene(canvas, context, animate) {
    const scale = 1;
    const glowCanvas = document.createElement("canvas");
    const glowContext = glowCanvas.getContext("2d", { alpha: true });
    const metalCanvas = document.createElement("canvas");
    const metalContext = metalCanvas.getContext("2d", { alpha: true });
    let width = 0;
    let height = 0;
    let colors = readColors();
    let lut = [];
    let coreLut = [];
    let pour = null;
    let pourStart = null;
    let pours = 0;
    let lastNow = null;
    const sparks = [];

    function readColors() {
        return {
            ramp: ["hot", "glow", "ember", "cast"].map((name) => readColor(canvas, `--forge-${name}`)),
        };
    }

    /**
     * Colour of metal `age` seconds after its flow stopped. The body starts
     * orange-gold (halfway from hot to glow); only the core is white-hot.
     */
    function heatColor(age) {
        const { stops } = FORGE;
        const ramp = [mix(colors.ramp[0], colors.ramp[1], 0.55), colors.ramp[1], colors.ramp[2], colors.ramp[3]];

        for (let i = 1; i < stops.length; i += 1) {
            if (age <= stops[i]) {
                return mix(ramp[i - 1], ramp[i], (age - stops[i - 1]) / (stops[i] - stops[i - 1]));
            }
        }

        return ramp[ramp.length - 1];
    }

    function buildLut() {
        const ages = Array.from({ length: FORGE.lut }, (_, i) => (i / (FORGE.lut - 1)) * FORGE.heat);
        lut = ages.map((age) => rgba(heatColor(age)));
        coreLut = ages.map((age) => rgba(mix(heatColor(age), colors.ramp[0], 0.85 * clamp01(1 - age / 30))));
    }

    function lutIndex(age) {
        const index = Math.floor((age / FORGE.heat) * (FORGE.lut - 1));
        return index < 0 ? 0 : index >= FORGE.lut ? FORGE.lut - 1 : index;
    }

    /** How much light the metal throws around it, 1 while liquid, 0 when cast. */
    function glowStrength(age) {
        const f = clamp01(1 - age / FORGE.heat);
        return f * Math.sqrt(f);
    }

    function rebuild() {
        pour = buildPour(width, height, createRandom(SEED + pours));
    }

    /* Painting helpers ----------------------------------------------------- */

    /** Stroke the part of a path between two distances along it. */
    function strokeAlong(target, path, from, to, style, lineWidth) {
        const start = pointAlong(path, from);
        const stop = pointAlong(path, to);

        target.strokeStyle = style;
        target.lineWidth = lineWidth;
        target.beginPath();
        target.moveTo(start.x, start.y);

        for (let i = start.index + 1; i <= stop.index; i += 1) {
            target.lineTo(path.points[i].x, path.points[i].y);
        }

        target.lineTo(stop.x, stop.y);
        target.stroke();
    }

    /**
     * The metal's colour along a stream. Once its flow has stopped it cools
     * from the top down (the source dries up first), so the colour is a
     * gradient from the stream's head to its foot. While it flows, one
     * colour does.
     */
    function metalStyle(stream, t, table) {
        const age = t - stream.stop;

        if (age <= 0) {
            return table[0];
        }

        const first = stream.points[0];
        const last = stream.points[stream.points.length - 1];
        const gradient = metalContext.createLinearGradient(first.x, first.y, last.x, last.y);
        const stops = 6;

        for (let i = 0; i < stops; i += 1) {
            const f = i / (stops - 1);
            gradient.addColorStop(f, table[lutIndex(age + (1 - f) * FORGE.lag)]);
        }

        return gradient;
    }

    /** A soft disc of light. */
    function radial(x, y, r, color, alpha) {
        if (alpha <= 0.002) {
            return;
        }

        const gradient = context.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, rgba(color, alpha));
        gradient.addColorStop(1, rgba(color, 0));
        context.fillStyle = gradient;
        context.fillRect(x - r, y - r, r * 2, r * 2);
    }

    /* Sparks --------------------------------------------------------------- */

    function spawnSparks(x, y, count, spread) {
        for (let i = 0; i < count && sparks.length < FORGE.sparks; i += 1) {
            const life = 0.4 + Math.random() * 0.8;
            sparks.push({
                x,
                y,
                vx: (Math.random() - 0.5) * spread,
                vy: -(40 + Math.random() * 220),
                life,
                max: life,
            });
        }
    }

    function drawSparks(dt) {
        const hot = colors.ramp[0];

        context.lineWidth = 3;

        for (let i = sparks.length - 1; i >= 0; i -= 1) {
            const spark = sparks[i];
            spark.life -= dt;

            if (spark.life <= 0) {
                sparks.splice(i, 1);
                continue;
            }

            spark.vy += FORGE.gravity * dt;
            spark.x += spark.vx * dt;
            spark.y += spark.vy * dt;

            context.strokeStyle = rgba(hot, 0.9 * (spark.life / spark.max));
            context.beginPath();
            context.moveTo(spark.x, spark.y);
            context.lineTo(spark.x - spark.vx * 0.02, spark.y - spark.vy * 0.02);
            context.stroke();
        }
    }

    /* The pour ------------------------------------------------------------- */

    /**
     * The light a stream throws around it, painted on the small glow layer.
     * Several wide, faint strokes step the light down; drawn at a fraction of
     * the resolution and scaled up, the steps blend into one smooth falloff.
     */
    function drawBloom(stream, t, filled, light, flicker) {
        const glow = colors.ramp[1];
        const w = stream.width;

        for (let k = FORGE.bloom; k >= 1; k -= 1) {
            strokeAlong(glowContext, stream, 0, filled, rgba(glow, 0.1 * light * flicker * (1 - k / (FORGE.bloom + 1))), w * (1.2 + k * 1.3));
        }
    }

    /**
     * The metal itself, on the half-resolution layer: a body of a few
     * strokes with falling width and rising alpha so its edge fades, and a
     * white-hot core.
     */
    function drawMetal(stream, t, filled) {
        const w = stream.width;
        const body = metalStyle(stream, t, lut);
        const core = metalStyle(stream, t, coreLut);

        for (const [size, alpha] of FORGE.body) {
            metalContext.globalAlpha = alpha;
            strokeAlong(metalContext, stream, 0, filled, body, w * size);
        }

        for (const [size, alpha] of FORGE.core) {
            metalContext.globalAlpha = alpha;
            strokeAlong(metalContext, stream, 0, filled, core, w * size);
        }

        metalContext.globalAlpha = 1;
    }

    /**
     * The fine detail, at full resolution: while the metal still flows,
     * bright runs travelling downstream (a moving dash pattern) and the two
     * thin filaments; and the hot front while the stream is still arriving.
     */
    function drawDetail(stream, t, filled, liquid, flicker) {
        const hot = colors.ramp[0];
        const glow = colors.ramp[1];
        const w = stream.width;

        if (liquid > 0) {
            context.setLineDash([w * 2.2, w * 3.5]);
            context.lineDashOffset = -(t * FORGE.speed * 0.9 + stream.phase);
            strokeAlong(context, stream, 0, filled, rgba(hot, 0.3 * liquid * flicker), w * 0.5);
            context.setLineDash([]);

            for (const thread of stream.filaments) {
                strokeAlong(context, thread, 0, filled, rgba(hot, 0.45 * liquid), 1.8);
            }
        }

        if (filled < stream.length) {
            const { x, y } = pointAlong(stream, filled);
            radial(x, y, w * 3.2, glow, 0.45 * flicker);
            radial(x, y, w * 1.1, hot, 0.5 * flicker);

            if (animate && Math.random() < 0.3) {
                spawnSparks(x, y, 1, 200);
            }
        }
    }

    function drawPour(t, dt) {
        /* Heat shimmer: every light source breathes a little. */
        const flicker = 1 + 0.05 * Math.sin(t * 11.3) + 0.03 * Math.sin(t * 6.1) + 0.02 * Math.sin(t * 23.7);
        const visible = pour.streams
            .map((stream) => {
                const since = t - stream.start;
                const age = Math.max(0, t - stream.stop);

                return {
                    stream,
                    filled: Math.min(stream.length, since * FORGE.speed),
                    liquid: clamp01(1 - age / 10),
                    light: glowStrength(age + FORGE.lag / 2),
                };
            })
            .filter((entry) => entry.filled > 0);

        glowContext.setTransform(1, 0, 0, 1, 0, 0);
        glowContext.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
        glowContext.setTransform(FORGE.glowScale, 0, 0, FORGE.glowScale, 0, 0);
        glowContext.lineCap = "round";
        glowContext.lineJoin = "round";

        for (const { stream, filled, light } of visible) {
            drawBloom(stream, t, filled, light, flicker);
        }

        metalContext.setTransform(1, 0, 0, 1, 0, 0);
        metalContext.clearRect(0, 0, metalCanvas.width, metalCanvas.height);
        metalContext.setTransform(FORGE.metalScale, 0, 0, FORGE.metalScale, 0, 0);
        metalContext.lineCap = "round";
        metalContext.lineJoin = "round";

        for (const { stream, filled } of visible) {
            drawMetal(stream, t, filled);
        }

        context.setTransform(1, 0, 0, 1, 0, 0);
        context.drawImage(glowCanvas, 0, 0, canvas.width, canvas.height);
        context.drawImage(metalCanvas, 0, 0, canvas.width, canvas.height);
        context.setTransform(scale, 0, 0, scale, 0, 0);
        context.lineCap = "round";
        context.lineJoin = "round";

        for (const { stream, filled, liquid } of visible) {
            drawDetail(stream, t, filled, liquid, flicker);
        }

        drawSparks(dt);
    }

    buildLut();

    return {
        scale,
        interval: 1000 / 24,

        resize(w, h) {
            width = w / scale;
            height = h / scale;
            glowCanvas.width = Math.max(8, Math.round(width * FORGE.glowScale));
            glowCanvas.height = Math.max(8, Math.round(height * FORGE.glowScale));
            metalCanvas.width = Math.max(8, Math.round(width * FORGE.metalScale));
            metalCanvas.height = Math.max(8, Math.round(height * FORGE.metalScale));

            /* Where the browser can, blur the glow layer a touch as well. */
            if ("filter" in glowContext) {
                glowContext.filter = "blur(1px)";
            }

            /* Plain bilinear: the layers are smooth already, and the better
               filters cost real time on two full-screen blits a frame. */
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = "low";
            rebuild();
        },

        recolour() {
            colors = readColors();
            buildLut();
        },

        draw(now) {
            if (pourStart === null) {
                /* A still frame catches the pour with every stream in, some cooling. */
                pourStart = animate ? now : now - (pour.end - FORGE.heat * 0.5) * 1000;
            }

            const dt = lastNow === null ? 0 : Math.min(0.1, (now - lastNow) / 1000);
            lastNow = now;

            let t = (now - pourStart) / 1000;
            const rest = pour.end + FORGE.hold;

            if (animate && t > rest + FORGE.fade) {
                pours += 1;
                pourStart = now;
                t = 0;
                sparks.length = 0;
                rebuild();
            }

            context.setTransform(1, 0, 0, 1, 0, 0);
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.globalAlpha = t > rest ? Math.max(0, 1 - (t - rest) / FORGE.fade) : 1;
            drawPour(t, dt);
            context.globalAlpha = 1;
        },
    };
}

/* Wave -------------------------------------------------------------------- */

/**
 * Inside the barrel of a wave, looking out along it. The geometry:
 *
 *   - The far end of the tube is a single point near the horizon, where
 *     the bottom of the wave and the top of the wave meet.
 *   - Every cross-section of the wave is an arc: it starts on the wave's
 *     bottom line (which runs from that far point down to the bottom left
 *     of the view), sweeps up the face on the right, over the ceiling, and
 *     ends on the lip line (which runs from the far point up over the top
 *     of the view and down the far left as the lip curls in the
 *     foreground). Nearer cross-sections are bigger.
 *   - The arcs never close: below and left of them is the open side of the
 *     wave, and through it lie sky above the horizon and calm water below,
 *     water the wave has not yet drawn up.
 *
 * The wall is painted as the union of those arcs (full ellipses, near to
 * far, darkest nearest and brightest by the far point where the water is
 * thinnest), then the open region is drawn over it: sky, sun, a cloud, a
 * distant island, calm sea with the sky's light on it. Water climbs the
 * face and goes over as moving striations; foam clings along the lip and
 * drips; a surfer rides the face towards the far point, and can be picked
 * up, dragged and thrown.
 */
function createWaveScene(canvas, context, animate) {
    const { scale } = WAVE;
    let width = 0;
    let height = 0;
    let unit = 0;
    let colors = readColors();
    let foamTile = null;
    let foamPattern = null;
    let lastNow = null;
    let lastT = 0;
    const spray = [];
    const random = createRandom(SEED);
    const streaks = Array.from({ length: WAVE.streaks }, () => [random(), random(), random()]);
    const ripples = Array.from({ length: WAVE.ripples }, () => [random(), random(), random()]);
    const hills = Array.from({ length: 5 }, () => [random(), random(), random()]);
    const cloudPuffs = Array.from({ length: 7 }, () => [random(), random(), random()]);
    const glitter = Array.from({ length: WAVE.glitter }, () => [random(), random(), random()]);
    const crashBlobs = Array.from({ length: WAVE.crash }, () => [random(), random(), random(), random()]);
    const foamLayer = document.createElement("canvas");
    const foamContext = foamLayer.getContext("2d", { alpha: true });
    let foamLayerPattern = null;

    /* The surfer is riding the face, held by the pointer, flying after a
       throw, or paddling back to the face; `state` says which. */
    const surfer = { x: 0, y: 0, vx: 0, vy: 0, grabX: 0, grabY: 0, placed: false, state: "riding" };

    function readColors() {
        return {
            deep: readColor(canvas, "--wave-deep"),
            mid: readColor(canvas, "--wave-mid"),
            light: readColor(canvas, "--wave-light"),
            foam: readColor(canvas, "--wave-foam"),
            sun: readColor(canvas, "--wave-sun"),
            sky: readColor(canvas, "--wave-sky"),
            horizon: readColor(canvas, "--wave-horizon"),
            surfer: readColor(canvas, "--wave-surfer"),
            board: readColor(canvas, "--wave-board"),
        };
    }

    /* Textures ------------------------------------------------------------- */

    /** Seamless value noise on a wrapping lattice, in [0, 1]. */
    function noiseTile(size, octaves, seed) {
        const rand = createRandom(seed);
        const smooth = (f) => f * f * (3 - 2 * f);
        const layers = octaves.map(([cells, weight]) => {
            const lattice = Array.from({ length: cells * cells }, () => rand());
            const at = (i, j) => lattice[((j + cells) % cells) * cells + ((i + cells) % cells)];
            return { cells, weight, at };
        });
        const values = new Float32Array(size * size);

        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                let value = 0;

                for (const { cells, weight, at } of layers) {
                    const gx = (x / size) * cells;
                    const gy = (y / size) * cells;
                    const i = Math.floor(gx);
                    const j = Math.floor(gy);
                    const fx = smooth(gx - i);
                    const fy = smooth(gy - j);
                    const top = at(i, j) * (1 - fx) + at(i + 1, j) * fx;
                    const bottom = at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx;
                    value += weight * (top * (1 - fy) + bottom * fy);
                }

                values[y * size + x] = value;
            }
        }

        return values;
    }

    /**
     * A seamless tile of foam: layered noise cut to ragged white patches,
     * with smaller, darker noise punching bubble holes in them.
     */
    function makeFoam() {
        const size = WAVE.foamSize;
        const body = noiseTile(size, [[4, 0.5], [9, 0.3], [20, 0.2]], 19);
        const holes = noiseTile(size, [[24, 0.6], [48, 0.4]], 23);
        const tile = document.createElement("canvas");
        tile.width = size;
        tile.height = size;

        const tileContext = tile.getContext("2d");
        const image = tileContext.createImageData(size, size);

        for (let i = 0; i < size * size; i += 1) {
            const patch = clamp01((body[i] - 0.3) / 0.26);
            const hole = clamp01((holes[i] - 0.7) / 0.1);
            const alpha = patch * (1 - hole * 0.7);
            image.data[i * 4] = 255;
            image.data[i * 4 + 1] = 255;
            image.data[i * 4 + 2] = 255;
            image.data[i * 4 + 3] = Math.round(alpha * 255);
        }

        tileContext.putImageData(image, 0, 0);
        return tile;
    }

    /* Geometry ------------------------------------------------------------- */

    /** The far point of the tube, where the wave's bottom and top meet. */
    function farPoint() {
        return { x: width * 0.5 + unit * 0.3, y: height * 0.52 };
    }

    /**
     * Cross-section `k` of the wave: 0 is the far point, 1 the section
     * whose bottom reaches the bottom of the view, larger is nearer still.
     * Each is an ellipse; only the part of it from its bottom angle round to
     * its end angle is wave.
     */
    function ring(k, t) {
        const far = farPoint();
        const breathe = 1 + 0.012 * Math.sin(t * 1.1);

        return {
            x: far.x - unit * 0.45 * k,
            y: far.y - unit * 0.2 * k,
            r: unit * 0.9 * k * breathe,
            bottom: Math.PI * 0.45,
            end: -Math.PI * Math.min(1.3, 0.55 + 0.8 * k),
        };
    }

    /** A point on ring `k` at angle `a` (clockwise from +x). */
    function onRing(k, a, t) {
        const c = ring(k, t);
        return [c.x + Math.cos(a) * c.r, c.y + Math.sin(a) * c.r * WAVE.squash];
    }

    /**
     * The open side of the wave: the lip line (arc ends, near to far),
     * the far point, then the bottom line (arc bottoms, far to near).
     */
    function openingPath(t) {
        const far = farPoint();
        const steps = 36;

        context.beginPath();

        for (let i = steps; i >= 1; i -= 1) {
            const k = (i / steps) * WAVE.reach;
            const c = ring(k, t);
            const [x, y] = onRing(k, c.end, t);

            if (i === steps) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        }

        context.lineTo(far.x, far.y);

        for (let i = 1; i <= steps; i += 1) {
            const k = (i / steps) * WAVE.reach;
            const c = ring(k, t);
            const [x, y] = onRing(k, c.bottom, t);
            context.lineTo(x, y);
        }

        context.closePath();
    }

    /** Points along the lip line, near to far, for stroking. */
    function lipPoints(t, from, to, steps) {
        const points = [];

        for (let i = 0; i <= steps; i += 1) {
            const k = from + (to - from) * (i / steps);
            const c = ring(k, t);
            points.push(onRing(k, c.end, t));
        }

        return points;
    }

    /** Points along the bottom line, far to near. */
    function bottomPoints(t, steps) {
        const points = [];

        for (let i = 0; i <= steps; i += 1) {
            const k = (i / steps) * WAVE.reach;
            const c = ring(k, t);
            points.push(onRing(k, c.bottom, t));
        }

        return points;
    }

    /** Height of the water where a falling surfer lands, at x. */
    function waterAt(x, t) {
        const far = farPoint();
        const bottoms = bottomPoints(t, 24);

        for (let i = 1; i < bottoms.length; i += 1) {
            const [x0, y0] = bottoms[i - 1];
            const [x1, y1] = bottoms[i];

            if (x <= x0 && x >= x1) {
                const f = clamp01((x - x0) / ((x1 - x0) || 1));
                return y0 + (y1 - y0) * f;
            }
        }

        return x > far.x ? far.y + unit * 0.02 : far.y + unit * 0.14;
    }

    function polyline(points) {
        context.beginPath();

        for (let i = 0; i < points.length; i += 1) {
            if (i === 0) {
                context.moveTo(points[i][0], points[i][1]);
            } else {
                context.lineTo(points[i][0], points[i][1]);
            }
        }
    }

    /* Spray ---------------------------------------------------------------- */

    function spawnSpray(x, y, count, vx, vy, size = 1) {
        for (let i = 0; i < count && spray.length < WAVE.spray; i += 1) {
            const life = 0.5 + Math.random() * 0.9;
            spray.push({
                x: x + (Math.random() - 0.5) * 24,
                y: y + (Math.random() - 0.5) * 16,
                vx: vx + (Math.random() - 0.5) * 120,
                vy: vy + (Math.random() - 0.5) * 120,
                r: (1.2 + Math.random() * 2.4) * size,
                life,
                max: life,
            });
        }
    }

    function drawSpray(dt) {
        const { foam } = colors;

        context.lineCap = "round";

        for (let i = spray.length - 1; i >= 0; i -= 1) {
            const drop = spray[i];
            drop.life -= dt;

            if (drop.life <= 0) {
                spray.splice(i, 1);
                continue;
            }

            drop.vy += WAVE.gravity * dt;
            drop.vx *= 1 - 0.6 * dt;
            drop.x += drop.vx * dt;
            drop.y += drop.vy * dt;

            context.strokeStyle = rgba(foam, 0.85 * (drop.life / drop.max));
            context.lineWidth = drop.r * 2;
            context.beginPath();
            context.moveTo(drop.x, drop.y);
            context.lineTo(drop.x - drop.vx * 0.03, drop.y - drop.vy * 0.03);
            context.stroke();
        }
    }

    /* The surfer ----------------------------------------------------------- */

    /** Where the surfer rides when left alone: on the face, just above the bottom line. */
    function surferHome(t) {
        const [x, y] = onRing(0.5, Math.PI * 0.3 + Math.sin(t * 0.4) * 0.02, t);
        return { x, y };
    }

    function updateSurfer(t, dt) {
        const h = unit * WAVE.surfer;
        const home = surferHome(t);

        if (!surfer.placed) {
            surfer.x = home.x;
            surfer.y = home.y;
            surfer.placed = true;
            surfer.state = "riding";
        }

        if (surfer.state === "held") {
            return;
        }

        if (surfer.state === "riding") {
            surfer.x = home.x;
            surfer.y = home.y + Math.sin(t * 2.3) * h * 0.04;
            return;
        }

        if (surfer.state === "flying") {
            surfer.vy += WAVE.gravity * 1.4 * dt;
            surfer.x += surfer.vx * dt;
            surfer.y += surfer.vy * dt;

            const landing = waterAt(surfer.x, t) - h * 0.5;

            if (surfer.vy > 0 && surfer.y >= landing) {
                spawnSpray(surfer.x, landing + h * 0.4, Math.min(30, 6 + surfer.vy / 40), 0, -220, 1.4);
                surfer.y = landing;
                surfer.vx = 0;
                surfer.vy = 0;
                surfer.state = "paddling";
            }
        } else {
            const ease = Math.min(1, 1.6 * dt);
            surfer.x += (home.x - surfer.x) * ease;
            surfer.y += (home.y - surfer.y) * ease;

            if (Math.hypot(home.x - surfer.x, home.y - surfer.y) < h * 0.12) {
                surfer.state = "riding";
            }
        }

        surfer.x = Math.max(h, Math.min(width - h, surfer.x));
        surfer.y = Math.max(-h, Math.min(height + h, surfer.y));
    }

    /**
     * The surfer, lounging along the board in the famous pose: on his side,
     * propped on one elbow with his head in his hand, the other hand on his
     * hip, one knee up, looking at the viewer through round glasses. A few
     * simple shapes. Drawn along -x, with the board's tail at +x.
     */
    function drawSurfer(t) {
        const { foam, surfer: suit, board, deep, sun } = colors;
        const h = unit * WAVE.surfer;
        const lean = { riding: 0.3, held: -0.25, flying: 0.2, paddling: 0.1 }[surfer.state];
        const tilt = lean + Math.sin(t * 1.7) * 0.04;
        const bob = Math.sin(t * 5) * h * 0.012;

        context.save();
        context.translate(surfer.x, surfer.y);
        context.rotate(tilt);
        context.scale(-1, 1);

        if (surfer.state === "riding" || surfer.state === "paddling") {
            context.fillStyle = rgba(foam, 0.7);
            context.beginPath();
            context.moveTo(-h * 0.7, h * 0.5);
            context.quadraticCurveTo(-h * 1.5, h * 0.2 + Math.sin(t * 9) * h * 0.05, -h * 2.1, h * 0.5);
            context.quadraticCurveTo(-h * 1.4, h * 0.66, -h * 0.7, h * 0.58);
            context.closePath();
            context.fill();
        }

        /* Board: rounded nose, a stripe. */
        context.save();
        context.translate(0, h * 0.5);
        context.rotate(-0.08);
        context.fillStyle = rgba(board);
        context.beginPath();
        context.moveTo(-h * 0.7, 0);
        context.quadraticCurveTo(-h * 0.7, -h * 0.11, -h * 0.4, -h * 0.11);
        context.lineTo(h * 0.4, -h * 0.11);
        context.quadraticCurveTo(h * 0.8, -h * 0.11, h * 0.8, 0);
        context.quadraticCurveTo(h * 0.8, h * 0.11, h * 0.4, h * 0.11);
        context.lineTo(-h * 0.4, h * 0.11);
        context.quadraticCurveTo(-h * 0.7, h * 0.11, -h * 0.7, 0);
        context.closePath();
        context.fill();
        context.strokeStyle = rgba(suit, 0.9);
        context.lineWidth = h * 0.035;
        context.beginPath();
        context.moveTo(-h * 0.58, 0);
        context.lineTo(h * 0.65, 0);
        context.stroke();
        context.restore();

        context.translate(0, bob);
        context.lineCap = "round";
        context.lineJoin = "round";

        /* Legs along the board: the far one straight, the near one with its
           knee up. */
        context.strokeStyle = rgba(suit);
        context.lineWidth = h * 0.11;
        context.beginPath();
        context.moveTo(h * 0.02, h * 0.3);
        context.lineTo(-h * 0.55, h * 0.36);
        context.moveTo(h * 0.0, h * 0.28);
        context.lineTo(-h * 0.26, h * 0.1);
        context.lineTo(-h * 0.5, h * 0.34);
        context.stroke();

        /* Feet. */
        context.fillStyle = rgba(deep);
        context.beginPath();
        context.ellipse(-h * 0.6, h * 0.37, h * 0.07, h * 0.045, 0.3, 0, TAU);
        context.ellipse(-h * 0.55, h * 0.35, h * 0.07, h * 0.045, 0.3, 0, TAU);
        context.fill();

        /* Torso, lying along the board and rising to the shoulders. */
        context.fillStyle = rgba(suit);
        context.beginPath();
        context.ellipse(h * 0.2, h * 0.2, h * 0.26, h * 0.13, -0.32, 0, TAU);
        context.fill();

        /* The arm propping him up: elbow on the board, hand under the cheek. */
        context.strokeStyle = rgba(suit);
        context.lineWidth = h * 0.09;
        context.beginPath();
        context.moveTo(h * 0.36, h * 0.1);
        context.lineTo(h * 0.5, h * 0.36);
        context.lineTo(h * 0.62, h * 0.02);
        context.stroke();

        /* The other arm, hand on the hip. */
        context.beginPath();
        context.moveTo(h * 0.32, h * 0.08);
        context.lineTo(h * 0.16, h * 0.18);
        context.lineTo(h * 0.02, h * 0.18);
        context.stroke();
        context.fillStyle = rgba(sun);
        context.beginPath();
        context.arc(h * 0.0, h * 0.18, h * 0.055, 0, TAU);
        context.arc(h * 0.63, h * 0.0, h * 0.055, 0, TAU);
        context.fill();

        /* Head, resting on the hand, turned to the viewer. */
        const headX = h * 0.5;
        const headY = -h * 0.1;
        const headR = h * 0.17;
        context.fillStyle = rgba(sun);
        context.beginPath();
        context.arc(headX, headY, headR, 0, TAU);
        context.fill();

        /* Hair at the sides only. */
        context.fillStyle = rgba(deep);
        context.beginPath();
        context.ellipse(headX - headR * 0.95, headY + headR * 0.05, h * 0.05, h * 0.07, 0, 0, TAU);
        context.ellipse(headX + headR * 0.95, headY + headR * 0.05, h * 0.05, h * 0.07, 0, 0, TAU);
        context.fill();

        /* Round glasses, a brow, and a smug little smile. */
        context.strokeStyle = rgba(deep);
        context.lineWidth = h * 0.02;
        context.beginPath();
        context.arc(headX - headR * 0.36, headY + headR * 0.05, headR * 0.28, 0, TAU);
        context.moveTo(headX + headR * 0.64, headY + headR * 0.05);
        context.arc(headX + headR * 0.36, headY + headR * 0.05, headR * 0.28, 0, TAU);
        context.moveTo(headX - headR * 0.08, headY + headR * 0.05);
        context.lineTo(headX + headR * 0.08, headY + headR * 0.05);
        context.stroke();
        context.fillStyle = rgba(deep);
        context.beginPath();
        context.arc(headX - headR * 0.36, headY + headR * 0.08, h * 0.018, 0, TAU);
        context.arc(headX + headR * 0.36, headY + headR * 0.08, h * 0.018, 0, TAU);
        context.fill();
        context.beginPath();
        context.arc(headX + headR * 0.1, headY + headR * 0.45, headR * 0.3, Math.PI * 0.1, Math.PI * 0.7);
        context.stroke();

        context.restore();

        /* Spray off the tail: the tail's spot in the world, then a drop
           thrown back along the board and up. */
        if (animate && surfer.state === "riding" && Math.random() < 0.7) {
            const tailX = h * 0.7;
            const tailY = h * 0.5;
            const x = surfer.x + tailX * Math.cos(tilt) - tailY * Math.sin(tilt);
            const y = surfer.y + tailX * Math.sin(tilt) + tailY * Math.cos(tilt);
            spawnSpray(x, y, 1, Math.cos(tilt) * 90, Math.sin(tilt) * 90 - 80, 0.8);
        }
    }

    /* The open side --------------------------------------------------------- */

    /** Sky, sun, cloud, island and calm sea, clipped to the open side. */
    function drawOpenSide(t) {
        const { sky, horizon, mid, deep, foam, sun } = colors;
        const far = farPoint();
        const horizonY = far.y + unit * 0.005;

        context.save();
        openingPath(t);
        context.clip();

        /* Sky, warm towards the horizon. */
        const skyFill = context.createLinearGradient(0, 0, 0, horizonY);
        skyFill.addColorStop(0, rgba(sky));
        skyFill.addColorStop(0.7, rgba(mix(sky, horizon, 0.6)));
        skyFill.addColorStop(1, rgba(horizon));
        context.fillStyle = skyFill;
        context.fillRect(0, 0, width, horizonY + 1);

        /* The sun, low, a little left of the far point. */
        const sunX = far.x - unit * 0.16;
        const sunY = horizonY - unit * 0.12;
        const sunGlow = context.createRadialGradient(sunX, sunY, 0, sunX, sunY, unit * 0.5);
        sunGlow.addColorStop(0, rgba(sun, 1));
        sunGlow.addColorStop(0.08, rgba(sun, 0.9));
        sunGlow.addColorStop(0.3, rgba(sun, 0.35));
        sunGlow.addColorStop(1, rgba(sun, 0));
        context.fillStyle = sunGlow;
        context.fillRect(0, 0, width, horizonY + 2);

        /* A cloud drifting through. */
        const cloudX = width * 0.15 + ((t * 8 + width * 0.1) % (width * 0.5));
        const cloudY = horizonY - unit * 0.24;

        for (const [a, b, d] of cloudPuffs) {
            const px = cloudX + (a - 0.5) * unit * 0.24;
            const py = cloudY - b * unit * 0.04 + Math.abs(a - 0.5) * unit * 0.04;
            const r = unit * (0.025 + d * 0.03);
            const puff = context.createRadialGradient(px, py - r * 0.3, r * 0.1, px, py, r);
            puff.addColorStop(0, rgba(foam, 0.95));
            puff.addColorStop(0.7, rgba(foam, 0.8));
            puff.addColorStop(1, rgba(foam, 0));
            context.fillStyle = puff;
            context.fillRect(px - r, py - r, r * 2, r * 2);
        }

        /* Calm sea, from the horizon down to the viewer. */
        const seaFill = context.createLinearGradient(0, horizonY, 0, height);
        seaFill.addColorStop(0, rgba(mix(horizon, mid, 0.5)));
        seaFill.addColorStop(0.35, rgba(mid));
        seaFill.addColorStop(1, rgba(deep));
        context.fillStyle = seaFill;
        context.fillRect(0, horizonY, width, height - horizonY);

        /* Islands on the horizon: a faint one far off, a nearer one in
           front, both left of the far point. */
        const island = (left, span, scaleY, tone, alpha) => {
            context.fillStyle = rgba(tone, alpha);
            context.beginPath();
            context.moveTo(left, horizonY + 1);

            for (let i = 0; i <= 30; i += 1) {
                const f = i / 30;
                let rise = 0;

                for (const [a, b, d] of hills) {
                    rise += Math.max(0, 1 - Math.abs(f - (0.15 + a * 0.7)) / (0.1 + b * 0.2)) * (0.03 + d * 0.06);
                }

                context.lineTo(left + f * span, horizonY - rise * unit * scaleY * Math.sin(f * Math.PI));
            }

            context.lineTo(left + span, horizonY + 1);
            context.closePath();
            context.fill();
        };

        island(far.x - unit * 1.25, unit * 0.7, 0.28, mix(horizon, sky, 0.5), 0.8);
        island(far.x - unit * 0.7, unit * 0.5, 0.5, mix(deep, sky, 0.35), 0.9);

        /* Haze where the sea meets the sky. */
        const haze = context.createLinearGradient(0, horizonY - unit * 0.08, 0, horizonY + unit * 0.06);
        haze.addColorStop(0, rgba(foam, 0));
        haze.addColorStop(0.55, rgba(foam, 0.32));
        haze.addColorStop(1, rgba(foam, 0));
        context.fillStyle = haze;
        context.fillRect(0, horizonY - unit * 0.08, width, unit * 0.14);

        /* The sun's light lying on the water, and the sky's. */
        context.save();
        context.translate(sunX, horizonY + unit * 0.02);
        context.scale(0.35, 1);
        const path = context.createRadialGradient(0, 0, 0, 0, 0, unit * 0.45);
        path.addColorStop(0, rgba(sun, 0.6));
        path.addColorStop(0.4, rgba(sun, 0.22));
        path.addColorStop(1, rgba(sun, 0));
        context.fillStyle = path;
        context.fillRect(-unit, -unit * 0.05, unit * 2, unit * 0.6);
        context.restore();

        /* Glitter: the sun on the water, flickering. */
        context.lineCap = "round";
        context.lineWidth = 2;

        for (const [a, b, d] of glitter) {
            const spread = 0.05 + b * 0.35;
            const x = sunX + (a - 0.5) * unit * spread;
            const y = horizonY + unit * 0.012 + b * b * unit * 0.3;
            const flicker = 0.5 + 0.5 * Math.sin(t * (4 + d * 5) + d * 40);
            context.strokeStyle = rgba(sun, 0.7 * flicker * (1 - b * 0.6));
            context.beginPath();
            context.moveTo(x - unit * 0.004 * (1 + b * 3), y);
            context.lineTo(x + unit * 0.004 * (1 + b * 3), y);
            context.stroke();
        }

        /* Ripples on the calm water, sliding away towards the horizon. */
        context.lineWidth = 1.5;

        for (const [a, b, d] of ripples) {
            const f = ((a - t * 0.04 * (0.6 + d)) % 1 + 1) % 1;
            const y = horizonY + unit * 0.02 + (height - horizonY) * f * f;
            context.strokeStyle = rgba(foam, 0.2 * (1 - f) * (0.4 + d * 0.6));
            context.beginPath();

            for (let x = -20; x <= width + 20; x += 14) {
                const yy = y + Math.sin(x * (0.012 + b * 0.01) + t * 1.4 + b * 20) * (1.5 + f * 8);

                if (x === -20) {
                    context.moveTo(x, yy);
                } else {
                    context.lineTo(x, yy);
                }
            }

            context.stroke();
        }

        context.restore();
    }

    /* The crash ------------------------------------------------------------ */

    /**
     * Where the lip comes down on the left: a mass of whitewater along the
     * curl and piled up where it lands. On its own layer, a mask of blobs
     * that heave and roll is drawn first, then the foam texture is kept
     * only where the mask is, over a solid white body, so the mass churns
     * inside and boils at its edges. Spray flies off it and mist hangs
     * over it.
     */
    function drawCrash(t) {
        const { foam } = colors;
        const boxX = -20;
        const boxY = height * 0.15;
        const boxW = width * 0.75;
        const boxH = height * 0.85 + 40;

        if (foamLayer.width !== Math.round(boxW * scale) || foamLayer.height !== Math.round(boxH * scale)) {
            foamLayer.width = Math.max(4, Math.round(boxW * scale));
            foamLayer.height = Math.max(4, Math.round(boxH * scale));
            foamLayerPattern = foamTile ? foamContext.createPattern(foamTile, "repeat") : null;
        }

        /* Anchors along the curl, from a little way up it down to where it
           lands, and the pile at the bottom. */
        const curl = lipPoints(t, 0.5, 1.02, 14);
        const base = curl[curl.length - 1];

        foamContext.setTransform(scale, 0, 0, scale, -boxX * scale, -boxY * scale);
        foamContext.clearRect(boxX, boxY, boxW, boxH);

        for (const [a, b, d, e] of crashBlobs) {
            const along = curl[Math.min(curl.length - 1, Math.floor(a * curl.length))];
            const pile = b < 0.45;
            const roll = t * (0.7 + d * 0.9) + e * TAU;
            const px = pile
                ? base[0] + (b / 0.45) * unit * 0.42 + Math.cos(roll) * unit * 0.03
                : along[0] + (d - 0.35) * unit * 0.12 + Math.cos(roll) * unit * 0.02;
            const py = pile
                ? base[1] - d * unit * 0.22 + Math.sin(roll * 1.3) * unit * 0.025
                : along[1] + (e - 0.5) * unit * 0.08 + Math.sin(roll) * unit * 0.02;
            const r = unit * (pile ? 0.07 + d * 0.09 : 0.04 + d * 0.05) * (0.88 + 0.12 * Math.sin(t * 2.4 + e * TAU));
            const blob = foamContext.createRadialGradient(px, py, 0, px, py, r);
            blob.addColorStop(0, "rgba(255, 255, 255, 1)");
            blob.addColorStop(0.55, "rgba(255, 255, 255, 0.85)");
            blob.addColorStop(1, "rgba(255, 255, 255, 0)");
            foamContext.fillStyle = blob;
            foamContext.fillRect(px - r, py - r, r * 2, r * 2);
        }

        if (foamLayerPattern && typeof foamLayerPattern.setTransform === "function") {
            foamContext.globalCompositeOperation = "source-in";
            foamLayerPattern.setTransform(new DOMMatrix().translate(t * unit * 0.08, -t * unit * 0.14).scale(unit * 0.0017));
            foamContext.fillStyle = foamLayerPattern;
            foamContext.fillRect(boxX, boxY, boxW, boxH);
            foamContext.globalCompositeOperation = "source-atop";
            foamLayerPattern.setTransform(new DOMMatrix().translate(-t * unit * 0.1, -t * unit * 0.1).scale(unit * 0.0008));
            foamContext.globalAlpha = 0.6;
            foamContext.fillRect(boxX, boxY, boxW, boxH);
            const body = foamContext.createRadialGradient(base[0] + unit * 0.18, base[1] - unit * 0.06, unit * 0.02, base[0] + unit * 0.18, base[1] - unit * 0.06, unit * 0.45);
            body.addColorStop(0, "rgba(255, 255, 255, 0.95)");
            body.addColorStop(0.5, "rgba(255, 255, 255, 0.7)");
            body.addColorStop(1, "rgba(255, 255, 255, 0.35)");
            foamContext.fillStyle = body;
            foamContext.globalAlpha = 1;
            foamContext.fillRect(boxX, boxY, boxW, boxH);
            foamContext.globalCompositeOperation = "source-over";
        }

        /* Mist over the landing, then the whitewater, twice for weight. */
        const mist = context.createRadialGradient(base[0] + unit * 0.18, base[1] - unit * 0.15, unit * 0.02, base[0] + unit * 0.18, base[1] - unit * 0.15, unit * 0.45);
        mist.addColorStop(0, rgba(foam, 0.6));
        mist.addColorStop(1, rgba(foam, 0));
        context.fillStyle = mist;
        context.fillRect(base[0] - unit * 0.3, base[1] - unit * 0.65, unit, unit);

        context.drawImage(foamLayer, boxX, boxY, boxW, boxH);
        context.globalAlpha = 0.75;
        context.drawImage(foamLayer, boxX, boxY, boxW, boxH);
        context.globalAlpha = 1;

        if (animate) {
            spawnSpray(base[0] + unit * (0.02 + Math.random() * 0.4), base[1] - unit * 0.2, 6, (Math.random() - 0.3) * 200, -380, 1.3);
            const along = curl[Math.floor(Math.random() * curl.length)];
            spawnSpray(along[0], along[1], 2, -40, 60, 1);
        }
    }

    /* A frame --------------------------------------------------------------- */

    function draw(t, dt) {
        const { deep, mid, light, foam, sun } = colors;
        const far = farPoint();

        /* The wall: every cross-section from nearest to farthest, darkest
           nearest, brightest by the far point where the water is thinnest
           and the sun comes through it. */
        context.fillStyle = rgba(deep);
        context.fillRect(0, 0, width, height);

        /* Painted as annuli, outermost first, so each pixel is filled once
           rather than under every larger section. */
        for (let i = WAVE.rings; i >= 1; i -= 1) {
            const k = (i / WAVE.rings) * WAVE.reach;
            const f = k / WAVE.reach;
            const c = ring(k, t);
            const inner = ring(((i - 1) / WAVE.rings) * WAVE.reach, t);

            /* Each section is lit across itself: its lower right, the face,
               is thin backlit water, bright and green; its upper left, the
               ceiling, is thick and dark. Nearer sections are darker overall. */
            const face = f < 0.5 ? mix(light, mid, f / 0.5) : mix(mid, deep, (f - 0.5) * 0.8);
            const ceiling = mix(mid, deep, 0.5 + f * 0.5);
            const shade = context.createLinearGradient(c.x + c.r * 0.7, c.y + c.r * 0.6, c.x - c.r * 0.5, c.y - c.r * 0.9);
            shade.addColorStop(0, rgba(face));
            shade.addColorStop(0.45, rgba(mix(face, ceiling, 0.5)));
            shade.addColorStop(1, rgba(ceiling));
            context.fillStyle = shade;
            context.beginPath();
            context.ellipse(c.x, c.y, c.r, c.r * WAVE.squash, 0, 0, TAU);

            if (i > 1) {
                context.ellipse(inner.x, inner.y, inner.r * 0.985, inner.r * 0.985 * WAVE.squash, 0, 0, TAU);
            }

            context.fill("evenodd");
        }

        /* Thick water overhead: the ceiling darkens towards the top. */
        const overhead = context.createLinearGradient(0, 0, 0, height * 0.5);
        overhead.addColorStop(0, rgba(deep, 0.75));
        overhead.addColorStop(1, rgba(deep, 0));
        context.fillStyle = overhead;
        context.fillRect(0, 0, width, height * 0.5);

        /* Sun through the lip: the wall glows where it is thin, along the
           lip line by the top of the wave. */
        const lipGlow = context.createRadialGradient(far.x + unit * 0.05, far.y - unit * 0.18, 0, far.x + unit * 0.05, far.y - unit * 0.18, unit * 0.75);
        lipGlow.addColorStop(0, rgba(sun, 0.6));
        lipGlow.addColorStop(0.35, rgba(light, 0.3));
        lipGlow.addColorStop(1, rgba(light, 0));
        context.fillStyle = lipGlow;
        context.fillRect(0, 0, width, height);

        /* Striations: water climbing the face and going over. Each is a
           long arc lying on one cross-section, so it bends exactly as the
           wall does there, fading in and out along its length, and slides
           up from the bottom line, over the ceiling, to the lip, then
           starts again. */
        context.lineCap = "round";

        for (const [a, b, d] of streaks) {
            const k = (0.1 + a * 0.9) * WAVE.reach;
            const c = ring(k, t);
            const span = 0.45 + d * 0.5;
            const lap = (t * (0.07 + d * 0.05) + b) % 1;
            const top = c.bottom - (c.bottom - c.end + span) * lap;
            const segments = 10;
            let last = null;

            for (let i = 0; i < segments; i += 1) {
                const f0 = i / segments;
                const f1 = (i + 1) / segments;
                const a0 = Math.max(c.end, Math.min(c.bottom, top + span * f0));
                const a1 = Math.max(c.end, Math.min(c.bottom, top + span * f1));

                if (a1 - a0 < 0.001) {
                    continue;
                }

                const s0 = (c.bottom - a0) / (c.bottom - c.end);
                const s1 = (c.bottom - a1) / (c.bottom - c.end);
                const [x0, y0] = last || onRing(k * (1 + WAVE.flare * s0 * s0), a0, t);
                const [x1, y1] = onRing(k * (1 + WAVE.flare * s1 * s1), a1, t);
                last = [x1, y1];
                const along = Math.sin(Math.PI * (f0 + f1) / 2);
                context.strokeStyle = rgba(foam, (0.1 + d * 0.22) * along * (1 - (k / WAVE.reach) * 0.4));
                context.lineWidth = 1 + d * 2;
                context.beginPath();
                context.moveTo(x0, y0);
                context.lineTo(x1, y1);
                context.stroke();
            }
        }

        for (const [lineWidth, alpha] of [[unit * 0.08, 0.16], [unit * 0.035, 0.3]]) {
            polyline(lipPoints(t, WAVE.reach, 0.05, 40));
            context.strokeStyle = rgba(light, alpha);
            context.lineWidth = lineWidth;
            context.lineJoin = "round";
            context.stroke();
        }

        drawOpenSide(t);

        /* The bottom of the wave: the face lifts out of the flat water with
           no edge, so the join is feathered with wide, faint strokes of the
           water's own colours, fading away towards the far point. */
        const bottom = bottomPoints(t, 30);
        context.lineCap = "round";
        context.lineJoin = "round";

        const layers = 12;

        for (let j = 0; j < layers; j += 1) {
            const f = j / (layers - 1);
            const tone = mix(mid, light, f * f);
            const alpha = 0.05 + f * 0.04;
            context.lineWidth = unit * (0.02 + 0.22 * (1 - f) * (1 - f));

            for (let i = 1; i < bottom.length; i += 1) {
                const near = i / bottom.length;
                context.strokeStyle = rgba(tone, alpha * Math.min(1, near * 3));
                context.beginPath();
                context.moveTo(bottom[i - 1][0], bottom[i - 1][1]);
                context.lineTo(bottom[i][0], bottom[i][1]);
                context.stroke();
            }
        }

        drawCrash(t);

        /* Depth: the nearest water, at the edges of the view, in shadow. */
        const depth = context.createRadialGradient(far.x, far.y, unit * 0.5, far.x, far.y, unit * 1.5);
        depth.addColorStop(0, rgba(deep, 0));
        depth.addColorStop(1, rgba(deep, 0.55));
        context.fillStyle = depth;
        context.fillRect(0, 0, width, height);

        drawSpray(dt);
        updateSurfer(t, dt);
        drawSurfer(t);
    }

    /* Pointer: grab and throw the surfer ---------------------------------- */

    function toScene(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: ((clientX - rect.left) / rect.width) * width,
            y: ((clientY - rect.top) / rect.height) * height,
        };
    }

    function overSurfer(point) {
        const h = unit * WAVE.surfer;
        return Math.abs(point.x - surfer.x) < h * 0.9 && Math.abs(point.y - surfer.y) < h * 0.7;
    }

    const pointer = {
        hit(clientX, clientY) {
            return surfer.placed && overSurfer(toScene(clientX, clientY));
        },

        down(clientX, clientY) {
            const point = toScene(clientX, clientY);
            surfer.state = "held";
            surfer.grabX = surfer.x - point.x;
            surfer.grabY = surfer.y - point.y;
            surfer.vx = 0;
            surfer.vy = 0;
        },

        move(clientX, clientY, dtMs) {
            const point = toScene(clientX, clientY);
            const nx = point.x + surfer.grabX;
            const ny = point.y + surfer.grabY;
            const dt = Math.max(dtMs, 8) / 1000;
            surfer.vx = (nx - surfer.x) / dt;
            surfer.vy = (ny - surfer.y) / dt;
            surfer.x = nx;
            surfer.y = ny;
        },

        up() {
            const h = unit * WAVE.surfer;

            if (surfer.y >= waterAt(surfer.x, lastT) - h * 0.5) {
                /* Let go in the water: no snap, just paddle from here. */
                surfer.state = "paddling";
                surfer.vx = 0;
                surfer.vy = 0;
                return;
            }

            surfer.state = "flying";
            surfer.vx = Math.max(-1200, Math.min(1200, surfer.vx * 0.6));
            surfer.vy = Math.max(-1400, Math.min(600, surfer.vy * 0.6));
        },
    };

    return {
        scale,
        interval: 1000 / 30,
        pointer,

        resize(w, h) {
            width = w / scale;
            height = h / scale;
            unit = Math.min(height, width * 0.7);
            surfer.placed = false;

            if (!foamTile) {
                foamTile = makeFoam();
                foamPattern = context.createPattern(foamTile, "repeat");
            }
        },

        recolour() {
            colors = readColors();
        },

        draw(now) {
            const dt = lastNow === null ? 0 : Math.min(0.1, (now - lastNow) / 1000);
            lastNow = now;

            const t = animate ? now / 1000 : 12;
            lastT = t;

            context.setTransform(scale, 0, 0, scale, 0, 0);
            context.clearRect(0, 0, width, height);
            draw(t, dt);
        },
    };
}

/* Playing a scene --------------------------------------------------------- */

const SCENES = { lava: createLavaScene, forge: createForgeScene, wave: createWaveScene };

function readSceneName(canvas) {
    const name = getComputedStyle(canvas).getPropertyValue("--backdrop-scene").trim();
    return SCENES[name] ? name : "lava";
}

/**
 * Size the canvas for the scene, draw it, and keep it drawing at the scene's
 * rate. Returns handles to recolour it and to stop it for another scene.
 */
function play(canvas, createScene, animate) {
    const context = canvas.getContext("2d", { alpha: true });
    const scene = createScene(canvas, context, animate);
    let request = 0;
    let lastDraw = 0;
    let lastTime = performance.now();
    let stopped = false;

    function resize() {
        canvas.width = Math.max(16, Math.round(window.innerWidth * scene.scale));
        canvas.height = Math.max(16, Math.round(window.innerHeight * scene.scale));
        scene.resize(canvas.width, canvas.height);
    }

    function frame(now) {
        if (stopped) {
            return;
        }

        if (now - lastDraw >= scene.interval) {
            lastDraw = now;
            lastTime = now;
            scene.draw(now);
        }

        request = requestAnimationFrame(frame);
    }

    /* Resizing clears the canvas, so repaint at once rather than showing a
       stretched stale frame until the next animation frame. */
    function onResize() {
        resize();
        scene.draw(lastTime);
    }

    resize();
    scene.draw(lastTime);
    window.addEventListener("resize", onResize, { passive: true });

    if (animate) {
        request = requestAnimationFrame(frame);
    }

    /* A scene with a `pointer` can be touched through the page: whatever
       lies over it still works, only clicks that land on plain background
       (not a link or control) and hit the scene's target are taken. */
    const listeners = [];

    if (scene.pointer && animate) {
        const { pointer } = scene;
        const isControl = (node) => node instanceof Element && Boolean(node.closest("a, button, input, textarea, select, summary, label"));
        let holding = null;
        let cursorSet = false;
        let lastMove = 0;

        const on = (name, handler, options) => {
            document.addEventListener(name, handler, options);
            listeners.push([name, handler, options]);
        };

        on("pointerdown", (event) => {
            if (event.button !== 0 || isControl(event.target) || !pointer.hit(event.clientX, event.clientY)) {
                return;
            }

            event.preventDefault();
            holding = event.pointerId;
            lastMove = event.timeStamp;
            pointer.down(event.clientX, event.clientY);
            document.documentElement.style.cursor = "grabbing";
            cursorSet = true;
        });

        on("pointermove", (event) => {
            if (holding === event.pointerId) {
                pointer.move(event.clientX, event.clientY, event.timeStamp - lastMove);
                lastMove = event.timeStamp;
                return;
            }

            if (holding === null) {
                const over = !isControl(event.target) && pointer.hit(event.clientX, event.clientY);

                if (over && !cursorSet) {
                    document.documentElement.style.cursor = "grab";
                    cursorSet = true;
                } else if (!over && cursorSet) {
                    document.documentElement.style.cursor = "";
                    cursorSet = false;
                }
            }
        }, { passive: true });

        const release = (event) => {
            if (holding === event.pointerId) {
                holding = null;
                pointer.up();
                document.documentElement.style.cursor = "";
                cursorSet = false;
            }
        };

        on("pointerup", release);
        on("pointercancel", release);
    }

    return {
        recolour() {
            scene.recolour();
            scene.draw(lastTime);
        },

        stop() {
            stopped = true;
            cancelAnimationFrame(request);
            window.removeEventListener("resize", onResize);

            for (const [name, handler, options] of listeners) {
                document.removeEventListener(name, handler, options);
            }

            document.documentElement.style.cursor = "";
        },
    };
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
    const canvas = document.querySelector(".backdrop__scene");
    const petalHost = document.querySelector(".backdrop__petals");

    if (!canvas || !petalHost) {
        return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let name = readSceneName(canvas);
    let playing = play(canvas, SCENES[name], !reducedMotion);

    document.addEventListener("themechange", () => {
        const next = readSceneName(canvas);

        if (next === name) {
            playing.recolour();
            return;
        }

        playing.stop();
        name = next;
        playing = play(canvas, SCENES[name], !reducedMotion);
    });

    if (!reducedMotion) {
        const random = createRandom(SEED);
        petalHost.append(...Array.from({ length: PETAL_COUNT }, () => createPetal(random)));
    }
}

init();
