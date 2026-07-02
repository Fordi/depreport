import fs from "node:fs";
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
  log = () => {},
} = {}) {
  const scopedSections = sectionsForTypes(types);
  const reportColumns = { ...BUILTIN_COLUMNS, ...columns };
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

  const rows = [];
  const seenRows = new Set();

  // Collect every external package we might query and warm the registry
  // caches in parallel before the sequential row-building pass below.
  const metadataTargets = new Set();
  for (const manifest of [
    rootManifest,
    ...workspaceManifests.map((workspace) => workspace.manifest),
  ]) {
    for (const { section } of scopedSections) {
      for (const name of Object.keys(manifest[section] || {})) {
        if (!internalPackageNames.has(name)) {
          metadataTargets.add(name);
        }
      }
    }
  }
  await prefetchMetadata([...metadataTargets], npmConfig);

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
            declared: "subproject",
            type,
          });
        }
      }
    }

    if (workspace.workspaceLabel !== "{root}") {
      for (const dependencyName of rootDependencies) {
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

    for (const dependencyName of dependencyNames) {
      if (internalPackageNames.has(dependencyName)) {
        continue;
      }
      const declared = declaredByWorkspace.get(dependencyName) ||
        rootDependencyMap.get(dependencyName) || {
          version: "",
          declared: "subproject",
          type: "",
        };
      const workspaceLabel =
        workspace.workspaceLabel === "{root}"
          ? "{root}"
          : manifest.name || workspace.workspaceLabel;
      const rowKey = `${workspaceLabel}:${dependencyName}`;
      if (seenRows.has(rowKey)) {
        continue;
      }
      seenRows.add(rowKey);

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
      const isDeclaredBySubproject =
        workspace.workspaceLabel !== "{root}" &&
        scopedSections.some(
          ({ section }) =>
            manifest[section] && manifest[section][dependencyName],
        );

      // The metadata document each column extractor receives; already warmed
      // by prefetchMetadata above, so this resolves from cache.
      const metadata = await fetchNpmMetadata(dependencyName, npmConfig);

      // Omit rows whose installed version already matches the version we would
      // advise upgrading to. This is a report-level decision, independent of
      // which columns are displayed.
      const currentVersion = parseVersion(version);
      const effectiveVersion = parseVersion(
        latestEffective(metadata, requested),
      );
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
          workspace.workspaceLabel === "{root}"
            ? "root"
            : isDeclaredBySubproject
              ? "subproject"
              : "root",
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
  }

  // workspace/name are appended as implicit final keys so rows the sort spec
  // does not distinguish still come out in a deterministic order.
  rows.sort(buildComparator([...sort, "workspace", "name"]));

  return rows;
}

export default depreport;
