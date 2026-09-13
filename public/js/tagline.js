/**
 * Hover effects for the tagline. Each phrase marked with data-effect is split
 * into per-letter spans (the phrase keeps an aria-label with the full text).
 *
 *   enchant   Letters wobble and shimmer like an enchanted item while hovered,
 *             then wind down after the pointer leaves.
 *   gears     Every "o" becomes a small gear that spins up while hovered and
 *             winds down with friction after the pointer leaves.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

const ENCHANT = {
    lift: 5,            // px of vertical wobble at full strength
    tilt: 9,            // degrees of rotation at full strength
    rampIn: 0.12,       // fraction of the gap closed per frame while hovered
    windDown: 0.035,    // fraction of the strength lost per frame after leaving
    shimmer: "#cdb4ff", // colour the sheen mixes towards
};

const GEAR = {
    teeth: 8,
    speed: 0.25,        // degrees per millisecond at full strength
    scale: 1.3,         // gear diameter relative to the letter's ink height
    rampIn: 0.1,
    windDown: 0.03,
};

/* Splitting --------------------------------------------------------------- */

function splitIntoLetters(phrase) {
    const text = phrase.textContent;
    const fragment = document.createDocumentFragment();
    let index = 0;

    for (const word of text.split(/(\s+)/)) {
        if (/^\s+$/.test(word)) {
            fragment.append(word);
            continue;
        }

        const wordSpan = document.createElement("span");
        wordSpan.className = "letters__word";

        for (const char of Array.from(word)) {
            const letter = document.createElement("span");
            letter.className = "letters__letter";
            letter.textContent = char;
            letter.style.setProperty("--i", index);
            wordSpan.append(letter);
            index += 1;
        }

        fragment.append(wordSpan);
    }

    phrase.setAttribute("aria-label", text);
    phrase.classList.add("letters");
    phrase.replaceChildren(fragment);

    return [...phrase.querySelectorAll(".letters__letter")];
}

/**
 * Run `update(strength, delta)` every frame while hovered and until the
 * effect has wound down after leaving. Returns the hover handlers' wiring.
 */
function animateWhileHovered(phrase, { rampIn, windDown, update, reset }) {
    let strength = 0;
    let hovered = false;
    let running = false;
    let lastFrame = 0;

    function frame(now) {
        const delta = lastFrame ? Math.min(now - lastFrame, 50) : 16;
        lastFrame = now;

        strength += hovered ? (1 - strength) * rampIn : -strength * windDown;
        update(strength, delta);

        if (!hovered && strength < 0.005) {
            reset();
            strength = 0;
            running = false;
            lastFrame = 0;
            return;
        }

        requestAnimationFrame(frame);
    }

    function start() {
        if (!running) {
            running = true;
            requestAnimationFrame(frame);
        }
    }

    phrase.addEventListener("pointerenter", () => {
        hovered = true;
        start();
    });

    phrase.addEventListener("pointerleave", () => {
        hovered = false;
        start();
    });
}

/* Enchant ----------------------------------------------------------------- */

function enchant(phrase) {
    const letters = splitIntoLetters(phrase);
    let clock = 0;

    animateWhileHovered(phrase, {
        rampIn: ENCHANT.rampIn,
        windDown: ENCHANT.windDown,

        update(strength, delta) {
            /* The wobble slows as it fades, so it decelerates rather than shrinks. */
            clock += delta * (0.35 + 0.65 * strength);

            letters.forEach((letter, i) => {
                const lift = Math.sin(clock * 0.012 + i * 0.9) * ENCHANT.lift * strength;
                const tilt = Math.cos(clock * 0.010 + i * 1.3) * ENCHANT.tilt * strength;
                const sheen = strength * (0.5 + 0.5 * Math.sin(clock * 0.008 - i * 0.7));

                letter.style.transform = `translateY(${lift.toFixed(2)}px) rotate(${tilt.toFixed(2)}deg)`;
                letter.style.color = `color-mix(in srgb, currentcolor, ${ENCHANT.shimmer} ${(sheen * 100).toFixed(0)}%)`;
            });
        },

        reset() {
            for (const letter of letters) {
                letter.style.transform = "";
                letter.style.color = "";
            }
        },
    });
}

