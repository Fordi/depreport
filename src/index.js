import fs from "node:fs";
import path from "node:path";

import { findRepoRoot } from "./repoRoot.js";
import { countUses } from "./sourceUsage.js";
import { resolveInstalledPackageDir } from "./packageResolution.js";
import { getTransitivePackageSize } from "./packageSize.js";
import { loadNpmConfig } from "./npmConfig.js";
import {
  prefetchMetadata,
  fetchPublishedAt,
  fetchLatestVersion,
  fetchLatestCompatibleVersion,
} from "./registry.js";
import { parseVersion, compareVersions } from "./version.js";

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
 * @param {(message: string) => void} [options.log] Optional progress sink for
 *   diagnostic messages (repo root, manifests, workspaces). Defaults to no-op.
 * @returns {Promise<Array<object>>} Array of dependency rows, sorted by
 *   `workspace` then `name`. Each row has: name, workspace, requested,
 *   version, age, latest, latestBump, needsBump, size, uses, declared.
 */
export async function depreport({ dir = ".", log = () => {} } = {}) {
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

  const npmConfig = loadNpmConfig(startDir, repoRoot);

  const rootDependencies = new Set();
  const rootDependencyMap = new Map();
  for (const [name, version] of Object.entries(
    rootManifest.dependencies || {},
  )) {
    rootDependencies.add(name);
    rootDependencyMap.set(name, { version, declared: "root" });
  }
  for (const [name, version] of Object.entries(
    rootManifest.devDependencies || {},
  )) {
    rootDependencies.add(name);
    rootDependencyMap.set(name, { version, declared: "root" });
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
    for (const section of ["dependencies", "devDependencies"]) {
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

    for (const section of ["dependencies", "devDependencies"]) {
      const deps = manifest[section] || {};
      for (const [name, version] of Object.entries(deps)) {
        dependencyNames.add(name);
        declaredByWorkspace.set(name, { version, declared: "subproject" });
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
      const size = packageDir
        ? await getTransitivePackageSize(packageDir, repoRoot)
        : 0;
      const age = version
        ? await fetchPublishedAt(dependencyName, version, npmConfig)
        : "";
      const latest =
        dependencyName && !internalPackageNames.has(dependencyName)
          ? await fetchLatestVersion(dependencyName, npmConfig)
          : "";
      const latestBump =
        dependencyName && requested && !internalPackageNames.has(dependencyName)
          ? await fetchLatestCompatibleVersion(
              dependencyName,
              requested,
              npmConfig,
            )
          : "";
      const latestVersion = parseVersion(latest);
      const latestBumpVersion = parseVersion(latestBump);
      const latestEffective =
        latestBumpVersion &&
        (!latestVersion ||
          compareVersions(latestVersion, latestBumpVersion) < 0)
          ? latestBump
          : latest;
      const needsBump =
        version &&
        latestBumpVersion &&
        parseVersion(version) &&
        compareVersions(parseVersion(version), latestBumpVersion) < 0
          ? "✓"
          : "";
      const isDeclaredBySubproject =
        workspace.workspaceLabel !== "{root}" &&
        Boolean(
          (manifest.dependencies && manifest.dependencies[dependencyName]) ||
          (manifest.devDependencies &&
            manifest.devDependencies[dependencyName]),
        );
      const currentVersion = parseVersion(version);
      const latestEffectiveVersion = parseVersion(latestEffective);
      if (
        currentVersion &&
        latestEffectiveVersion &&
        compareVersions(currentVersion, latestEffectiveVersion) === 0
      ) {
        continue;
      }

      rows.push({
        name: dependencyName,
        workspace: workspaceLabel,
        requested,
        version,
        age,
        latest: latestEffective,
        latestBump,
        needsBump,
        size,
        uses,
        declared:
          workspace.workspaceLabel === "{root}"
            ? "root"
            : isDeclaredBySubproject
              ? "subproject"
              : "root",
      });
    }
  }

  rows.sort((a, b) =>
    `${a.workspace}:${a.name}`.localeCompare(`${b.workspace}:${b.name}`),
  );

  return rows;
}

export default depreport;
