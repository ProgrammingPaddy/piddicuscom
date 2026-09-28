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
 *   wave    Inside the barrel of a wave that never stops breaking: the tube
 *           wall in perspective, lit from a bright eye, with water running
 *           along it, the lip pouring down into whitewater and spray, and a
 *           small surfer riding the floor. Colours are the --wave-* tokens.
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
    rings: 30,                // rings of the tube wall between mouth and eye
    squash: 0.92,             // rings are a little wider than tall
    streaks: 30,              // streaks of water running along the wall
    curtain: 44,              // falling strands in the lip's curtain
    foamClumps: 36,           // foam clumps in the whitewater
    spray: 80,                // most spray drops alive at once
    surfer: 0.085,            // the surfer's height, as a fraction of the view
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
 * Inside the barrel of a wave that never stops breaking. The tube runs
 * away from the viewer to a bright eye left of centre: its wall is a stack
 * of rings drawn in perspective, each a little smaller and further off
 * than the last, lit from the eye and darkening towards the mouth. Water
 * streaks run along the wall and over, the lip pours down on the left in
 * a curtain that lands in whitewater and spray, the flat water inside the
 * tube ripples, and a small surfer rides it towards the mouth, trailing a
 * wake. Everything moves all the time; nothing needs to reset.
 *
 * A few dozen fills and strokes per frame, painted at half resolution.
 */
