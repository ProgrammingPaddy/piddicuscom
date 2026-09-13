#!/usr/bin/env node
/**
 * Refresh projects that live in their own git repository.
 *
 * A repo-backed project is a folder under public/projects whose project.json
 * has a "repo" URL. This script shallow-clones that repo, replaces the
 * folder's files with the latest commit (leaving project.json alone), records
 * the commit in project.json, and regenerates the manifest.
 *
 * Usage:
 *   npm run sync                    refresh every repo-backed project
 *   npm run sync -- snake           refresh one project by folder name
 *   npm run sync -- <git url>       add a new repo-backed project, then refresh it
 *   npm run sync -- --force         re-copy even when the commit has not changed
 *
 * Nothing is committed. Review with `git status` and commit yourself.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "./build.mjs";
import {
    isMain,
    isProjectName,
    projectConfigName,
    projectsDir,
    readJson,
    relative,
    writeJson,
} from "./lib.mjs";

/** Top-level items in a project repo that should not be published. */
const EXCLUDED_FROM_COPY = new Set([
    ".git",
    ".github",
    ".gitignore",
    ".gitattributes",
    ".gitmodules",
    "node_modules",
    projectConfigName,
]);

/* Git ---------------------------------------------------------------------- */

function git(args, options = {}) {
    return execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
        ...options,
    }).trim();
}

function cloneShallow(repo, branch) {
    const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), "piddicus-"));
    const args = ["clone", "--quiet", "--depth", "1"];

    if (branch) {
        args.push("--branch", branch);
    }

    args.push("--", repo, cloneDir);

    try {
        git(args);
    } catch (error) {
        removeTemp(cloneDir);
        throw new Error(`git clone failed for ${repo}`, { cause: error });
    }

    return {
        dir: cloneDir,
        commit: git(["rev-parse", "HEAD"], { cwd: cloneDir }),
        branch: git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: cloneDir }),
    };
}

function removeTemp(dir) {
    // Git object files are read-only on Windows; retries let rmSync cope.
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}

/* Projects ----------------------------------------------------------------- */

function listRepoProjects() {
    return fs.readdirSync(projectsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && isProjectName(entry.name))
        .map((entry) => ({
            slug: entry.name,
            folder: path.join(projectsDir, entry.name),
            config: readJson(path.join(projectsDir, entry.name, projectConfigName), {}),
        }))
        .filter((project) => typeof project.config.repo === "string" && project.config.repo);
}

function slugFromRepoUrl(url) {
    const lastSegment = url.replace(/\/+$/, "").split(/[/:]/).pop() ?? "";
    const slug = lastSegment.replace(/\.git$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

    if (!slug) {
        throw new Error(`Could not work out a folder name from ${url}`);
    }

    return slug;
}

function addRepoProject(url) {
    const slug = slugFromRepoUrl(url);
    const folder = path.join(projectsDir, slug);
    const configPath = path.join(folder, projectConfigName);
    const existing = readJson(configPath, null);

    if (existing?.repo && existing.repo !== url) {
        throw new Error(`${relative(folder)} already tracks ${existing.repo}`);
    }

    if (fs.existsSync(folder) && !existing) {
        throw new Error(`${relative(folder)} already exists and is not repo-backed. Delete it or pick a different name.`);
    }

    fs.mkdirSync(folder, { recursive: true });
    writeJson(configPath, { ...existing, repo: url });
    console.log(`Added ${relative(folder)} tracking ${url}`);

    return { slug, folder, config: readJson(configPath) };
}

function replaceProjectFiles(folder, cloneDir) {
    for (const name of fs.readdirSync(folder)) {
        if (name !== projectConfigName) {
            fs.rmSync(path.join(folder, name), { recursive: true, force: true });
        }
    }

    fs.cpSync(cloneDir, folder, {
        recursive: true,
        filter: (source) => {
            const name = path.basename(source);
            const isTopLevel = path.dirname(source) === cloneDir;

            if (name === ".git") {
                return false;
            }

            return !(isTopLevel && EXCLUDED_FROM_COPY.has(name));
        },
    });
}

function syncProject(project, { force }) {
    const { slug, folder, config } = project;
    const label = relative(folder);

    console.log(`Checking ${label} ...`);

    const clone = cloneShallow(config.repo, config.branch);

    try {
        const before = config.commit ? config.commit.slice(0, 7) : "none";
        const after = clone.commit.slice(0, 7);

        if (clone.commit === config.commit && !force) {
            console.log(`  already at ${after}`);
            return false;
        }

        replaceProjectFiles(folder, clone.dir);
        writeJson(path.join(folder, projectConfigName), { ...config, commit: clone.commit });
        console.log(`  ${before} -> ${after} (${clone.branch})`);
        return true;
    } finally {
        removeTemp(clone.dir);
    }
}

/* Entry point -------------------------------------------------------------- */

function main(argv) {
    const force = argv.includes("--force");
    const targets = argv.filter((arg) => !arg.startsWith("--"));

    let projects;

    if (targets.length === 0) {
        projects = listRepoProjects();
    } else {
        projects = targets.map((target) => {
            if (/^(https?:|git@|ssh:)/i.test(target) || target.endsWith(".git")) {
                return addRepoProject(target);
            }

            const match = listRepoProjects().find((project) => project.slug === target);

            if (!match) {
                throw new Error(`No repo-backed project named "${target}" under ${relative(projectsDir)}.`);
            }

            return match;
        });
    }

    if (projects.length === 0) {
        console.log("No repo-backed projects. Add one with: npm run sync -- <git url>");
        return;
    }

    let updated = 0;
    let failed = 0;

    for (const project of projects) {
        try {
            if (syncProject(project, { force })) {
                updated += 1;
            }
        } catch (error) {
            failed += 1;
            console.error(`  failed: ${error.message}`);
        }
    }

    console.log("");
    build();
    console.log("");

    if (updated > 0) {
        console.log(`${updated} updated. Review with "git status" and commit when ready.`);
    } else if (failed === 0) {
        console.log("Everything is up to date.");
    }

    if (failed > 0) {
        process.exitCode = 1;
    }
}

if (isMain(import.meta.url)) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error(`error: ${error.message}`);
        process.exitCode = 1;
    }
}
