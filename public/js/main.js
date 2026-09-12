/**
 * Homepage behaviour: load the project manifest, render the menu,
 * wire up tag filtering and scroll-reveal animations.
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

function projectHref(project) {
    const entry = project.entry || "index.html";
    return `projects/${project.slug}/${entry}`;
}

/* Rendering --------------------------------------------------------------- */

function createCard(project, index) {
    const fragment = cardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".card");
    const link = fragment.querySelector(".card__link");
    const tagList = fragment.querySelector(".card__tags");

    card.style.setProperty("--card-index", index);
    link.href = projectHref(project);
    fragment.querySelector(".card__icon").textContent = project.icon || "◆";
    fragment.querySelector(".card__title").textContent = project.title;
    fragment.querySelector(".card__description").textContent = project.description || "";

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

    emptyState.hidden = projects.length > 0;
    countLabel.textContent = visible.length
        ? `${visible.length} of ${projects.length}`
        : "";
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
