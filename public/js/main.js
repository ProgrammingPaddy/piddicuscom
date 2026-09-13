/**
 * Homepage behaviour: load the generated project manifest, render the menu,
 * wire up tag filtering, card hover spotlight and scroll-reveal animations.
 */

const MANIFEST_URL = "projects/projects.json";

const grid = document.getElementById("project-grid");
const filterBar = document.getElementById("filter");
const emptyState = document.getElementById("empty-state");
const countLabel = document.getElementById("project-count");
const cardTemplate = document.getElementById("card-template");

let projects = [];
let activeTag = null;

/* Manifest ---------------------------------------------------------------- */

async function loadManifest() {
    const response = await fetch(MANIFEST_URL, { cache: "no-cache" });

    if (!response.ok) {
        throw new Error(`Manifest request failed with ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data.projects) ? data.projects : [];
}

/* Helpers ----------------------------------------------------------------- */

/** Stable 0-359 hue from a string, so a project keeps its colour between visits. */
function hueFromString(text) {
    let hash = 0;

    for (const char of text) {
        hash = (hash * 31 + char.codePointAt(0)) % 360;
    }

    return hash;
}

function firstGrapheme(text) {
    const [first] = Array.from(text.trim());
    return first ? first.toUpperCase() : "?";
}

function formatIndex(index) {
    return String(index + 1).padStart(2, "0");
}

/* Rendering --------------------------------------------------------------- */

function createCard(project, index) {
    const fragment = cardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".card");
    const link = fragment.querySelector(".card__link");
    const icon = fragment.querySelector(".card__icon");
    const source = fragment.querySelector(".card__source");
    const tagList = fragment.querySelector(".card__tags");

    card.style.setProperty("--card-index", index);
    card.style.setProperty("--card-hue", hueFromString(project.slug));

    link.href = project.href;
    fragment.querySelector(".card__title").textContent = project.title;
    fragment.querySelector(".card__description").textContent = project.description || "";
    fragment.querySelector(".card__index").textContent = formatIndex(index);

    if (project.icon) {
        icon.textContent = project.icon;
    } else {
        icon.textContent = firstGrapheme(project.title);
        icon.classList.add("card__icon--letter");
    }

    for (const tag of project.tags || []) {
        const item = document.createElement("li");
        item.className = "card__tag";
        item.textContent = tag;
        tagList.append(item);
    }

    if (project.repo) {
        source.href = project.repo;
        source.hidden = false;
    }

    return fragment;
}

function renderGrid() {
    const visible = activeTag
        ? projects.filter((project) => (project.tags || []).includes(activeTag))
        : projects;

    grid.replaceChildren(...visible.map(createCard));
    grid.setAttribute("aria-busy", "false");

    emptyState.hidden = projects.length > 0;

    if (projects.length === 0) {
        countLabel.textContent = "";
    } else if (activeTag) {
        countLabel.textContent = `${visible.length} of ${projects.length}`;
    } else {
        countLabel.textContent = `${projects.length} ${projects.length === 1 ? "project" : "projects"}`;
    }
}

function renderFilter() {
    const tags = [...new Set(projects.flatMap((project) => project.tags || []))].sort();

    if (tags.length < 2) {
        return;
    }

    const buttons = ["all", ...tags].map((tag) => {
        const button = document.createElement("button");
        const isAll = tag === "all";

        button.type = "button";
        button.className = "chip";
        button.textContent = tag;
        button.dataset.tag = isAll ? "" : tag;
        button.setAttribute("aria-pressed", String(isAll));

        return button;
    });

    filterBar.replaceChildren(...buttons);
}

function setActiveTag(tag) {
    activeTag = tag || null;

    for (const chip of filterBar.querySelectorAll(".chip")) {
        chip.setAttribute("aria-pressed", String((chip.dataset.tag || null) === activeTag));
    }

    renderGrid();
}

/* Hover spotlight --------------------------------------------------------- */

function initSpotlight() {
    if (!window.matchMedia("(hover: hover)").matches) {
        return;
    }

    grid.addEventListener("pointermove", (event) => {
        const link = event.target.closest(".card__link");

        if (!link) {
            return;
        }

        const bounds = link.getBoundingClientRect();
        link.style.setProperty("--spot-x", `${event.clientX - bounds.left}px`);
        link.style.setProperty("--spot-y", `${event.clientY - bounds.top}px`);
    });
}

/* Scroll reveal ----------------------------------------------------------- */

function initReveal() {
    const targets = document.querySelectorAll(".reveal");

    if (!("IntersectionObserver" in window)) {
        targets.forEach((element) => element.classList.add("is-visible"));
        return;
    }

    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    entry.target.classList.add("is-visible");
                    observer.unobserve(entry.target);
                }
            }
        },
        { threshold: 0.15 }
    );

    targets.forEach((element) => observer.observe(element));
}

/* Bootstrap --------------------------------------------------------------- */

async function init() {
    document.getElementById("year").textContent = new Date().getFullYear();
    initReveal();
    initSpotlight();

    filterBar.addEventListener("click", (event) => {
        const chip = event.target.closest(".chip");
        if (chip) {
            setActiveTag(chip.dataset.tag);
        }
    });

    try {
        projects = await loadManifest();
    } catch (error) {
        console.error("Could not load project manifest:", error);
        projects = [];
    }

    renderFilter();
    renderGrid();
}

init();
