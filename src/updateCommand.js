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

// Preserve the `^`/`~` leader from the declared range, so the install pins
// to the same kind of range the manifest already used, not an exact version.
function targetSpec(row) {
  const leader = /^[\^~]/.exec(row.requested || "")?.[0] ?? "";
  return `${row.name}@${leader}${row.latestBump}`;
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
 * flagged as needing an in-range bump, pinned to the range it recommends.
 *
 * In a monorepo, dependencies declared by a workspace's own manifest are
 * installed scoped to that workspace; dependencies declared at the root
 * (even if only reported because a workspace uses them) are installed once
 * at the root. Each install location produces its own command.
 *
 * @param {Array<object>} rows Report rows (as returned by depreport()).
 * @param {"npm" | "yarn" | "pnpm" | "bun"} [packageManager="npm"]
 * @param {object} [options]
 * @param {boolean} [options.isMonorepo=false] Whether the repo declares
 *   workspaces; needed for yarn, which requires -W to touch the root
 *   manifest from inside a workspace-enabled repo.
 * @returns {string[]} One install command per location, root first, then
 *   workspaces in sorted order. Empty when no row has `needsBump === true`.
 */
export function toUpdateCommand(
  rows,
  packageManager = "npm",
  { isMonorepo = false } = {},
) {
  const groups = new Map();
  for (const row of rows) {
    if (row.needsBump !== true) {
      continue;
    }
    const location = installLocation(row);
    if (!groups.has(location)) {
      groups.set(location, new Set());
    }
    groups.get(location).add(targetSpec(row));
  }

  const commands = [];
  if (groups.has(null)) {
    commands.push(
      rootCommand(packageManager, [...groups.get(null)], isMonorepo),
    );
  }
  const workspaces = [...groups.keys()].filter((key) => key !== null).sort();
  const buildWorkspaceCommand =
    WORKSPACE_INSTALL[packageManager] || WORKSPACE_INSTALL.npm;
  for (const workspace of workspaces) {
    commands.push(
      buildWorkspaceCommand(
        packageManager,
        [...groups.get(workspace)],
        workspace,
      ),
    );
  }
  return commands;
}
