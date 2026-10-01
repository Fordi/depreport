import { getTransitivePackageSize } from "./packageSize.js";
import { parseVersion, compareVersions, maxSatisfying } from "./version.js";

/**
 * A column extractor follows the contract
 *
 *   async (metadata, context) => string | number | boolean | null
 *
 * where:
 *  - `metadata` is the package's npm registry document (as produced by
 *    fetchNpmMetadata: `{ time, latest, versions }`), or null when the package
 *    could not be fetched.
 *  - `context` describes the dependency in the workspace being reported:
 *      { name, workspace, requested, version, declared, type, uses,
 *        packageDir, repoRoot, npmConfig }
 *    where `name` is the package name, `workspace` its display label,
 *    `requested` the declared range, `version` the installed (or declared)
 *    version, `declared` "root"|"subproject"|"transitive", `type` the
 *    dependency type, `uses` the import count, `packageDir` the resolved
 *    install dir (or null), `repoRoot` the project root, and `npmConfig` the
 *    resolved npm config (for columns that need to reach the registry
 *    themselves).
 *
 * @typedef {(metadata: object|null, context: object) =>
 *   (string|number|boolean|null|Promise<string|number|boolean|null>)} ColumnExtractor
 */

// The version we would advise upgrading to: the newer of the latest dist-tag
// and the newest in-range published version, so an in-range bump wins when it
// is actually ahead of the tag.
export function latestEffective(metadata, requested) {
  const latest = metadata?.latest || "";
  const bump = maxSatisfying(metadata?.versions, requested);
  const latestVersion = parseVersion(latest);
  const bumpVersion = parseVersion(bump);
  return bumpVersion &&
    (!latestVersion || compareVersions(latestVersion, bumpVersion) < 0)
    ? bump
    : latest;
}

/**
 * Built-in report columns, in default output order. Each value is a
 * {@link ColumnExtractor}. Custom columns supplied to depreport() follow the
 * same contract and are merged on top of these.
 *
 * @type {Record<string, ColumnExtractor>}
 */
export const BUILTIN_COLUMNS = {
  name: (metadata, ctx) => ctx.name,
  workspace: (metadata, ctx) => ctx.workspace,
  requested: (metadata, ctx) => ctx.requested,
  version: (metadata, ctx) => ctx.version,
  published: (metadata, ctx) => {
    const time = metadata?.time?.[ctx.version];
    return time ? new Date(time) : undefined;
  },
  latest: (metadata, ctx) => latestEffective(metadata, ctx.requested),
  latestBump: (metadata, ctx) =>
    maxSatisfying(metadata?.versions, ctx.requested),
  needsBump: (metadata, ctx) => {
    const current = parseVersion(ctx.version);
    const bump = parseVersion(maxSatisfying(metadata?.versions, ctx.requested));
    return current && bump && compareVersions(current, bump) < 0;
  },
  size: (metadata, ctx) =>
    ctx.packageDir ? getTransitivePackageSize(ctx.packageDir, ctx.repoRoot) : 0,
  uses: (metadata, ctx) => ctx.uses,
  declared: (metadata, ctx) => ctx.declared,
  type: (metadata, ctx) => ctx.type,
};

export const BUILTIN_COLUMN_NAMES = Object.keys(BUILTIN_COLUMNS);

// Columns the Markdown table shows when --columns isn't given: a narrower set
// than the CSV report, since wide tables are hard to read as plain text.
export const MARKDOWN_DEFAULT_COLUMNS = [
  "workspace",
  "type",
  "requested",
  "name",
  "version",
  "latestBump",
];
