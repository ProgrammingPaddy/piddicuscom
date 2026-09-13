#!/usr/bin/env node
/**
 * Generate public/projects/projects.json from whatever is inside
 * public/projects. The homepage reads that manifest to draw the menu.
 *
 * A project is either
 *   - a folder containing at least one .html file, or
 *   - a single .html file placed directly in public/projects.
 *
 * Names starting with "_" or "." are ignored, so _template never shows up.
 *
 * Metadata comes from project.json in the folder when there is one, and
 * otherwise from the entry page itself: <title>, <meta name="description">
 * and <meta name="keywords"> (used as tags). A repo-backed project may also
 * have project.repo.json (saved by sync from the repo's own project.json);
 * the site's project.json overrides it field by field. An "icon" is an image
 * inside the folder (or a URL); without one the homepage draws a mark from
 * the project's initials.
 *
 * Usage: node scripts/build.mjs [--quiet]
 */

import fs from "node:fs";
import path from "node:path";
import {
    isMain,
    isProjectName,
    manifestPath,
    projectConfigName,
    projectsDir,
    readJson,
    relative,
    repoConfigName,
} from "./lib.mjs";

/** Only this much of an entry page is scanned for <title> and <meta> tags. */
const HEAD_SCAN_BYTES = 64 * 1024;

const HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/* Discovery ---------------------------------------------------------------- */

export function discoverProjects(warn = () => {}) {
    const projects = [];

    for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
        if (!isProjectName(entry.name)) {
            continue;
        }

        let project = null;

        if (entry.isDirectory()) {
            project = readFolderProject(entry.name, warn);
        } else if (entry.name.toLowerCase().endsWith(".html")) {
            project = readFileProject(entry.name);
        }

        if (project) {
            projects.push(project);
        }
    }

    return projects.sort(compareProjects);
}

function readFolderProject(slug, warn) {
    const folder = path.join(projectsDir, slug);
    const config = {
        ...readJson(path.join(folder, repoConfigName), {}),
        ...readJson(path.join(folder, projectConfigName), {}),
    };

    if (config.hidden === true) {
        return null;
    }

    const entry = config.entry || findEntryPage(folder);

    if (!entry) {
        warn(`${relative(folder)} has no .html file, skipping.`);
        return null;
    }

    const entryFile = path.join(folder, entry);

    if (!fs.existsSync(entryFile)) {
        warn(`${relative(folder)}: entry "${entry}" from ${projectConfigName} does not exist, skipping.`);
        return null;
    }

    const page = readPageMetadata(entryFile);
    const base = `projects/${encodeURIComponent(slug)}/`;
    const href = entry === "index.html" ? base : base + encodeURI(entry);

    return buildEntry(slug, href, config, page, resolveIcon(config.icon, folder, base, warn));
}

function resolveIcon(icon, folder, base, warn) {
    if (!icon || typeof icon !== "string") {
        return null;
    }

    if (/^https?:\/\//i.test(icon)) {
        return icon;
    }

    if (!fs.existsSync(path.join(folder, icon))) {
        warn(`${relative(folder)}: icon "${icon}" does not exist, using the generated mark.`);
        return null;
    }

    return base + encodeURI(icon);
}

function readFileProject(fileName) {
    const slug = fileName.slice(0, -".html".length);
    const page = readPageMetadata(path.join(projectsDir, fileName));

    return buildEntry(slug, `projects/${encodeURIComponent(fileName)}`, {}, page, null);
}

function findEntryPage(folder) {
    const pages = fs.readdirSync(folder)
        .filter((name) => name.toLowerCase().endsWith(".html"))
        .sort();

    if (pages.includes("index.html")) {
        return "index.html";
    }

    return pages[0] ?? null;
}

/* Metadata ----------------------------------------------------------------- */

function buildEntry(slug, href, config, page, icon) {
    const tags = config.tags ?? splitKeywords(page.keywords);

    return {
        slug,
        title: config.title || page.title || titleFromSlug(slug),
        description: config.description ?? page.description ?? "",
        icon,
        tags: normaliseTags(tags),
        href,
        order: typeof config.order === "number" ? config.order : null,
    };
}

function readPageMetadata(file) {
    const html = readHead(file);
    const meta = {};

    for (const [, attributes] of html.matchAll(/<meta\b([^>]*)>/gi)) {
        const parsed = parseAttributes(attributes);

        if (parsed.name && parsed.content !== undefined) {
            meta[parsed.name.toLowerCase()] = decodeEntities(parsed.content).trim();
        }
    }

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

    return {
        title: titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : "",
        description: meta.description,
        keywords: meta.keywords,
    };
}

function readHead(file) {
    const handle = fs.openSync(file, "r");

    try {
        const buffer = Buffer.alloc(HEAD_SCAN_BYTES);
        const bytesRead = fs.readSync(handle, buffer, 0, HEAD_SCAN_BYTES, 0);
        return buffer.toString("utf8", 0, bytesRead);
    } finally {
        fs.closeSync(handle);
    }
}

function parseAttributes(source) {
    const attributes = {};
    const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

    for (const match of source.matchAll(pattern)) {
        attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
    }

    return attributes;
}

function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
        if (code[0] === "#") {
            const isHex = code[1].toLowerCase() === "x";
            const codePoint = parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
            return Number.isNaN(codePoint) ? whole : String.fromCodePoint(codePoint);
        }

        return HTML_ENTITIES[code.toLowerCase()] ?? whole;
    });
}

function titleFromSlug(slug) {
    return slug
        .split(/[-_.\s]+/)
        .filter(Boolean)
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(" ");
}

function splitKeywords(keywords) {
    return keywords ? keywords.split(",") : [];
}

function normaliseTags(tags) {
    const cleaned = (Array.isArray(tags) ? tags : [])
        .map((tag) => String(tag).trim().toLowerCase())
        .filter(Boolean);

    return [...new Set(cleaned)];
}

function compareProjects(a, b) {
    const orderA = a.order ?? Number.POSITIVE_INFINITY;
    const orderB = b.order ?? Number.POSITIVE_INFINITY;

    if (orderA !== orderB) {
        return orderA - orderB;
    }

    return a.title.localeCompare(b.title, "en", { sensitivity: "base" });
}

/* Manifest ----------------------------------------------------------------- */

export function build({ quiet = false } = {}) {
    const warnings = [];
    const projects = discoverProjects((message) => warnings.push(message));

    const manifest = {
        projects: projects.map(({ order, ...project }) => project),
    };

    const next = JSON.stringify(manifest, null, 2) + "\n";
    const previous = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf8") : null;
    const changed = next !== previous;

    if (changed) {
        fs.writeFileSync(manifestPath, next, "utf8");
    }

    for (const message of warnings) {
        console.warn(`warning: ${message}`);
    }

    if (!quiet) {
        const noun = projects.length === 1 ? "project" : "projects";
        const state = changed ? "written" : "unchanged";
        console.log(`${relative(manifestPath)}: ${projects.length} ${noun} (${state})`);

        for (const project of projects) {
            console.log(`  ${project.title}  ->  ${project.href}`);
        }
    }

    return { projects, changed };
}

if (isMain(import.meta.url)) {
    build({ quiet: process.argv.includes("--quiet") });
}