function createWaveScene(canvas, context, animate) {
    const { scale } = WAVE;
    let width = 0;
    let height = 0;
    let colors = readColors();
    let lastNow = null;
    const spray = [];
    const random = createRandom(SEED);
    const streaks = Array.from({ length: WAVE.streaks }, () => [random(), random(), random()]);
    const curtain = Array.from({ length: WAVE.curtain }, () => [random(), random(), random()]);
    const foamSeeds = Array.from({ length: WAVE.foamClumps }, () => [random(), random(), random()]);

    function readColors() {
        return {
            deep: readColor(canvas, "--wave-deep"),
            mid: readColor(canvas, "--wave-mid"),
            light: readColor(canvas, "--wave-light"),
            foam: readColor(canvas, "--wave-foam"),
        };
    }

    /* The tube ------------------------------------------------------------- */

    /**
     * The ring `k` of the way from the eye (0) to the mouth (1): its centre
     * slides from the eye towards the lower right and its radius grows
     * quickly, as a tunnel does in perspective. The eye breathes a little.
     */
    function ring(k, t) {
        const eye = { x: width * 0.36, y: height * 0.5 };
        const mouth = { x: width * 0.86, y: height * 0.64 };
        const inner = height * (0.055 + 0.006 * Math.sin(t * 1.3));
        const outer = height * 0.9;
        const p = k ** 1.6;

        return {
            x: eye.x + (mouth.x - eye.x) * p,
            y: eye.y + (mouth.y - eye.y) * p,
            r: inner + (outer - inner) * p,
        };
    }

    /** A point on ring `k` at angle `a` (screen angle, clockwise from +x). */
    function onRing(k, a, t) {
        const c = ring(k, t);
        return [c.x + Math.cos(a) * c.r, c.y + Math.sin(a) * c.r * WAVE.squash];
    }

    function ellipse(c, alpha, style) {
        context.globalAlpha = alpha;
        context.fillStyle = style;
        context.beginPath();
        context.ellipse(c.x, c.y, c.r, c.r * WAVE.squash, 0, 0, TAU);
        context.fill();
        context.globalAlpha = 1;
    }

    /** Where the floor meets the wall: the bottom of each ring, and flat to the left. */
    function floorEdge(t) {
        const points = [];
        const far = ring(0, t);
        points.push([-20, far.y + far.r * WAVE.squash]);

        for (let i = 0; i <= 24; i += 1) {
            const c = ring(i / 24, t);
            points.push([c.x, c.y + c.r * WAVE.squash]);
        }

        points.push([width + 20, points[points.length - 1][1]]);
        return points;
    }

    /* Foam, spray, surfer -------------------------------------------------- */

    function spawnSpray(x, y, count, vx, vy) {
        for (let i = 0; i < count && spray.length < WAVE.spray; i += 1) {
            const life = 0.5 + Math.random() * 0.9;
            spray.push({
                x: x + (Math.random() - 0.5) * 24,
                y: y + (Math.random() - 0.5) * 16,
                vx: vx + (Math.random() - 0.5) * 120,
                vy: vy + (Math.random() - 0.5) * 120,
                r: 1.2 + Math.random() * 2.6,
                life,
                max: life,
            });
        }
    }

    function drawSpray(dt) {
        const { foam } = colors;

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

            context.fillStyle = rgba(foam, 0.85 * (drop.life / drop.max));
            context.beginPath();
            context.arc(drop.x, drop.y, drop.r, 0, TAU);
            context.fill();
        }
    }

    /**
     * A surfer crouched on a board, seen from the side, riding towards the
     * mouth: a dark silhouette against the bright water, bobbing with the
     * ride, and a fan of wake off the tail.
     */
    function drawSurfer(t) {
        const { foam } = colors;
        const h = height * WAVE.surfer;
        const floor = floorEdge(t);
        const x = width * 0.45 + Math.sin(t * 0.7) * width * 0.02;
        const at = floor.find((point) => point[0] >= x) || floor[floor.length - 1];
        const y = at[1] - h * 0.5 + Math.sin(t * 2.3) * h * 0.06;
        const tilt = -0.14 + Math.sin(t * 1.7) * 0.06;

        context.save();
        context.translate(x, y);
        context.rotate(tilt);

        /* Wake: a fan of white off the tail, and drops. */
        context.fillStyle = rgba(foam, 0.5);
        context.beginPath();
        context.moveTo(-h * 0.7, h * 0.5);
        context.quadraticCurveTo(-h * 1.4, h * 0.25 + Math.sin(t * 9) * h * 0.05, -h * 1.9, h * 0.55);
        context.quadraticCurveTo(-h * 1.3, h * 0.65, -h * 0.7, h * 0.58);
        context.closePath();
        context.fill();

        const ink = rgba([6, 18, 36, 1], 0.92);
        context.strokeStyle = ink;
        context.fillStyle = ink;
        context.lineCap = "round";
        context.lineJoin = "round";

        /* Board. */
        context.beginPath();
        context.ellipse(0, h * 0.5, h * 0.8, h * 0.09, -0.08, 0, TAU);
        context.fill();

        /* Legs, torso, arms. */
        context.lineWidth = h * 0.075;
        context.beginPath();
        context.moveTo(-h * 0.36, h * 0.44);
        context.lineTo(-h * 0.2, h * 0.24);
        context.lineTo(h * 0.02, h * 0.1);
        context.moveTo(-h * 0.06, h * 0.44);
        context.lineTo(h * 0.12, h * 0.28);
        context.lineTo(h * 0.02, h * 0.1);
        context.lineTo(h * 0.26, -h * 0.24);
        context.moveTo(h * 0.26, -h * 0.24);
        context.lineTo(h * 0.62, -h * 0.08);
        context.moveTo(h * 0.26, -h * 0.24);
        context.lineTo(-h * 0.08, -h * 0.02);
        context.stroke();

        /* Head. */
        context.beginPath();
        context.arc(h * 0.37, -h * 0.4, h * 0.11, 0, TAU);
        context.fill();

        context.restore();

        if (animate && Math.random() < 0.6) {
            spawnSpray(x - h * 1.2, y + h * 0.4, 1, -60, -90);
        }
    }

    /* A frame --------------------------------------------------------------- */

    function draw(t, dt) {
        const { deep, mid, light, foam } = colors;
        const eye = ring(0, t);

        /* Spray haze beyond the lip, top left. */
        const haze = context.createRadialGradient(width * 0.12, height * 0.18, 10, width * 0.12, height * 0.18, height * 0.7);
        haze.addColorStop(0, rgba(foam, 0.35));
        haze.addColorStop(1, rgba(foam, 0));
        context.fillStyle = haze;
        context.fillRect(0, 0, width, height);

        /* The wall: rings from the mouth in to the eye, darkest nearest. The
           bands creep outward, so the water seems to pour over towards us. */
        const drift = (t * 0.06) % (1 / WAVE.rings);
        ellipse(ring(1, t), 1, rgba(deep));

        for (let i = WAVE.rings; i >= 0; i -= 1) {
            const k = Math.min(1, i / WAVE.rings + drift);
            const c = ring(k, t);
            const shade = mix(light, deep, Math.sqrt(k));
            ellipse(c, 0.45, rgba(shade));
        }

        /* Light from the eye across the wall. */
        const glow = context.createRadialGradient(eye.x, eye.y, eye.r, eye.x, eye.y, height * 0.85);
        glow.addColorStop(0, rgba(foam, 0.35));
        glow.addColorStop(0.35, rgba(light, 0.12));
        glow.addColorStop(1, rgba(deep, 0));
        context.fillStyle = glow;
        context.fillRect(0, 0, width, height);

        /* Streaks of water on the wall: short spirals that wind around the
           tube as they slide in towards the eye, then start again. */
        context.lineCap = "round";

        for (const [a, b, d] of streaks) {
            const from = 1 - ((t * (0.08 + d * 0.05) + b) % 1) * 0.85;
            const to = from - 0.18;
            const angle = Math.PI * 1.05 + a * Math.PI * 1.15;
            const fade = Math.min(1, (1 - from) * 6, (from - 0.05) * 6);
            context.strokeStyle = rgba(foam, (0.08 + d * 0.16) * fade);
            context.lineWidth = 1 + d * 2.5;
            context.beginPath();

            for (let i = 0; i <= 8; i += 1) {
                const f = i / 8;
                const k = Math.max(0.05, from + (to - from) * f);
                const [x, y] = onRing(k, angle + f * 0.35, t);

                if (i === 0) {
                    context.moveTo(x, y);
                } else {
                    context.lineTo(x, y);
                }
            }

            context.stroke();
        }

        /* The eye: light through the far end of the tube. */
        const eyeGlow = context.createRadialGradient(eye.x, eye.y, 0, eye.x, eye.y, eye.r * 2.4);
        eyeGlow.addColorStop(0, rgba(foam, 0.8));
        eyeGlow.addColorStop(0.35, rgba(foam, 0.4));
        eyeGlow.addColorStop(1, rgba(foam, 0));
        context.fillStyle = eyeGlow;
        context.fillRect(eye.x - eye.r * 2.4, eye.y - eye.r * 2.4, eye.r * 4.8, eye.r * 4.8);
        ellipse(eye, 1, rgba(foam));

        /* The floor: flat water inside the tube, foam-lit near the eye and
           the lip, deep towards the mouth. */
        const floor = floorEdge(t);
        const floorFill = context.createLinearGradient(0, eye.y, 0, height);
        floorFill.addColorStop(0, rgba(light, 0.7));
        floorFill.addColorStop(0.4, rgba(mid, 0.95));
        floorFill.addColorStop(1, rgba(deep, 1));
        context.fillStyle = floorFill;
        context.beginPath();
        context.moveTo(-20, height + 20);

        for (const [x, y] of floor) {
            context.lineTo(x, y);
        }

        context.lineTo(width + 20, height + 20);
        context.closePath();
        context.fill();

        /* The wall curves into the floor: wide soft strokes of the water's
           own colours blur the join, then a thin line of foam sits in it. */
        context.lineCap = "round";
        context.lineJoin = "round";

        for (const [lineWidth, alpha, tone] of [[height * 0.16, 0.22, mid], [height * 0.09, 0.28, mid], [height * 0.04, 0.3, light], [18, 0.07, foam], [9, 0.14, foam], [3, 0.35, foam]]) {
            context.strokeStyle = rgba(tone, alpha);
            context.lineWidth = lineWidth;
            context.beginPath();

            for (let i = 0; i < floor.length; i += 1) {
                const [x, y] = floor[i];
                const wobble = Math.sin(x * 0.03 + t * 2.2) * 3;

                if (i === 0) {
                    context.moveTo(x, y + wobble);
                } else {
                    context.lineTo(x, y + wobble);
                }
            }

            context.stroke();
        }

        /* Ripples on the floor, sliding towards the eye. */
        context.lineWidth = 1.5;

        for (let i = 0; i < 7; i += 1) {
            const f = (i + 0.5) / 7;
            const yBase = floor[1][1] + (height - floor[1][1]) * f * f;
            context.strokeStyle = rgba(foam, 0.18 * (1 - f * 0.6));
            context.beginPath();

            for (let x = -20; x <= width + 20; x += 14) {
                const y = yBase + Math.sin(x * (0.02 - f * 0.01) - t * (1.6 + f) + i) * (3 + f * 8);

                if (x === -20) {
                    context.moveTo(x, y);
                } else {
                    context.lineTo(x, y);
                }
            }

            context.stroke();
        }

        /* The lip pouring down on the left: a curtain of falling white. */
        const curtainRight = eye.x - eye.r * 1.4;
        const curtainTop = height * 0.02;
        const curtainBottom = floor[1][1];
        const sheet = context.createLinearGradient(0, curtainTop, 0, curtainBottom);
        sheet.addColorStop(0, rgba(foam, 0.7));
        sheet.addColorStop(0.5, rgba(foam, 0.4));
        sheet.addColorStop(1, rgba(foam, 0.2));
        context.fillStyle = sheet;
        context.fillRect(0, curtainTop, curtainRight, curtainBottom - curtainTop);

        const fadeIn = context.createLinearGradient(curtainRight * 0.55, 0, curtainRight, 0);
        fadeIn.addColorStop(0, rgba(deep, 0));
        fadeIn.addColorStop(1, rgba(deep, 0.35));
        context.fillStyle = fadeIn;
        context.fillRect(curtainRight * 0.55, curtainTop, curtainRight * 0.45, curtainBottom - curtainTop);

        /* The lip itself: a thick white edge along the top-left of the tube,
           where the water comes over. */
        for (const [lineWidth, alpha] of [[height * 0.09, 0.18], [height * 0.045, 0.35], [height * 0.018, 0.6]]) {
            context.strokeStyle = rgba(foam, alpha);
            context.lineWidth = lineWidth;
            context.beginPath();

            for (let i = 0; i <= 16; i += 1) {
                const angle = Math.PI * 1.02 + (Math.PI * 0.5) * (i / 16);
                const [x, y] = onRing(0.97, angle, t);

                if (i === 0) {
                    context.moveTo(x, y);
                } else {
                    context.lineTo(x, y);
                }
            }

            context.stroke();
        }

        context.lineWidth = 3;

        for (const [a, b, d] of curtain) {
            const x = a * curtainRight + Math.sin(t * 1.5 + b * 10) * 8;
            const span = curtainBottom - curtainTop;
            const length = span * (0.14 + d * 0.32);
            const y = curtainTop + ((b * span + t * (160 + d * 160)) % span);
            context.strokeStyle = rgba(foam, 0.25 + d * 0.4);
            context.beginPath();
            context.moveTo(x, y);
            context.quadraticCurveTo(x + 4, y + length * 0.5, x + 8, Math.min(curtainBottom, y + length));
            context.stroke();
        }

        /* Whitewater where the lip lands. */
        for (const [a, b, d] of foamSeeds) {
            const x = a * curtainRight * 1.25;
            const y = curtainBottom - b * height * 0.09 + Math.sin(t * 4 + a * 30) * 4;
            const r = 5 + d * 22 + Math.sin(t * 5 + b * 20) * 2;
            context.fillStyle = rgba(foam, 0.2 + d * 0.5);
            context.beginPath();
            context.arc(x, y, r, 0, TAU);
            context.fill();
        }

        if (animate) {
            spawnSpray(curtainRight * (0.2 + Math.random() * 0.8), curtainTop + 20, 2, -40, 120);
            spawnSpray(curtainRight * Math.random(), curtainBottom - 10, 2, 60, -200);
        }

        drawSpray(dt);
        drawSurfer(t);
    }

    return {
        scale,
        interval: 1000 / 30,

        resize(w, h) {
            width = w / scale;
            height = h / scale;
        },

        recolour() {
            colors = readColors();
        },

        draw(now) {
            const dt = lastNow === null ? 0 : Math.min(0.1, (now - lastNow) / 1000);
            lastNow = now;

            const t = animate ? now / 1000 : 12;

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

    return {
        recolour() {
            scene.recolour();
            scene.draw(lastTime);
        },

        stop() {
            stopped = true;
            cancelAnimationFrame(request);
            window.removeEventListener("resize", onResize);
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