/* Gears ------------------------------------------------------------------- */

/** Outline of a gear centred on the origin, in a 20-unit box, with a hole. */
function gearPath(teeth, outer = 10, inner = 7.4, hole = 2.8) {
    const step = (Math.PI * 2) / teeth;
    const points = [];

    for (let i = 0; i < teeth; i += 1) {
        const base = i * step;
        const corners = [[inner, 0], [outer, step * 0.2], [outer, step * 0.45], [inner, step * 0.65]];

        for (const [radius, offset] of corners) {
            const x = Math.cos(base + offset) * radius;
            const y = Math.sin(base + offset) * radius;
            points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
        }
    }

    const body = `M ${points.join(" L ")} Z`;
    const cutout = `M ${hole},0 A ${hole},${hole} 0 1,0 ${-hole},0 A ${hole},${hole} 0 1,0 ${hole},0 Z`;

    return `${body} ${cutout}`;
}

function createGear() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "gear");
    svg.setAttribute("viewBox", "-10 -10 20 20");
    svg.setAttribute("aria-hidden", "true");

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", gearPath(GEAR.teeth));
    path.setAttribute("fill-rule", "evenodd");
    svg.append(path);

    return svg;
}

/**
 * Place a gear over its letter's ink. The baseline is found with an empty
 * inline-block marker (its bottom sits on the baseline) and the glyph's ink
 * extent comes from canvas text metrics.
 */
function positionGear(cog) {
    const context = document.createElement("canvas").getContext("2d");
    context.font = getComputedStyle(cog.glyph).font;

    const metrics = context.measureText(cog.glyph.textContent);
    const inkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    const inkCentre = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
    const baseline = cog.marker.getBoundingClientRect().bottom;
    const box = cog.letter.getBoundingClientRect();

    cog.letter.style.setProperty("--gear-y", `${(baseline - inkCentre - box.top).toFixed(2)}px`);
    cog.letter.style.setProperty("--gear-size", `${(inkHeight * GEAR.scale).toFixed(2)}px`);
}

function gears(phrase) {
    const letters = splitIntoLetters(phrase);
    const cogs = [];

    for (const letter of letters) {
        if (letter.textContent.toLowerCase() !== "o") {
            continue;
        }

        const glyph = document.createElement("span");
        glyph.className = "gear__glyph";
        glyph.textContent = letter.textContent;

        const marker = document.createElement("span");
        marker.className = "gear__baseline";

        const gear = createGear();

        letter.classList.add("letters__letter--gear");
        letter.replaceChildren(glyph, marker, gear);

        /* Neighbouring gears turn opposite ways, offset by half a tooth so
           their teeth interleave. */
        const index = cogs.length;
        cogs.push({
            letter,
            glyph,
            marker,
            gear,
            direction: index % 2 === 0 ? 1 : -1,
            phase: (index % 2) * (180 / GEAR.teeth),
        });
    }

    if (cogs.length === 0) {
        return;
    }

    let angle = 0;

    phrase.addEventListener("pointerenter", () => {
        cogs.forEach(positionGear);
    });

    animateWhileHovered(phrase, {
        rampIn: GEAR.rampIn,
        windDown: GEAR.windDown,

        update(strength, delta) {
            angle += delta * GEAR.speed * strength;

            for (const cog of cogs) {
                cog.gear.style.transform = `rotate(${(cog.direction * angle + cog.phase).toFixed(2)}deg)`;
                cog.gear.style.opacity = strength.toFixed(3);
                cog.glyph.style.opacity = (1 - strength).toFixed(3);
            }
        },

        reset() {
            for (const cog of cogs) {
                cog.gear.style.opacity = "";
                cog.glyph.style.opacity = "";
            }
        },
    });
}

/* Bootstrap --------------------------------------------------------------- */

function init() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
    }

    if (!window.matchMedia("(hover: hover)").matches) {
        return;
    }

    for (const phrase of document.querySelectorAll("[data-effect='enchant']")) {
        enchant(phrase);
    }

    for (const phrase of document.querySelectorAll("[data-effect='gears']")) {
        gears(phrase);
    }
}

init();
