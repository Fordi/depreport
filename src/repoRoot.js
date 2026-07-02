import fs from "node:fs";
import path from "node:path";

// Ascend from `startDir` until a package.json is found; that directory is the
// project/monorepo root the report is built against.
export function findRepoRoot(startDir) {
  let repoRoot = startDir;
  while (!fs.existsSync(path.join(repoRoot, "package.json"))) {
    const parent = path.dirname(repoRoot);
    if (parent === repoRoot) {
      throw new Error("Not inside a project");
    }
    repoRoot = parent;
  }
  return repoRoot;
}
