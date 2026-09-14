/**
 * Gummy card outlines.
 *
 * Each card's shape is a superellipse (a rounded rectangle whose curvature
 * never breaks) with a faint low-frequency ripple on its radius. The ripple's
 * phases drift slowly, so the outline is always gently shifting; hovering
 * nudges the amplitude and pace up a little. Everything is seeded from the
 * card's slug so shapes differ per card and never change between visits.
 *
 * The shape is drawn by an SVG behind the card's content: a tinted fill, a
 * pointer-following spotlight, and a faint stroke. The content itself never
 * repaints while the shape moves. Cards off screen are not animated.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** How far the shape sits inside the element's box, in px. */
const MARGIN = 12;

/** Points sampled around the outline. */
const SAMPLES = 32;

/** Frames per second for the drift. It is slow; more would be wasted. */
const FPS = 20;

const SHAPE = {
    exponent: [3.1, 4.2],          // superellipse roundness, per card
    waves: [                        // ripple harmonics: lobes, amplitude range, speed range (rad/s)
        { lobes: 2, amplitude: [0.010, 0.020], speed: [0.10, 0.18] },
        { lobes: 3, amplitude: [0.008, 0.016], speed: [0.14, 0.24] },
        { lobes: 5, amplitude: [0.004, 0.008], speed: [0.20, 0.32] },
    ],
    hoverAmplitude: 1.7,           // ripple amplitude multiplier while hovered
    hoverSpeed: 1.6,               // ripple speed multiplier while hovered
    hoverEase: 0.08,               // how quickly the hover boost blends in/out
};

const SPOT_RADIUS = 220;

/* Seeding ----------------------------------------------------------------- */

function hashString(text) {
    let hash = 2166136261;

    for (const char of text) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619) >>> 0;
    }

    return hash;
}

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

function pickShape(random) {
    const between = ([min, max]) => min + random() * (max - min);

    return {
        exponent: between(SHAPE.exponent),
        waves: SHAPE.waves.map((wave) => ({
            lobes: wave.lobes,
            amplitude: between(wave.amplitude),
            speed: between(wave.speed) * (random() < 0.5 ? -1 : 1),
            phase: random() * Math.PI * 2,
        })),
    };
}

/* Geometry ---------------------------------------------------------------- */

/** Distance from the centre to a superellipse edge in direction `angle`. */
function superellipseRadius(angle, a, b, n) {
    const cos = Math.abs(Math.cos(angle) / a);
    const sin = Math.abs(Math.sin(angle) / b);

    return (cos ** n + sin ** n) ** (-1 / n);
}

function outlinePoints(shape, width, height, time, boost) {
    const cx = width / 2;
    const cy = height / 2;
    const a = cx - MARGIN;
    const b = cy - MARGIN;
    const amplitudeScale = 1 + (SHAPE.hoverAmplitude - 1) * boost;
    const speedScale = 1 + (SHAPE.hoverSpeed - 1) * boost;
    const points = [];

    for (let i = 0; i < SAMPLES; i += 1) {
        const angle = (i / SAMPLES) * Math.PI * 2;
        let ripple = 0;

        for (const wave of shape.waves) {
            ripple += wave.amplitude * Math.sin(wave.lobes * angle + wave.phase + time * wave.speed * speedScale);
        }

        const radius = superellipseRadius(angle, a, b, shape.exponent) * (1 + ripple * amplitudeScale);
        points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
    }

    return points;
}

/** Closed Catmull-Rom spline through the points, as cubic Bezier path data. */
function splinePath(points) {
    const count = points.length;
    const at = (i) => points[(i + count) % count];
    const segments = [];

    for (let i = 0; i < count; i += 1) {
        const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];

        segments.push(`C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`);
    }

    return `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)} ${segments.join(" ")} Z`;
}

/* Shared animation loop --------------------------------------------------- */

const cards = new Set();
let loopRunning = false;
let lastTick = 0;

