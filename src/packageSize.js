import fs from "node:fs";
import path from "node:path";

import { resolveInstalledPackageDir } from "./packageResolution.js";

function getDirectorySize(dir) {
  let total = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += getDirectorySize(fullPath);
    } else if (entry.isFile()) {
      total += fs.statSync(fullPath).size;
    }
  }
  return total;
}

const packageSizeCache = new Map();

function getPackageSize(packageDir) {
  const realDir = fs.realpathSync.native(packageDir);
  const cached = packageSizeCache.get(realDir);
  if (cached !== undefined) return cached;
  const size = getDirectorySize(realDir);
  packageSizeCache.set(realDir, size);
  return size;
}

const transitiveSizeCache = new Map();

// Top-level entry point: the full-closure size of a package is deterministic,
// so cache it by real path. Only cache here (fresh `seen`), never inside the
// recursion, where `seen` intentionally makes results caller-relative.
export async function getTransitivePackageSize(packageDir, repoRoot) {
  const realDir = fs.realpathSync.native(packageDir);
  const cached = transitiveSizeCache.get(realDir);
  if (cached !== undefined) return cached;
  const total = await computeTransitivePackageSize(
    realDir,
    new Set(),
    repoRoot,
  );
  transitiveSizeCache.set(realDir, total);
  return total;
}

async function computeTransitivePackageSize(packageDir, seen, repoRoot) {
  const realDir = fs.realpathSync.native(packageDir);
  if (seen.has(realDir)) {
    return 0;
  }
  seen.add(realDir);

  let total = getPackageSize(realDir);
  const manifestPath = path.join(realDir, "package.json");
  if (!fs.existsSync(manifestPath)) {
    return total;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const deps = manifest.dependencies || {};
  const dependencyNames = Object.keys(deps);
  for (const dependencyName of dependencyNames) {
    const dependencyDir = resolveInstalledPackageDir(
      dependencyName,
      [realDir, repoRoot],
      repoRoot,
    );
    if (dependencyDir) {
      total += await computeTransitivePackageSize(
        dependencyDir,
        seen,
        repoRoot,
      );
    }
  }
  return total;
}
