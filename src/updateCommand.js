import { parseVersion, compareVersions } from "./version.js";

// How to upgrade specific packages to specific versions, per package
// manager, optionally scoped to one workspace (null = repo root). Upgrading
// an existing dependency keeps it in its current manifest section, so no
// per-type flags are needed. npm has no `upgrade` verb that can move a range,
// so `install pkg@range` is its equivalent.
const UPGRADE = {
  npm: (targets, workspace) =>
    `npm install ${targets.join(" ")}${workspace === null ? "" : ` --workspace=${workspace}`}`,
  yarn: (targets, workspace) =>
    `yarn ${workspace === null ? "" : `workspace ${workspace} `}upgrade ${targets.join(" ")}`,
  pnpm: (targets, workspace) =>
    `pnpm update ${targets.join(" ")}${workspace === null ? "" : ` --filter ${workspace}`}`,
  bun: (targets, workspace) =>
    `bun update ${targets.join(" ")}${workspace === null ? "" : ` --filter ${workspace}`}`,
};

function upgradeCommand(packageManager, location, targets) {
  return (UPGRADE[packageManager] || UPGRADE.npm)(targets, location);
}

// Preserve the range operator from the declared range, so updates keep the
// same policy the manifest already used (e.g. ^, ~, >=) instead of forcing an
// exact pin.
function rangeLeader(requested) {
  return /^(?:\^|~|>=|<=|>|<|=)/.exec(requested || "")?.[0] ?? "";
}

function targetSpec(row, version) {
  return `${row.name}@${rangeLeader(row.requested)}${version}`;
}

// Which version a row should be updated to, or null if it isn't eligible.
// Soft (default): the highest in-range version, only when behind it.
// Hard: the overall latest version, whenever installed doesn't match it,
// including bumps that fall outside the declared range.
function eligibleTarget(row, hard) {
  if (!hard) {
    return row.needsBump === true ? row.latestBump : null;
  }
  const current = parseVersion(row.version);
  const latest = parseVersion(row.latest);
  if (!current || !latest || compareVersions(current, latest) === 0) {
    return null;
  }
  return row.latest;
}

// Where a row's dependency should be installed: null for the repo root, or a
// workspace name. Rows without a declared/workspace distinction (a
// single-package repo, or full:false dropping those vestigial columns)
// always install at the root; declared: "root" always installs at the root
// too, even when the row was produced while walking a workspace that merely
// uses it (see index.js's root-dependency usage tracking).
function installLocation(row) {
  if (!("declared" in row) || row.declared !== "subproject") {
    return null;
  }
  return row.workspace ?? null;
}

// Transitive dependencies can't be pinned without adding a direct dependency
// or an override, so they are refreshed by name within the ranges their
// parents already allow. Only the repo-wide lockfile is touched.
const TRANSITIVE_UPDATE = {
  npm: (names) => `npm update ${names.join(" ")}`,
  yarn: (names) => `yarn upgrade ${names.join(" ")}`,
  pnpm: (names) => `pnpm update --depth Infinity ${names.join(" ")}`,
  bun: (names) => `bun update ${names.join(" ")}`,
};

/**
 * Build the shell command(s) that would upgrade every dependency depreport
 * flagged as outdated, using each package manager's upgrade verb (`yarn
 * upgrade`, `pnpm update`, `bun update`; npm's equivalent is `npm install`).
 *
 * In a monorepo, dependencies declared by a workspace's own manifest are
 * upgraded scoped to that workspace; dependencies declared at the root
 * (even if only reported because a workspace uses them) are upgraded once
 * at the root. Upgrading keeps a dependency in its existing manifest
 * section, so there is one command per location regardless of type.
 * Transitive dependencies are refreshed by name in a single root command
 * (`npm update ...`), which keeps them within their parents' ranges and adds
 * nothing to any manifest.
 *
 * @param {Array<object>} rows Report rows (as returned by depreport()).
 * @param {"npm" | "yarn" | "pnpm" | "bun"} [packageManager="npm"]
 * @param {object} [options]
 * @param {boolean} [options.hard=false] Soft (default): only rows with
 *   `needsBump === true`, pinned to `latestBump`, batched into one command
 *   per location. Hard: any row whose installed version doesn't
 *   match `latest` (including out-of-range/breaking upgrades), pinned to
 *   `latest`, one command per dependency rather than batched.
 *   Transitive rows are skipped in hard mode: they can only be refreshed
 *   within their parents' ranges, never pinned to latest.
 * @returns {string[]} One command per location (soft) or per dependency
 *   (hard); root before workspaces, workspaces sorted. Empty when nothing is
 *   eligible.
 */
export function toUpdateCommand(
  rows,
  packageManager = "npm",
  { hard = false } = {},
) {
  const transitiveNames = new Set();
  const groups = new Map();
  for (const row of rows) {
    const target = eligibleTarget(row, hard);
    if (!target) {
      continue;
    }
    if (row.declared === "transitive") {
      transitiveNames.add(row.name);
      continue;
    }
    const location = installLocation(row);
    if (!groups.has(location)) {
      groups.set(location, new Set());
    }
    groups.get(location).add(targetSpec(row, target));
  }

  const commands = [];
  const locations = [
    null,
    ...[...groups.keys()].filter((key) => key !== null).sort(),
  ];
  for (const location of locations) {
    const specs = groups.get(location);
    if (!specs) {
      continue;
    }
    const targets = [...specs];
    if (hard) {
      for (const target of targets.sort()) {
        commands.push(upgradeCommand(packageManager, location, [target]));
      }
    } else {
      commands.push(upgradeCommand(packageManager, location, targets));
    }
  }
  const transitiveCommands =
    transitiveNames.size > 0 && !hard
      ? [
          (TRANSITIVE_UPDATE[packageManager] || TRANSITIVE_UPDATE.npm)(
            [...transitiveNames].sort(),
          ),
        ]
      : [];
  return transitiveCommands.concat(commands);
}
