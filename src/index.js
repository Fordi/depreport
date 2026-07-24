import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findRepoRoot } from "./repoRoot.js";
import { countUses } from "./sourceUsage.js";
import { resolveInstalledPackageDir } from "./packageResolution.js";
import { loadNpmConfig } from "./npmConfig.js";
import { prefetchMetadata, fetchNpmMetadata } from "./registry.js";
import { parseVersion, compareVersions } from "./version.js";
import { sectionsForTypes, DEFAULT_TYPES } from "./depTypes.js";
import { BUILTIN_COLUMNS, latestEffective } from "./columns.js";
import { DEFAULT_SORT, buildComparator } from "./sort.js";

// CSV rendering is part of the public API: rows from depreport() feed straight
// into toCsv(), so consumers get both from the package root.
export { toCsv, REPORT_COLUMNS, REPORT_FORMATTERS } from "./csv.js";

const ROW_CONCURRENCY = Number(
  process.env.DEPREPORT_ROW_CONCURRENCY || os.cpus().length - 1,
);

// Walk the installed dependency graph reachable from `seedNames` and return
// the packages that are not direct seed dependencies.
function collectTransitiveDependencyMap(
  seedNames,
  fromDirs,
  repoRoot,
  internalPackageNames,
) {
  const seedSet = new Set(seedNames);
  const visited = new Set(seedNames);
  const queue = [...seedNames];
  const transitive = new Map();

  while (queue.length > 0) {
    const name = queue.shift();
    const packageDir = resolveInstalledPackageDir(name, fromDirs, repoRoot);
    if (!packageDir) {
      continue;
    }
    const manifestPath = path.join(packageDir, "package.json");
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const deps = manifest.dependencies || {};
    for (const [depName, depRange] of Object.entries(deps)) {
      if (internalPackageNames.has(depName)) {
        continue;
      }
      if (!visited.has(depName)) {
        visited.add(depName);
        queue.push(depName);
      }
      if (seedSet.has(depName) || transitive.has(depName)) {
        continue;
      }
      transitive.set(depName, {
        version: depRange,
        declared: "transitive",
        type: "main",
      });
    }
  }

  return transitive;
}

/**
 * Build a dependency report for the project (or monorepo) containing `dir`.
 *
 * Resolves the repo root, reads the root and workspace manifests, counts
 * import usage across source files, measures installed transitive sizes, and
 * queries the npm registry for publish dates / latest versions. Rows whose
 * installed version already matches the latest effective version are omitted.
 *
 * @param {object} [options]
 * @param {string} [options.dir="."] Directory to start from; the report is
 *   built for the nearest ancestor containing a package.json.
 * @param {("main"|"dev"|"peer"|"optional")[]} [options.types] Which manifest
 *   dependency sections to include, mapping main->dependencies,
 *   dev->devDependencies, peer->peerDependencies, optional->optionalDependencies.
 *   Defaults to ["main", "dev"].
 * @param {(message: string) => void} [options.log] Optional progress sink for
 *   diagnostic messages (repo root, manifests, workspaces). Defaults to no-op.
 * @param {Record<string, import("./columns.js").ColumnExtractor>} [options.columns]
 *   Extra columns to compute for every row, merged on top of the built-ins.
 *   Each extractor follows the `async (metadata, context) => value` contract;
 *   see columns.js. A key matching a built-in replaces it.
 * @param {string[]} [options.sort] Row ordering: column names, each optionally
 *   prefixed with `+` (ascending, the default) or `-` (descending), applied in
 *   order. Defaults to ["-needsBump", "published", "-size"]; remaining ties
 *   break by `workspace` then `name`.
 * @param {boolean} [options.full=false] In a single-package repo the
 *   `workspace` and `declared` columns are vestigial (every row would say
 *   undefined/"root") and are dropped from the rows; pass true to keep them.
 * @param {boolean} [options.transitive=false] Include transitive
 *   dependencies reached from the selected declared dependencies.
 * @param {boolean} [options.transitiveOnly=false] Include only transitive
 *   dependencies (direct dependencies are still used as traversal roots).
 * @param {boolean} [options.includeSize=true] Include the built-in `size`
 *   column extractor. Set false to skip transitive on-disk size computation.
 * @returns {Promise<Array<object>>} Array of dependency rows, ordered per
 *   `sort`. Each row has the built-in fields (name, workspace, requested,
 *   version, published, latest, latestBump, needsBump, size, uses, declared,
 *   type) plus any custom columns; see `full` for the two fields omitted in
 *   single-package repos.
 */