const visibility = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        const card = entry.target.__card;

        if (card) {
            card.visible = entry.isIntersecting;
        }
    }
});

function tick(now) {
    if (now - lastTick >= 1000 / FPS) {
        lastTick = now;
        const time = now / 1000;

        for (const card of cards) {
            if (card.visible || card.boost > 0) {
                card.render(time);
            }
        }
    }

    requestAnimationFrame(tick);
}

function startLoop() {
    if (!loopRunning) {
        loopRunning = true;
        requestAnimationFrame(tick);
    }
}

/* Building one card ------------------------------------------------------- */

function svgElement(name, attributes = {}) {
    const node = document.createElementNS(SVG_NS, name);

    for (const [key, value] of Object.entries(attributes)) {
        node.setAttribute(key, String(value));
    }

    return node;
}

let cardCount = 0;

/**
 * Shape one card link. `seedText` (usually the project slug or the href)
 * decides the shape.
 */
export function shapeCardLink(link, seedText) {
    if (link.querySelector(".card__shape")) {
        return;
    }

    const id = `card-shape-${cardCount += 1}`;
    const shape = pickShape(createRandom(hashString(seedText)));

    const svg = svgElement("svg", { class: "card__shape", "aria-hidden": "true" });
    const defs = svgElement("defs");

    const tint = svgElement("linearGradient", { id: `${id}-tint`, x1: 0, y1: 0, x2: 1, y2: 1 });
    tint.append(
        svgElement("stop", { offset: 0, class: "card__tint-start" }),
        svgElement("stop", { offset: 1, class: "card__tint-end" })
    );

    const spot = svgElement("radialGradient", { id: `${id}-spot`, gradientUnits: "userSpaceOnUse", cx: 0, cy: 0, r: SPOT_RADIUS });
    spot.append(
        svgElement("stop", { offset: 0, class: "card__spot-start" }),
        svgElement("stop", { offset: 0.7, class: "card__spot-end" })
    );

    defs.append(tint, spot);

    const fill = svgElement("path", { class: "card__fill", fill: `url(#${id}-tint)` });
    const glow = svgElement("path", { class: "card__spot", fill: `url(#${id}-spot)` });
    const stroke = svgElement("path", { class: "card__stroke" });

    svg.append(defs, fill, glow, stroke);
    link.prepend(svg);

    const card = {
        visible: true,
        boost: 0,
        hovered: false,
        width: 0,
        height: 0,
        render(time) {
            if (card.width === 0) {
                return;
            }

            card.boost += ((card.hovered ? 1 : 0) - card.boost) * SHAPE.hoverEase;

            if (card.boost < 0.001) {
                card.boost = 0;
            }

            const d = splinePath(outlinePoints(shape, card.width, card.height, time, card.boost));
            fill.setAttribute("d", d);
            glow.setAttribute("d", d);
            stroke.setAttribute("d", d);
        },
    };

    /* Layout size, not the transformed box: the entrance pop and the hover
       squash scale the card, and the outline must ignore both. */
    function measure() {
        card.width = link.offsetWidth;
        card.height = link.offsetHeight;
        card.render(performance.now() / 1000);
    }

    measure();
    new ResizeObserver(measure).observe(link);

    link.addEventListener("pointermove", (event) => {
        const box = link.getBoundingClientRect();
        spot.setAttribute("cx", (event.clientX - box.left).toFixed(0));
        spot.setAttribute("cy", (event.clientY - box.top).toFixed(0));
    });

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
    }

    link.__card = card;
    visibility.observe(link);
    cards.add(card);
    startLoop();

    link.addEventListener("pointerenter", () => { card.hovered = true; });
    link.addEventListener("pointerleave", () => { card.hovered = false; });
    link.addEventListener("focus", () => { card.hovered = true; });
    link.addEventListener("blur", () => { card.hovered = false; });
}
