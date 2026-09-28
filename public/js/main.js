/**
 * Homepage behaviour: load the generated project manifest, render the menu,
 * wire up category filtering and scroll-reveal.
 */

import { shapeCardLink } from "./cards.js";

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

/* Previews ---------------------------------------------------------------- */

const previewCache = new Map();

/**
 * Fetch a preview SVG once and return a fresh copy of its root element.
 * Inline SVG picks up the page's --preview-* tokens, so themes can recolour
 * it; an <img> could not. Ids are prefixed so several previews can share a
 * page without their gradients colliding.
 */
async function loadPreview(url, prefix) {
    if (!previewCache.has(url)) {
        previewCache.set(url, fetch(url).then((response) => {
            if (!response.ok) {
                throw new Error(`${url} responded ${response.status}`);
            }

            return response.text();
        }));
    }

    const markup = (await previewCache.get(url))
        .replace(/id="([^"]+)"/g, `id="${prefix}-$1"`)
        .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`);

    const svg = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
    svg.removeAttribute("width");
    svg.removeAttribute("height");

    return document.importNode(svg, true);
}

function fillPreview(figure, project) {
    if (!project.preview) {
        figure.remove();
        return;
    }

    loadPreview(project.preview, `preview-${project.slug}`)
        .then((svg) => figure.replaceChildren(svg))
        .catch((error) => {
            console.warn("Preview unavailable:", error);
            figure.remove();
        });
}

/* Rendering --------------------------------------------------------------- */

function fillTitle(title, project) {
    if (project.icon) {
        const image = document.createElement("img");
        image.className = "card__title-icon";
        image.src = project.icon;
        image.alt = "";
        image.loading = "lazy";
        title.append(image);
    }

    title.append(document.createTextNode(project.title));
}

function createCard(project, index) {
    const fragment = cardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".card");
    const link = fragment.querySelector(".card__link");
    const tagList = fragment.querySelector(".card__tags");

    card.style.setProperty("--card-index", index);

    link.href = project.href;
    link.dataset.seed = project.slug;
    link.title = project.description || "";
    fillTitle(fragment.querySelector(".card__title"), project);
    fillPreview(fragment.querySelector(".card__preview"), project);

    for (const tag of project.tags || []) {
        const item = document.createElement("li");
        item.className = "card__tag";
        item.textContent = tag;
        tagList.append(item);
    }

    return fragment;
}

function renderGrid() {
    const visible = activeTag
        ? projects.filter((project) => (project.tags || []).includes(activeTag))
        : projects;

    grid.replaceChildren(...visible.map(createCard));
    grid.setAttribute("aria-busy", "false");

    for (const link of grid.querySelectorAll(".card__link")) {
        shapeCardLink(link, link.dataset.seed);
    }

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

/* Card hover signal ------------------------------------------------------- */

/**
 * While any card is hovered or focused, <body> carries "is-card-hover" so
 * the logo can react.
 */
function initCardHoverSignal() {
    const cardFrom = (node) => (node instanceof Element ? node.closest(".card__link") : null);

    grid.addEventListener("pointerover", (event) => {
        if (cardFrom(event.target)) {
            document.body.classList.add("is-card-hover");
        }
    });

    grid.addEventListener("pointerout", (event) => {
        const leaving = cardFrom(event.target);

        if (leaving && cardFrom(event.relatedTarget) !== leaving) {
            document.body.classList.remove("is-card-hover");
        }
    });

    document.addEventListener("focusin", (event) => {
        document.body.classList.toggle("is-card-hover", Boolean(cardFrom(event.target)));
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
    initCardHoverSignal();

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
