import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const resolvedPackageDirCache = new Map();

// Locate the installed directory of `dependencyName`, searching the given
// `fromDirs` (and the repo root's node_modules) before falling back to
// Node's own resolver.
export function resolveInstalledPackageDir(dependencyName, fromDirs, repoRoot) {
  const dirs = Array.isArray(fromDirs) ? fromDirs : [fromDirs];
  const cacheKey = `${dependencyName}\0${repoRoot}\0${dirs.join("\0")}`;
  if (resolvedPackageDirCache.has(cacheKey)) {
    return resolvedPackageDirCache.get(cacheKey);
  }
  const resolved = resolveInstalledPackageDirUncached(
    dependencyName,
    dirs,
    repoRoot,
  );
  resolvedPackageDirCache.set(cacheKey, resolved);
  return resolved;
}

function resolveInstalledPackageDirUncached(
  dependencyName,
  fromDirs,
  repoRoot,
) {
  const dirs = Array.isArray(fromDirs) ? fromDirs : [fromDirs];
  for (const fromDir of dirs) {
    const packageJsonPath = path.join(fromDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) continue;
    const require = createRequire(packageJsonPath);
    const candidateDirs = [
      path.join(fromDir, "node_modules", dependencyName),
      path.join(repoRoot, "node_modules", dependencyName),
    ];
    for (const candidateDir of candidateDirs) {
      const candidatePackageJson = path.join(candidateDir, "package.json");
      if (fs.existsSync(candidatePackageJson)) {
        return candidateDir;
      }
    }
    try {
      const resolved = require.resolve(`${dependencyName}/package.json`, {
        paths: [fromDir],
      });
      return path.dirname(resolved);
    } catch {
      try {
        return path.dirname(
          require.resolve(dependencyName, { paths: [fromDir] }),
        );
      } catch {
        continue;
      }
    }
  }
  return null;
}
