import fs from "node:fs";
import path from "node:path";

// Checked in priority order; the first lockfile found wins.
const LOCKFILES = [
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
];

/**
 * Guess which package manager a project uses, from the lockfile present at
 * its root. Defaults to "npm" when none of the known lockfiles are found.
 *
 * @param {string} repoRoot Project (or monorepo) root directory.
 * @returns {"npm" | "yarn" | "pnpm" | "bun"}
 */
export function detectPackageManager(repoRoot) {
  for (const [file, manager] of LOCKFILES) {
    if (fs.existsSync(path.join(repoRoot, file))) {
      return manager;
    }
  }
  return "npm";
}
