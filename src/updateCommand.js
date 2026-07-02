import { parseVersion, compareVersions } from "./version.js";
import { DEP_TYPES } from "./depTypes.js";

// The flag that pins a dependency to its manifest section, per package
// manager and type. Empty string means "no flag needed" (main dependencies
// are every tool's default).
const TYPE_FLAGS = {
  npm: {
    main: "",
    dev: "--save-dev",
    peer: "--save-peer",
    optional: "--save-optional",
  },
  yarn: { main: "", dev: "--dev", peer: "--peer", optional: "--optional" },
  pnpm: {
    main: "",
    dev: "--save-dev",
    peer: "--save-peer",
    optional: "--save-optional",
  },
  bun: { main: "", dev: "--dev", peer: "--peer", optional: "--optional" },
};

function typeFlag(packageManager, type) {
  return TYPE_FLAGS[packageManager]?.[type] || "";
}

// How to install at the repo root, per package manager.
function rootCommand(packageManager, targets, isMonorepo, flag) {
  const suffix = flag ? ` ${flag}` : "";
  if (packageManager === "yarn") {
    return `${packageManager} add ${targets.join(" ")}${isMonorepo ? " -W" : ""}${suffix}`;
  }
  return `${packageManager} install ${targets.join(" ")}${suffix}`;
}

// How to add a specific package + version scoped to one workspace, per
// package manager.
const WORKSPACE_INSTALL = {
  npm: (pm, targets, workspace, flag) =>
    `${pm} install ${targets.join(" ")} --workspace=${workspace}${flag ? ` ${flag}` : ""}`,
  yarn: (pm, targets, workspace, flag) =>
    `${pm} workspace ${workspace} add ${targets.join(" ")}${flag ? ` ${flag}` : ""}`,
  pnpm: (pm, targets, workspace, flag) =>
    `${pm} add ${targets.join(" ")} --filter ${workspace}${flag ? ` ${flag}` : ""}`,
  bun: (pm, targets, workspace, flag) =>
    `${pm} add ${targets.join(" ")} --filter ${workspace}${flag ? ` ${flag}` : ""}`,
};

function installCommand(packageManager, location, targets, isMonorepo, flag) {
  if (location === null) {
    return rootCommand(packageManager, targets, isMonorepo, flag);
  }
  const build = WORKSPACE_INSTALL[packageManager] || WORKSPACE_INSTALL.npm;
  return build(packageManager, targets, location, flag);
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
 * at the root. Dependencies are also grouped by `type` (main/dev/peer/
 * optional) and tagged with the package manager's equivalent flag (e.g.
 * `--save-dev`), so re-installing doesn't move a dependency into the wrong
 * manifest section; a location with more than one type in play emits one
 * command per type.
 *
 * @param {Array<object>} rows Report rows (as returned by depreport()).
 * @param {"npm" | "yarn" | "pnpm" | "bun"} [packageManager="npm"]
 * @param {object} [options]
 * @param {boolean} [options.isMonorepo=false] Whether the repo declares
 *   workspaces; needed for yarn, which requires -W to touch the root
 *   manifest from inside a workspace-enabled repo.
 * @param {boolean} [options.hard=false] Soft (default): only rows with
 *   `needsBump === true`, pinned to `latestBump`, batched into one command
 *   per install location/type. Hard: any row whose installed version doesn't
 *   match `latest` (including out-of-range/breaking upgrades), pinned to
 *   `latest`, one command per dependency rather than batched.
 * @returns {string[]} One command per location/type (soft) or per
 *   dependency (hard); root before workspaces, workspaces sorted, and types
 *   within a location in canonical order (main, dev, peer, optional). Empty
 *   when nothing is eligible.
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
    const type = DEP_TYPES.includes(row.type) ? row.type : "main";
    if (!groups.has(location)) {
      groups.set(location, new Map());
    }
    const byType = groups.get(location);
    if (!byType.has(type)) {
      byType.set(type, new Set());
    }
    byType.get(type).add(targetSpec(row, target));
  }

  const commands = [];
  const locations = [
    null,
    ...[...groups.keys()].filter((key) => key !== null).sort(),
  ];
  for (const location of locations) {
    const byType = groups.get(location);
    if (!byType) {
      continue;
    }
    for (const type of DEP_TYPES) {
      const specs = byType.get(type);
      if (!specs) {
        continue;
      }
      const flag = typeFlag(packageManager, type);
      const targets = [...specs];
      if (hard) {
        for (const target of targets.sort()) {
          commands.push(
            installCommand(
              packageManager,
              location,
              [target],
              isMonorepo,
              flag,
            ),
          );
        }
      } else {
        commands.push(
          installCommand(packageManager, location, targets, isMonorepo, flag),
        );
      }
    }
  }
  return commands;
}
