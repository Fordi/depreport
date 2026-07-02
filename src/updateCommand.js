import { parseVersion, compareVersions } from "./version.js";

// How to install at the repo root, per package manager. Yarn (classic)
// doesn't accept package specs on `install` at all, and additionally
// refuses to touch the root manifest from inside a workspace-enabled repo
// unless told to via -W (--ignore-workspace-root-check).
function rootCommand(packageManager, targets, isMonorepo) {
  if (packageManager === "yarn") {
    return `yarn add ${targets.join(" ")}${isMonorepo ? " -W" : ""}`;
  }
  return `${packageManager} install ${targets.join(" ")}`;
}

// How to add a specific package + version scoped to one workspace, per
// package manager.
const WORKSPACE_INSTALL = {
  npm: (pm, targets, workspace) =>
    `${pm} install ${targets.join(" ")} --workspace=${workspace}`,
  yarn: (pm, targets, workspace) =>
    `${pm} workspace ${workspace} add ${targets.join(" ")}`,
  pnpm: (pm, targets, workspace) =>
    `${pm} add ${targets.join(" ")} --filter ${workspace}`,
  bun: (pm, targets, workspace) =>
    `${pm} add ${targets.join(" ")} --filter ${workspace}`,
};

function installCommand(packageManager, location, targets, isMonorepo) {
  if (location === null) {
    return rootCommand(packageManager, targets, isMonorepo);
  }
  const build = WORKSPACE_INSTALL[packageManager] || WORKSPACE_INSTALL.npm;
  return build(packageManager, targets, location);
}

// Preserve the `^`/`~` leader from the declared range, so the install pins
// to the same kind of range the manifest already used, not an exact version.
function targetSpec(row, version) {
  const leader = /^[\^~]/.exec(row.requested || "")?.[0] ?? "";
  return `${row.name}@${leader}${version}`;
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

/**
 * Build the shell command(s) that would install every dependency depreport
 * flagged as outdated.
 *
 * In a monorepo, dependencies declared by a workspace's own manifest are
 * installed scoped to that workspace; dependencies declared at the root
 * (even if only reported because a workspace uses them) are installed once
 * at the root.
 *
 * @param {Array<object>} rows Report rows (as returned by depreport()).
 * @param {"npm" | "yarn" | "pnpm" | "bun"} [packageManager="npm"]
 * @param {object} [options]
 * @param {boolean} [options.isMonorepo=false] Whether the repo declares
 *   workspaces; needed for yarn, which requires -W to touch the root
 *   manifest from inside a workspace-enabled repo.
 * @param {boolean} [options.hard=false] Soft (default): only rows with
 *   `needsBump === true`, pinned to `latestBump`, batched into one command
 *   per install location. Hard: any row whose installed version doesn't
 *   match `latest` (including out-of-range/breaking upgrades), pinned to
 *   `latest`, one command per dependency rather than batched.
 * @returns {string[]} One command per location (soft) or per dependency
 *   (hard), root first, then workspaces in sorted order. Empty when nothing
 *   is eligible.
 */
export function toUpdateCommand(
  rows,
  packageManager = "npm",
  { isMonorepo = false, hard = false } = {},
) {
  const groups = new Map();
  for (const row of rows) {
    const target = eligibleTarget(row, hard);
    if (!target) {
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
    ...[...groups.keys()].filter((k) => k !== null).sort(),
  ];
  for (const location of locations) {
    if (!groups.has(location)) {
      continue;
    }
    const targets = [...groups.get(location)];
    if (hard) {
      for (const target of targets.sort()) {
        commands.push(
          installCommand(packageManager, location, [target], isMonorepo),
        );
      }
    } else {
      commands.push(
        installCommand(packageManager, location, targets, isMonorepo),
      );
    }
  }
  return commands;
}
