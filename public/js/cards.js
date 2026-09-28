/**
 * Wavy card edges.
 *
 * A card is a rounded rectangle whose edge carries a slight, fixed wave: each
 * point on the outline is nudged along its normal by a gentle undulation plus
 * a slow bow. Phases are seeded from the card's slug, so cards differ from
 * each other and never change between visits. Nothing here animates; the
 * shape is drawn once and again whenever the card changes size.
 *
 * The shape is an SVG behind the card's content: a tinted fill, a spotlight
 * that follows the pointer, and a faint stroke.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** How far the shape sits inside the element's box, in px. */
const MARGIN = 8;

/** Corner radius of the base rounded rectangle, in px. */
const CORNER = 26;

/** Sampling: px between points along an edge, and points per corner arc. */
const EDGE_STEP = 8;
const CORNER_SAMPLES = 8;

const WAVE = {
    wavelength: 150,   // px along the edge per ripple
    ripple: 1.3,       // px, the small waves
    bow: 1.6,          // px, one long bow around the whole outline
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

/* Geometry ---------------------------------------------------------------- */

/**
 * Sample a rounded rectangle of `width` x `height` inset by MARGIN, walking
 * clockwise. Each sample carries its outward normal and its distance along
 * the perimeter.
 */
function roundedRectSamples(width, height) {
    const m = MARGIN;
    const r = Math.min(CORNER, (Math.min(width, height) - 2 * m) / 2);
    const left = m;
    const top = m;
    const right = width - m;
    const bottom = height - m;
    const edgeW = right - left - 2 * r;
    const edgeH = bottom - top - 2 * r;
    const arc = (Math.PI / 2) * r;
    const samples = [];
    let distance = 0;

    function edge(x0, y0, x1, y1, nx, ny, length) {
        const count = Math.max(1, Math.round(length / EDGE_STEP));

        for (let i = 0; i < count; i += 1) {
            const f = i / count;
            samples.push({ x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, nx, ny, distance: distance + length * f });
        }

        distance += length;
    }

    function corner(cx, cy, startAngle) {
        for (let i = 0; i < CORNER_SAMPLES; i += 1) {
            const f = i / CORNER_SAMPLES;
            const angle = startAngle + (Math.PI / 2) * f;
            const nx = Math.cos(angle);
            const ny = Math.sin(angle);
            samples.push({ x: cx + nx * r, y: cy + ny * r, nx, ny, distance: distance + arc * f });
        }

        distance += arc;
    }

    edge(left + r, top, right - r, top, 0, -1, edgeW);
    corner(right - r, top + r, -Math.PI / 2);
    edge(right, top + r, right, bottom - r, 1, 0, edgeH);
    corner(right - r, bottom - r, 0);
    edge(right - r, bottom, left + r, bottom, 0, 1, edgeW);
    corner(left + r, bottom - r, Math.PI / 2);
    edge(left, bottom - r, left, top + r, -1, 0, edgeH);
    corner(left + r, top + r, Math.PI);

    return { samples, perimeter: distance };
}

function outlinePoints(phases, width, height) {
    const { samples, perimeter } = roundedRectSamples(width, height);

    /* A whole number of ripples fits the perimeter, so the wave closes. */
    const ripples = Math.max(4, Math.round(perimeter / WAVE.wavelength));

    return samples.map((sample) => {
        const along = (sample.distance / perimeter) * Math.PI * 2;
        const offset = WAVE.ripple * Math.sin(ripples * along + phases.ripple)
            + WAVE.bow * Math.sin(2 * along + phases.bow);

        return [sample.x + sample.nx * offset, sample.y + sample.ny * offset];
    });
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
 * decides where the waves fall.
 */
export function shapeCardLink(link, seedText) {
    if (link.querySelector(".card__shape")) {
        return;
    }

    const id = `card-shape-${cardCount += 1}`;
    const random = createRandom(hashString(seedText));
    const phases = { ripple: random() * Math.PI * 2, bow: random() * Math.PI * 2 };

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

    /* Layout size, not the transformed box: the entrance pop and the hover
       squash scale the card, and the outline must ignore both. */
    function render() {
        const width = link.offsetWidth;
        const height = link.offsetHeight;

        if (width === 0 || height === 0) {
            return;
        }

        const d = splinePath(outlinePoints(phases, width, height));
        fill.setAttribute("d", d);
        glow.setAttribute("d", d);
        stroke.setAttribute("d", d);
    }

    render();
    new ResizeObserver(render).observe(link);

    link.addEventListener("pointermove", (event) => {
        const box = link.getBoundingClientRect();
        spot.setAttribute("cx", (event.clientX - box.left).toFixed(0));
        spot.setAttribute("cy", (event.clientY - box.top).toFixed(0));
    });
}
