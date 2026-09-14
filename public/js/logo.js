/**
 * Brings the wordmark to life on the homepage.
 *
 * Swaps the hero's <img> for the inline SVG, rebuilds the eyes from the
 * artwork, makes the pupils follow the pointer, blinks now and then, and
 * lets the whole wordmark be grabbed and dragged (it springs back).
 *
 * The SVG is treated as data. Nothing here depends on element ids, only on
 * the fill colours of its three paths (pink letters, white eyes, mauve pupils
 * and mouth) and on where the shapes sit. If anything about the file is
 * unexpected, the static image is left alone.
 *
 * Each eye becomes:
 *
 *   path.logo-eyelid      pink socket BEHIND the letters, so the hole in the
 *                         letter always has pink under it (blinks, seams)
 *   g.logo-eye            after the letters
 *     g.logo-eyeball      squashes shut on blink
 *       path.logo-white   full white socket
 *       g[clip-path]      clipped to the socket so the pupil never escapes
 *         path.logo-pupil translated to look around
 *
 * The mouth gets the same pink patch behind the letters, the smile on top,
 * and a small "o" that swaps in while a project card is hovered (main.js
 * puts "is-card-hover" on <body> for that).
 */

const LOGO_URL = "logo.svg";
const SVG_NS = "http://www.w3.org/2000/svg";

const FILL = {
    whites: "#ffffff",
    pupils: "#a16564",
};

/** Furthest a pupil may travel in any direction, in the SVG's own units. */
const PUPIL_TRAVEL = 24;

/** Fraction of the room between pupil and socket edge that may be used. */
const ROOM_USE = 0.85;

/** Extra units the pupil may slide under the socket edge. */
const PEEK = 1.5;

/** Pointer distance (px) at which the pupils reach full travel. */
const FULL_LOOK_DISTANCE = 320;

/** Fraction of the remaining distance covered per frame. */
const LOOK_EASE = 0.14;

/** Pupils drift back to centre after the pointer has been still this long. */
const LOOK_TIMEOUT = 3500;

/** How much bigger the pink patches behind the holes are than the holes. */
const PATCH_OVERLAP = 1;

/** Radius of the open "o" mouth, as a fraction of the mouth's smaller side. */
const OPEN_MOUTH_RADIUS = 0.36;

const BLINK_DURATION = 150;
const BLINK_GAP_MIN = 2500;
const BLINK_GAP_RANGE = 4500;

/**
 * Spring settings for dragging. While held, the wordmark chases the pointer
 * on a stiff spring so it lags and wobbles; once released, a softer,
 * underdamped spring carries it home with a few overshoots.
 */
const SPRING = {
    held: { stiffness: 220, damping: 22 },
    free: { stiffness: 70, damping: 6.5 },
    tiltPerVelocity: 0.018, // degrees per px/s of horizontal speed
    maxTilt: 14,
};

/* Path data ------------------------------------------------------------- */

/**
 * Split path data into standalone subpaths. A relative "m" after a "z" is
 * measured from the previous subpath's start, so each piece is rewritten to
 * begin with an absolute move.
 */
function splitSubpaths(d) {
    const pieces = d.split(/z/i).map((piece) => piece.trim()).filter(Boolean);
    const subpaths = [];
    let previousStart = null;

    for (const piece of pieces) {
        const match = piece.match(/^([mM])\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*([\s\S]*)$/);

        if (!match) {
            return null;
        }

        let x = Number(match[2]);
        let y = Number(match[3]);

        if (match[1] === "m" && previousStart) {
            x += previousStart.x;
            y += previousStart.y;
        }

        previousStart = { x, y };
        subpaths.push(`M ${x} ${y} ${match[4]} Z`);
    }

    return subpaths;
}

/* Boxes ----------------------------------------------------------------- */

function boxFrom(bbox) {
    return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
}

function area(box) {
    return box.width * box.height;
}

function expand(box, amount) {
    return {
        x: box.x - amount,
        y: box.y - amount,
        width: box.width + amount * 2,
        height: box.height + amount * 2,
    };
}

function union(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const right = Math.max(a.x + a.width, b.x + b.width);
    const bottom = Math.max(a.y + a.height, b.y + b.height);

    return { x, y, width: right - x, height: bottom - y };
}

function contains(outer, inner) {
    return inner.x >= outer.x
        && inner.y >= outer.y
        && inner.x + inner.width <= outer.x + outer.width
        && inner.y + inner.height <= outer.y + outer.height;
}

