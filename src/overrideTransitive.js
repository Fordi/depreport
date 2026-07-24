import fs from "node:fs";
import path from "node:path";

import { findRepoRoot } from "./repoRoot.js";
import { detectPackageManager } from "./packageManager.js";

function parseOverrideSpec(spec) {
  const at = spec.lastIndexOf("@");
  if (at <= 0 || at === spec.length - 1) {
    throw new Error(
      `Invalid override spec: ${spec}. Expected ({scope}/)?{package}@{rangeSpec}`,
    );
  }
  const name = spec.slice(0, at).trim();
  const range = spec.slice(at + 1).trim();
  const validName = /^(?:@?[^/@\s]+\/)?[^/@\s][^@\s]*$/.test(name);
  if (!name || !range || /\s/.test(name) || !validName) {
    throw new Error(
      `Invalid override spec: ${spec}. Expected ({scope}/)?{package}@{rangeSpec}`,
    );
  }
  return { name, range };
}

function overrideFieldFor(packageManager) {
  return packageManager === "yarn" ? "resolutions" : "overrides";
}

/**
 * Update root package.json overrides/resolutions with transitive pins.
 *
 * @param {object} options
 * @param {string} [options.dir="."] Any path inside the target project.
 * @param {string[]} options.specs List of ({scope}/)?{package}@{rangeSpec}.
 * @param {"npm"|"yarn"|"pnpm"|"bun"} [options.packageManager] Optional
 *   override for tests; when omitted, detected from root lockfile.
 * @returns {{ repoRoot: string, field: "overrides"|"resolutions", updates: number }}
 */
export function applyTransitiveOverrides({
  dir = ".",
  specs,
  packageManager,
}) {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error(
      "No override specs provided. Expected one or more ({scope}/)?{package}@{rangeSpec} values.",
    );
  }

  const repoRoot = findRepoRoot(path.resolve(dir));
  const manifestPath = path.join(repoRoot, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const manager = packageManager || detectPackageManager(repoRoot);
  const field = overrideFieldFor(manager);
  const current = manifest[field];
  if (current !== undefined && (typeof current !== "object" || current === null)) {
    throw new Error(`package.json field '${field}' must be an object`);
  }

  const updates = new Map();
  for (const spec of specs) {
    const { name, range } = parseOverrideSpec(spec);
    updates.set(name, range);
  }

  const merged = { ...(current || {}) };
  for (const [name, range] of updates) {
    merged[name] = range;
  }
  // Keep the manifest stable for deterministic diffs.
  manifest[field] = Object.fromEntries(
    Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)),
  );

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { repoRoot, field, updates: updates.size };
}

export { parseOverrideSpec, overrideFieldFor };