export async function depreport({
  dir = ".",
  types = DEFAULT_TYPES,
  columns = {},
  sort = DEFAULT_SORT,
  full = false,
  transitive = false,
  transitiveOnly = false,
  includeSize = true,
  log = () => {},
} = {}) {
  const includeTransitive = transitive || transitiveOnly;
  const scopedSections = sectionsForTypes(types);
  const reportColumns = { ...BUILTIN_COLUMNS, ...columns };
  if (!includeSize && !("size" in columns)) {
    delete reportColumns.size;
  }
  const startDir = path.resolve(dir);
  const repoRoot = findRepoRoot(startDir);
  log(`Repository root: ${repoRoot}`);

  const rootManifestPath = path.join(repoRoot, "package.json");
  const rootManifest = JSON.parse(fs.readFileSync(rootManifestPath, "utf8"));
  const workspaces = Array.isArray(rootManifest.workspaces)
    ? rootManifest.workspaces
    : [];
  log(`Root manifest: ${rootManifestPath} (${rootManifest.name})`);

  const workspacePaths = workspaces.map((workspace) =>
    path.resolve(repoRoot, workspace),
  );
  const workspaceManifests = [];
  const internalPackageNames = new Set();
  if (rootManifest.name) {
    internalPackageNames.add(rootManifest.name);
  }
  if (workspacePaths.length) {
    log("Workspaces:");
  }
  for (const workspacePath of workspacePaths) {
    const manifestPath = path.join(workspacePath, "package.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest.name) {
        internalPackageNames.add(manifest.name);
      }
      log(`  ${manifest.name}`);
      workspaceManifests.push({
        workspacePath,
        manifestPath,
        manifest,
        workspaceLabel: path.relative(repoRoot, workspacePath),
      });
    }
  }

  // In a single-package repo every row would report the same workspace
  // (undefined) and declared ("root"), so those columns are vestigial and
  // dropped -- unless `full` asks for them, or the caller supplied their own
  // extractor for one of them.
  if (!full && workspaceManifests.length === 0) {
    for (const vestigial of ["workspace", "declared"]) {
      if (!(vestigial in columns)) {
        delete reportColumns[vestigial];
      }
    }
  }

  const npmConfig = loadNpmConfig(startDir, repoRoot);

  const rootDependencies = new Set();
  const rootDependencyMap = new Map();
  for (const { type, section } of scopedSections) {
    for (const [name, version] of Object.entries(rootManifest[section] || {})) {
      rootDependencies.add(name);
      // Canonical order: the first section a package appears in wins.
      if (!rootDependencyMap.has(name)) {
        rootDependencyMap.set(name, { version, declared: "root", type });
      }
    }
  }

  const workspaceContexts = [];
  for (const workspace of [
    {
      workspaceLabel: "{root}",
      workspacePath: repoRoot,
      manifestPath: rootManifestPath,
      manifest: rootManifest,
    },
  ].concat(workspaceManifests)) {
    const manifest = workspace.manifest;
    const workspaceDir = workspace.workspacePath;
    const dependencyNames = new Set();
    const declaredByWorkspace = new Map();

    for (const { type, section } of scopedSections) {
      const deps = manifest[section] || {};
      for (const [name, version] of Object.entries(deps)) {
        dependencyNames.add(name);
        // Canonical order: the first section a package appears in wins.
        if (!declaredByWorkspace.has(name)) {
          declaredByWorkspace.set(name, {
            version,
            declared:
              workspace.workspaceLabel === "{root}" ? "root" : "subproject",
            type,
          });
        }
      }
    }

    if (workspace.workspaceLabel !== "{root}") {
      for (const dependencyName of rootDependencies) {
        // A workspace's own declaration wins over the root's: inheritance is
        // only for deps the workspace uses without declaring, so a package
        // that is (say) dev at the root and main here keeps its own type,
        // range, and declared label.
        if (declaredByWorkspace.has(dependencyName)) {
          continue;
        }
        const uses = countUses(
          workspaceDir,
          dependencyName,
          workspace.workspaceLabel,
        );
        if (uses > 0) {
          dependencyNames.add(dependencyName);
          declaredByWorkspace.set(dependencyName, {
            version: rootDependencyMap.get(dependencyName)?.version,
            declared: "root",
            type: rootDependencyMap.get(dependencyName)?.type,
          });
        }
      }
    }

    if (includeTransitive) {
      const directNames = [...dependencyNames];
      const fromDirs =
        workspace.workspaceLabel === "{root}"
          ? [repoRoot]
          : [workspaceDir, repoRoot];
      const transitives = collectTransitiveDependencyMap(
        directNames,
        fromDirs,
        repoRoot,
        internalPackageNames,
      );
      for (const [name, info] of transitives) {
        if (!dependencyNames.has(name)) {
          dependencyNames.add(name);
        }
        if (!declaredByWorkspace.has(name)) {
          declaredByWorkspace.set(name, info);
        }
      }
      if (transitiveOnly) {
        for (const name of directNames) {
          dependencyNames.delete(name);
        }
      }
    }

    workspaceContexts.push({
      workspace,
      manifest,
      workspaceDir,
      dependencyNames,
      declaredByWorkspace,
    });
  }

  // Collect every external package we'll query, including discovered
  // transitive dependencies, and warm metadata caches up front.
  const metadataTargets = new Set();
  for (const { dependencyNames } of workspaceContexts) {
    for (const name of dependencyNames) {
      if (!internalPackageNames.has(name)) {
        metadataTargets.add(name);
      }
    }
  }
  await prefetchMetadata([...metadataTargets], npmConfig);

  const candidates = [];
  const seenRows = new Set();
  for (const {
    workspace,
    manifest,
    workspaceDir,
    dependencyNames,
    declaredByWorkspace,
  } of workspaceContexts) {
    for (const dependencyName of dependencyNames) {
      if (internalPackageNames.has(dependencyName)) {
        continue;
      }
      const workspaceLabel =
        workspace.workspaceLabel === "{root}"
          ? "{root}"
          : manifest.name || workspace.workspaceLabel;
      const rowKey = `${workspaceLabel}:${dependencyName}`;
      if (seenRows.has(rowKey)) {
        continue;
      }
      seenRows.add(rowKey);
      candidates.push({
        dependencyName,
        workspace,
        workspaceLabel,
        workspaceDir,
        declared:
          declaredByWorkspace.get(dependencyName) ||
          rootDependencyMap.get(dependencyName) || {
            version: "",
            declared: "subproject",
            type: "",
          },
      });
    }
  }

  const rows = [];
  const queue = [...candidates];
  const workers = Array.from(
    { length: Math.max(1, Math.min(ROW_CONCURRENCY, queue.length || 1)) },
    async () => {
      while (queue.length > 0) {
        const candidate = queue.pop();
        if (!candidate) {
          continue;
        }
        const {
          dependencyName,
          workspace,
          workspaceLabel,
          workspaceDir,
          declared,
        } = candidate;

        const uses = countUses(
          workspaceDir,
          dependencyName,
          workspace.workspaceLabel,
        );
        let version = declared.version || "";
        const fromDirs =
          workspace.workspaceLabel === "{root}"
            ? [repoRoot]
            : [workspaceDir, repoRoot];
        const packageDir = resolveInstalledPackageDir(
          dependencyName,
          fromDirs,
          repoRoot,
        );
        if (packageDir && fs.existsSync(path.join(packageDir, "package.json"))) {
          const installedManifest = JSON.parse(
            fs.readFileSync(path.join(packageDir, "package.json"), "utf8"),
          );
          version = installedManifest.version || version;
        }
        const requested = declared.version || "";

        // The metadata document each column extractor receives; already warmed
        // by prefetchMetadata above, so this resolves from cache.
        const metadata = await fetchNpmMetadata(dependencyName, npmConfig);

        // Omit rows whose installed version already matches the version we
        // would advise upgrading to.
        const currentVersion = parseVersion(version);
        const effectiveVersion = parseVersion(latestEffective(metadata, requested));
        if (
          currentVersion &&
          effectiveVersion &&
          compareVersions(currentVersion, effectiveVersion) === 0
        ) {
          continue;
        }

        const context = {
          name: dependencyName,
          // The root package has no workspace; workspaces carry their name.
          workspace:
            workspace.workspaceLabel === "{root}" ? undefined : workspaceLabel,
          requested,
          version,
          declared:
            declared.declared ||
            (workspace.workspaceLabel === "{root}" ? "root" : "subproject"),
          type: declared.type || "",
          uses,
          packageDir,
          repoRoot,
          npmConfig,
        };

        const row = {};
        for (const [columnName, extractor] of Object.entries(reportColumns)) {
          row[columnName] = await extractor(metadata, context);
        }
        rows.push(row);
      }
    },
  );
  await Promise.all(workers);

  // workspace/name are appended as implicit final keys so rows the sort spec
  // does not distinguish still come out in a deterministic order.
  rows.sort(buildComparator([...sort, "workspace", "name"]));

  return rows;
}

export default depreport;