function centreOf(box) {
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function pointInside(box, point) {
    return point.x >= box.x && point.x <= box.x + box.width
        && point.y >= box.y && point.y <= box.y + box.height;
}

/* Shapes ---------------------------------------------------------------- */

/**
 * Measure each subpath. Needs the svg to be in the document, because
 * getBBox only works on rendered elements.
 */
function measureSubpaths(svg, subpaths) {
    const probe = document.createElementNS(SVG_NS, "path");
    svg.append(probe);

    const shapes = subpaths.map((d) => {
        probe.setAttribute("d", d);
        return { d, box: boxFrom(probe.getBBox()) };
    });

    probe.remove();
    return shapes;
}

/**
 * Fold holes back into the shape that contains them, so a pupil keeps its
 * highlight cut-out when it becomes a path of its own.
 */
function groupShapes(shapes) {
    const outers = [];
    const byArea = [...shapes].sort((a, b) => area(b.box) - area(a.box));

    for (const shape of byArea) {
        const parent = outers.find((outer) => contains(outer.box, shape.box));

        if (parent) {
            parent.holes.push(shape);
        } else {
            outers.push({ ...shape, holes: [] });
        }
    }

    return outers.map((outer) => ({
        d: [outer.d, ...outer.holes.map((hole) => hole.d)].join(" "),
        box: outer.box,
    }));
}

/**
 * The letters path has a hole punched for each eye. Find the subpath whose
 * outline matches the white-plus-pupil footprint: that is the socket.
 */
function findSocket(letterShapes, white, pupil) {
    const footprint = union(white.box, pupil.box);
    const roomy = expand(footprint, 4);

    return letterShapes
        .filter((shape) => contains(roomy, shape.box) && area(shape.box) >= area(footprint) * 0.5)
        .sort((a, b) => area(b.box) - area(a.box))[0] ?? null;
}

/* Building the face ----------------------------------------------------- */

function createPath(d, fill, className, strokeWidth = 0) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", fill);
    path.setAttribute("fill-rule", "evenodd");
    path.setAttribute("class", className);

    if (strokeWidth > 0) {
        path.setAttribute("stroke", fill);
        path.setAttribute("stroke-width", String(strokeWidth));
        path.setAttribute("stroke-linejoin", "round");
    }

    return path;
}

function createOpenMouth(box) {
    const centre = centreOf(box);
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", centre.x.toFixed(2));
    circle.setAttribute("cy", centre.y.toFixed(2));
    circle.setAttribute("r", (Math.min(box.width, box.height) * OPEN_MOUTH_RADIUS).toFixed(2));
    circle.setAttribute("fill", FILL.pupils);
    circle.setAttribute("class", "logo-mouth-open");
    return circle;
}

function createGroup(className) {
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", className);
    return group;
}

function findPathByFill(svg, fill) {
    return [...svg.querySelectorAll("path")].find(
        (path) => (path.getAttribute("fill") || "").toLowerCase() === fill
    );
}

/** Pair each white with the pupil sitting inside it. */
function pairEyes(whites, marks) {
    const used = new Set();
    const pairs = [];

    for (const white of whites) {
        const pupil = marks.find((mark) => !used.has(mark) && pointInside(white.box, centreOf(mark.box)));

        if (!pupil) {
            return null;
        }

        used.add(pupil);
        pairs.push({ white, pupil });
    }

    return { pairs, used };
}

/**
 * Replace the flat eye and pupil paths with one animated group per eye.
 * Returns the eyes, or null when the artwork does not look like a face.
 */
