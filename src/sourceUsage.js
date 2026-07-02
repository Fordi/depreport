import fs from "node:fs";
import path from "node:path";

const sourceExtensions = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
]);

function walkSourceFiles(dir, files = [], skipDirs = []) {
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (
      entry.isDirectory() &&
      (skipDirs.includes(entry.name) ||
        skipDirs.includes(path.relative(dir, fullPath)))
    ) {
      continue;
    }
    if (
      entry.isDirectory() &&
      [
        "node_modules",
        "build",
        "dist",
        "coverage",
        ".git",
        ".yarn",
        ".next",
        ".turbo",
      ].includes(entry.name)
    ) {
      continue;
    }
    if (entry.isDirectory()) {
      walkSourceFiles(fullPath, files, skipDirs);
    } else if (
      entry.isFile() &&
      sourceExtensions.has(path.extname(entry.name))
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

// Extracts the quoted specifier from static import/export-from, bare
// side-effect imports, require(), and dynamic import(). One capture group
// per alternative; exactly one will be set per match.
const specifierRegex = new RegExp(
  [
    `(?:import|export)\\s+(?:[^'"]*?\\s+from\\s+)?['"]([^'"]+)['"]`,
    `require\\(\\s*['"]([^'"]+)['"]\\s*\\)`,
    `import\\(\\s*['"]([^'"]+)['"]\\s*\\)`,
  ].join("|"),
  "g",
);

const usageCountsCache = new Map();

// Walk a workspace's source tree once and count every import specifier, so a
// per-dependency lookup is O(1) instead of a full re-walk + re-read per dep.
function getUsageCounts(workspacePath, workspaceLabel) {
  const cacheKey = `${workspaceLabel}\0${workspacePath}`;
  const cached = usageCountsCache.get(cacheKey);
  if (cached) return cached;

  const skipDirs = workspaceLabel === "{root}" ? ["packages"] : [];
  const sourceFiles = walkSourceFiles(workspacePath, [], skipDirs);
  const counts = new Map();
  for (const file of sourceFiles) {
    const contents = fs.readFileSync(file, "utf8");
    specifierRegex.lastIndex = 0;
    let match;
    while ((match = specifierRegex.exec(contents)) !== null) {
      const specifier = match[1] || match[2] || match[3];
      if (specifier) {
        counts.set(specifier, (counts.get(specifier) || 0) + 1);
      }
    }
  }
  usageCountsCache.set(cacheKey, counts);
  return counts;
}

export function countUses(workspacePath, dependencyName, workspaceLabel) {
  return getUsageCounts(workspacePath, workspaceLabel).get(dependencyName) || 0;
}
