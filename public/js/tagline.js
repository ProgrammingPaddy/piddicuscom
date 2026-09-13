/**
 * Hover effects for the tagline. Each phrase marked with data-effect is split
 * into per-letter spans (the phrase keeps an aria-label with the full text).
 *
 *   enchant   Letters wobble and shimmer like an enchanted item while hovered,
 *             then wind down after the pointer leaves.
 *   hammer    A tap travels along the letters, squashing each in turn; after
 *             the pointer leaves, each letter finishes its current tap.
 */

const ENCHANT = {
    lift: 5,            // px of vertical wobble at full strength
    tilt: 9,            // degrees of rotation at full strength
    rampIn: 0.12,       // fraction of the gap closed per frame while hovered
    windDown: 0.035,    // fraction of the strength lost per frame after leaving
    shimmer: "#cdb4ff", // colour the sheen mixes towards
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

/* Enchant ----------------------------------------------------------------- */

function enchant(phrase) {
    const letters = splitIntoLetters(phrase);
    let strength = 0;
    let hovered = false;
    let running = false;
    let clock = 0;
    let lastFrame = 0;

    function frame(now) {
        const delta = lastFrame ? Math.min(now - lastFrame, 50) : 16;
        lastFrame = now;

        strength += hovered
            ? (1 - strength) * ENCHANT.rampIn
            : -strength * ENCHANT.windDown;

        /* The wobble slows as it fades, so it decelerates rather than shrinks. */
        clock += delta * (0.35 + 0.65 * strength);

        letters.forEach((letter, i) => {
            const lift = Math.sin(clock * 0.012 + i * 0.9) * ENCHANT.lift * strength;
            const tilt = Math.cos(clock * 0.010 + i * 1.3) * ENCHANT.tilt * strength;
            const sheen = strength * (0.5 + 0.5 * Math.sin(clock * 0.008 - i * 0.7));

            letter.style.transform = `translateY(${lift.toFixed(2)}px) rotate(${tilt.toFixed(2)}deg)`;
            letter.style.color = `color-mix(in srgb, currentcolor, ${ENCHANT.shimmer} ${(sheen * 100).toFixed(0)}%)`;
        });

        if (!hovered && strength < 0.005) {
            letters.forEach((letter) => {
                letter.style.transform = "";
                letter.style.color = "";
            });
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

/* Hammer ------------------------------------------------------------------ */

function hammer(phrase) {
    const letters = splitIntoLetters(phrase);
    let session = 0;

    phrase.addEventListener("pointerenter", () => {
        session += 1;
        letters.forEach((letter) => letter.classList.remove("is-done"));
        phrase.classList.add("is-active");
    });

    phrase.addEventListener("pointerleave", () => {
        const current = session;

        /* Let every letter finish the tap it is in the middle of. */
        for (const letter of letters) {
            letter.addEventListener("animationiteration", () => {
                if (session === current) {
                    letter.classList.add("is-done");
                }
            }, { once: true });
        }
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

    for (const phrase of document.querySelectorAll("[data-effect='hammer']")) {
        hammer(phrase);
    }
}

init();