function buildFace(svg) {
    const lettersPath = svg.querySelector("path");
    const whitesPath = findPathByFill(svg, FILL.whites);
    const pupilsPath = findPathByFill(svg, FILL.pupils);

    if (!lettersPath || !whitesPath || !pupilsPath) {
        return null;
    }

    const letterData = splitSubpaths(lettersPath.getAttribute("d") || "");
    const whiteData = splitSubpaths(whitesPath.getAttribute("d") || "");
    const markData = splitSubpaths(pupilsPath.getAttribute("d") || "");

    if (!letterData || !whiteData || !markData) {
        return null;
    }

    const letterShapes = measureSubpaths(svg, letterData);
    const whites = groupShapes(measureSubpaths(svg, whiteData));
    const marks = groupShapes(measureSubpaths(svg, markData));

    if (whites.length !== 2 || marks.length < 3) {
        return null;
    }

    const paired = pairEyes(whites, marks);

    if (!paired) {
        return null;
    }

    const lettersFill = lettersPath.getAttribute("fill") || "#fec6d9";
    const fragment = document.createDocumentFragment();
    const eyes = [];

    paired.pairs.forEach(({ white, pupil }, index) => {
        const socket = findSocket(letterShapes, white, pupil);
        const socketData = socket ? socket.d : `${white.d} ${pupil.d}`;
        const socketBox = socket ? socket.box : union(white.box, pupil.box);

        const clipId = `logo-eye-clip-${index}`;
        const clip = document.createElementNS(SVG_NS, "clipPath");
        clip.setAttribute("id", clipId);
        clip.append(createPath(socketData, "none", "logo-clip"));

        const eyelid = createPath(socketData, lettersFill, "logo-eyelid", PATCH_OVERLAP);
        const whitePath = createPath(socketData, FILL.whites, "logo-white", 0.25);
        const pupilPath = createPath(pupil.d, FILL.pupils, "logo-pupil");

        const clipped = createGroup("logo-pupil-clip");
        clipped.setAttribute("clip-path", `url(#${clipId})`);
        clipped.append(pupilPath);

        const eyeball = createGroup("logo-eyeball");
        eyeball.append(whitePath, clipped);

        const eye = createGroup("logo-eye");
        eye.append(clip, eyeball);

        lettersPath.before(eyelid);
        fragment.append(eye);

        eyes.push({
            eyelid,
            pupilPath,
            room: {
                left: Math.max(0, pupil.box.x - socketBox.x),
                right: Math.max(0, socketBox.x + socketBox.width - (pupil.box.x + pupil.box.width)),
                up: Math.max(0, pupil.box.y - socketBox.y),
                down: Math.max(0, socketBox.y + socketBox.height - (pupil.box.y + pupil.box.height)),
            },
        });
    });

    /* Whatever is left in the mauve path is the mouth: a pink patch behind
       the letters, the smile on top, and a hidden "o" for later. */
    for (const mark of marks) {
        if (!paired.used.has(mark)) {
            lettersPath.before(createPath(mark.d, lettersFill, "logo-mouth-patch", PATCH_OVERLAP));
            fragment.append(createPath(mark.d, FILL.pupils, "logo-mouth", 0.25));
            fragment.append(createOpenMouth(mark.box));
        }
    }

    whitesPath.remove();
    pupilsPath.remove();
    svg.append(fragment);

    return eyes;
}

/* Behaviour ------------------------------------------------------------- */

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function lookAround(svg, eyes) {
    const state = eyes.map((eye) => ({ ...eye, x: 0, y: 0 }));

    let pointer = null;
    let lastMove = 0;
    let running = false;

    function targetFor(eye) {
        const box = eye.eyelid.getBoundingClientRect();
        const dx = pointer.x - (box.left + box.width / 2);
        const dy = pointer.y - (box.top + box.height / 2);
        const distance = Math.hypot(dx, dy) || 1;
        const reach = Math.min(1, distance / FULL_LOOK_DISTANCE) * PUPIL_TRAVEL;
        const { room } = eye;

        return {
            x: clamp((dx / distance) * reach, -(room.left * ROOM_USE + PEEK), room.right * ROOM_USE + PEEK),
            y: clamp((dy / distance) * reach, -(room.up * ROOM_USE + PEEK), room.down * ROOM_USE + PEEK),
        };
    }

    function frame(now) {
        const awake = pointer && now - lastMove < LOOK_TIMEOUT;
        let settled = true;

        for (const eye of state) {
            const target = awake ? targetFor(eye) : { x: 0, y: 0 };

            eye.x += (target.x - eye.x) * LOOK_EASE;
            eye.y += (target.y - eye.y) * LOOK_EASE;

            if (Math.abs(target.x - eye.x) > 0.02 || Math.abs(target.y - eye.y) > 0.02) {
                settled = false;
            }

            /* CSS transforms on inline SVG work in the SVG's user units. */
            eye.pupilPath.style.transform = `translate(${eye.x.toFixed(2)}px, ${eye.y.toFixed(2)}px)`;
        }

        if (settled && !awake) {
            running = false;
            return;
        }

        requestAnimationFrame(frame);
    }

    function wake() {
        if (!running) {
            running = true;
            requestAnimationFrame(frame);
        }
    }

    document.addEventListener("pointermove", (event) => {
        pointer = { x: event.clientX, y: event.clientY };
        lastMove = performance.now();
        wake();
    }, { passive: true });

    document.addEventListener("pointerleave", () => {
        pointer = null;
        wake();
    });
}

