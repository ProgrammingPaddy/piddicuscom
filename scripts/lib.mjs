/**
 * Paths and small helpers shared by the project scripts.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const publicDir = path.join(repoRoot, "public");
export const projectsDir = path.join(publicDir, "projects");
export const manifestPath = path.join(projectsDir, "projects.json");

/** Optional per-project metadata file, kept next to the project's entry page. */
export const projectConfigName = "project.json";

/** A repo's own project.json, saved by sync; the site's file overrides it. */
export const repoConfigName = "project.repo.json";

/** Folders and files whose name starts with one of these are never projects. */
const IGNORED_PREFIXES = ["_", "."];

export function isProjectName(name) {
    return !IGNORED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function readJson(file, fallback = undefined) {
    if (!fs.existsSync(file)) {
        return fallback;
    }

    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        throw new Error(`${relative(file)} is not valid JSON: ${error.message}`);
    }
}

export function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** Repo-relative path with forward slashes, for log output. */
export function relative(file) {
    return path.relative(repoRoot, file).split(path.sep).join("/");
}

/** True when the given module is the one node was asked to run. */
export function isMain(moduleUrl) {
    return Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === moduleUrl;
}
