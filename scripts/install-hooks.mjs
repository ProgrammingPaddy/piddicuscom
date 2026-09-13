#!/usr/bin/env node
/**
 * Point git at the committed .githooks folder so the project manifest is
 * regenerated on every commit. Runs automatically after `npm install`.
 *
 * Never fails the install: the hook is a convenience, and CI checkouts
 * (Cloudflare Workers Builds) do not need it.
 */

import { execFileSync } from "node:child_process";
import { repoRoot } from "./lib.mjs";

if (process.env.CI || process.env.WORKERS_CI) {
    process.exit(0);
}

try {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: repoRoot, stdio: "ignore" });
    console.log("Git hooks installed from .githooks");
} catch {
    // Not a git checkout, or git is not on PATH. Nothing to do.
}