/** Let the wordmark be picked up, dragged about, and spring back home. */
function makeGrabbable(svg) {
    const position = { x: 0, y: 0 };
    const velocity = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };
    let grab = null;
    let running = false;
    let lastFrame = 0;

    function apply(tilt) {
        svg.style.transform = `translate(${position.x.toFixed(1)}px, ${position.y.toFixed(1)}px) rotate(${tilt.toFixed(2)}deg)`;
    }

    function frame(now) {
        const dt = Math.min((now - (lastFrame || now)) / 1000, 1 / 30);
        lastFrame = now;

        const spring = grab ? SPRING.held : SPRING.free;

        for (const axis of ["x", "y"]) {
            const force = spring.stiffness * (target[axis] - position[axis]) - spring.damping * velocity[axis];
            velocity[axis] += force * dt;
            position[axis] += velocity[axis] * dt;
        }

        const tilt = Math.max(-SPRING.maxTilt, Math.min(SPRING.maxTilt, velocity.x * SPRING.tiltPerVelocity));
        apply(tilt);

        const settled = !grab
            && Math.abs(position.x) < 0.2 && Math.abs(position.y) < 0.2
            && Math.abs(velocity.x) < 2 && Math.abs(velocity.y) < 2;

        if (settled) {
            position.x = 0;
            position.y = 0;
            velocity.x = 0;
            velocity.y = 0;
            svg.style.transform = "";
            running = false;
            lastFrame = 0;
            return;
        }

        requestAnimationFrame(frame);
    }

    function wake() {
        if (!running) {
            running = true;
            requestAnimationFrame(frame);
        }
    }

    svg.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        svg.setPointerCapture(event.pointerId);
        grab = { id: event.pointerId, startX: event.clientX - position.x, startY: event.clientY - position.y };
        svg.classList.add("is-held");
        wake();
    });

    svg.addEventListener("pointermove", (event) => {
        if (grab && event.pointerId === grab.id) {
            target.x = event.clientX - grab.startX;
            target.y = event.clientY - grab.startY;
        }
    });

    function release(event) {
        if (grab && event.pointerId === grab.id) {
            grab = null;
            target.x = 0;
            target.y = 0;
            svg.classList.remove("is-held");
            wake();
        }
    }

    svg.addEventListener("pointerup", release);
    svg.addEventListener("pointercancel", release);
}

function blinkNowAndThen(svg) {
    function close(duration) {
        svg.classList.add("is-blinking");
        setTimeout(() => svg.classList.remove("is-blinking"), duration);
    }

    function schedule() {
        setTimeout(() => {
            if (!document.hidden) {
                close(BLINK_DURATION);

                if (Math.random() < 0.2) {
                    setTimeout(() => close(BLINK_DURATION), BLINK_DURATION + 120);
                }
            }

            schedule();
        }, BLINK_GAP_MIN + Math.random() * BLINK_GAP_RANGE);
    }

    schedule();
}

/* Bootstrap ------------------------------------------------------------- */

async function fetchInlineSvg(url) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Logo request failed with ${response.status}`);
    }

    const markup = await response.text();
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
    const root = parsed.documentElement;

    if (root.nodeName !== "svg") {
        throw new Error("Logo is not an SVG document");
    }

    return document.importNode(root, true);
}

async function init() {
    const host = document.querySelector(".hero__logo");
    const image = host && host.querySelector("img");

    if (!image) {
        return;
    }

    let svg;

    try {
        svg = await fetchInlineSvg(LOGO_URL);
    } catch (error) {
        console.warn("Leaving the static logo in place:", error);
        return;
    }

    svg.setAttribute("class", "logo");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", image.alt || "Piddicus");
    svg.removeAttribute("width");
    svg.removeAttribute("height");

    image.replaceWith(svg);
    makeGrabbable(svg);

    const eyes = buildFace(svg);

    if (!eyes) {
        console.warn("Logo artwork was not recognised as a face; eyes stay still.");
        return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
    }

    lookAround(svg, eyes);
    blinkNowAndThen(svg);
}

init();
