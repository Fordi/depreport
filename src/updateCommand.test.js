import { test } from "node:test";
import assert from "node:assert/strict";

import { toUpdateCommand } from "./updateCommand.js";

test("toUpdateCommand: builds an upgrade command for rows needing a bump", () => {
  const rows = [
    {
      name: "leftpad",
      requested: "^1.0.0",
      needsBump: true,
      latestBump: "1.2.0",
    },
    {
      name: "chalk",
      requested: "^4.0.0",
      needsBump: false,
      latestBump: "5.0.0",
    },
    {
      name: "lodash",
      requested: "^4.0.0",
      needsBump: null,
      latestBump: "4.17.21",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows), ["npm install leftpad@^1.2.0"]);
});

test("toUpdateCommand: preserves the ^/~ leader from the requested range", () => {
  const rows = [
    { name: "a", requested: "^1.0.0", needsBump: true, latestBump: "1.2.0" },
    { name: "b", requested: "~2.0.0", needsBump: true, latestBump: "2.0.9" },
    { name: "c", requested: "3.0.0", needsBump: true, latestBump: "3.1.0" },
  ];
  assert.deepEqual(toUpdateCommand(rows), [
    "npm install a@^1.2.0 b@~2.0.9 c@3.1.0",
  ]);
});

test("toUpdateCommand: uses the given package manager for the root command", () => {
  const rows = [
    {
      name: "leftpad",
      requested: "^1.0.0",
      needsBump: true,
      latestBump: "1.2.0",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows, "yarn"), [
    "yarn upgrade leftpad@^1.2.0",
  ]);
  assert.deepEqual(toUpdateCommand(rows, "pnpm"), [
    "pnpm update leftpad@^1.2.0",
  ]);
  assert.deepEqual(toUpdateCommand(rows, "bun"), ["bun update leftpad@^1.2.0"]);
});

test("toUpdateCommand: rows with no declared/workspace fields install at the root", () => {
  // Single-package repos (or full:false) drop the vestigial declared/workspace
  // columns entirely; every row installs at the root.
  const rows = [
    {
      name: "leftpad",
      requested: "^1.0.0",
      needsBump: true,
      latestBump: "1.2.0",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows), ["npm install leftpad@^1.2.0"]);
});

test("toUpdateCommand: a root-declared dependency installs at the root even when reported via a workspace", () => {
  const rows = [
    {
      name: "leftpad",
      requested: "^1.0.0",
      needsBump: true,
      latestBump: "1.2.0",
      declared: "root",
      workspace: "app",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows), ["npm install leftpad@^1.2.0"]);
});

test("toUpdateCommand: a subproject-declared dependency installs scoped to its workspace", () => {
  const rows = [
    {
      name: "leftpad",
      requested: "^1.0.0",
      needsBump: true,
      latestBump: "1.2.0",
      declared: "subproject",
      workspace: "app",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows), [
    "npm install leftpad@^1.2.0 --workspace=app",
  ]);
});

test("toUpdateCommand: emits one command per install location, root first then workspaces sorted", () => {
  const rows = [
    {
      name: "chalk",
      requested: "^4.0.0",
      needsBump: true,
      latestBump: "5.0.0",
      declared: "root",
      workspace: "app",
    },
    {
      name: "leftpad",
      requested: "^1.0.0",
      needsBump: true,
      latestBump: "1.2.0",
      declared: "subproject",
      workspace: "web",
    },
    {
      name: "lodash",
      requested: "^4.0.0",
      needsBump: true,
      latestBump: "4.17.21",
      declared: "subproject",
      workspace: "api",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows), [
    "npm install chalk@^5.0.0",
    "npm install lodash@^4.17.21 --workspace=api",
    "npm install leftpad@^1.2.0 --workspace=web",
  ]);
});

test("toUpdateCommand: builds the workspace-scoped command per package manager", () => {
  const rows = [
    {
      name: "leftpad",
      requested: "^1.0.0",
      needsBump: true,
      latestBump: "1.2.0",
      declared: "subproject",
      workspace: "app",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows, "yarn"), [
    "yarn workspace app upgrade leftpad@^1.2.0",
  ]);
  assert.deepEqual(toUpdateCommand(rows, "pnpm"), [
    "pnpm update leftpad@^1.2.0 --filter app",
  ]);
  assert.deepEqual(toUpdateCommand(rows, "bun"), [
    "bun update leftpad@^1.2.0 --filter app",
  ]);
});

test("toUpdateCommand: dedupes a dependency shared across workspace-attribution rows", () => {
  const rows = [
    {
      name: "leftpad",
      requested: "^1.0.0",
      needsBump: true,
      latestBump: "1.2.0",
      declared: "root",
      workspace: "app",
    },
    {
      name: "leftpad",
      requested: "^1.0.0",
      needsBump: true,
      latestBump: "1.2.0",
      declared: "root",
      workspace: "lib",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows), ["npm install leftpad@^1.2.0"]);
});

test("toUpdateCommand: hard mode includes an out-of-range dependency that needsBump ignores", () => {
  // Pinned to ^1.x, already at the highest in-range version, but 2.x is out.
  const rows = [
    {
      name: "leftpad",
      requested: "^1.0.0",
      version: "1.9.9",
      needsBump: false,
      latestBump: "1.9.9",
      latest: "2.0.0",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows), []);
  assert.deepEqual(toUpdateCommand(rows, "npm", { hard: true }), [
    "npm install leftpad@^2.0.0",
  ]);
});

test("toUpdateCommand: hard mode also includes an indeterminate (null) needsBump row", () => {
  const rows = [
    {
      name: "leftpad",
      requested: "^1.0.0",
      version: "not-semver",
      needsBump: null,
      latest: "2.0.0",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows, "npm", { hard: true }), []);
});

test("toUpdateCommand: hard mode excludes a row already at latest", () => {
  const rows = [
    {
      name: "leftpad",
      requested: "^1.0.0",
      version: "1.9.9",
      needsBump: false,
      latest: "1.9.9",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows, "npm", { hard: true }), []);
});

test("toUpdateCommand: hard mode emits one command per dependency, not batched", () => {
  const rows = [
    {
      name: "a",
      requested: "^1.0.0",
      version: "1.0.0",
      needsBump: true,
      latestBump: "1.5.0",
      latest: "1.5.0",
    },
    {
      name: "b",
      requested: "^1.0.0",
      version: "1.0.0",
      needsBump: false,
      latestBump: "1.0.0",
      latest: "3.0.0",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows, "npm", { hard: true }), [
    "npm install a@^1.5.0",
    "npm install b@^3.0.0",
  ]);
});

test("toUpdateCommand: hard mode still routes each line to the right workspace", () => {
  const rows = [
    {
      name: "a",
      requested: "^1.0.0",
      version: "1.0.0",
      needsBump: false,
      latest: "2.0.0",
      declared: "subproject",
      workspace: "app",
    },
    {
      name: "b",
      requested: "^1.0.0",
      version: "1.0.0",
      needsBump: false,
      latest: "2.0.0",
      declared: "root",
      workspace: "app",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows, "npm", { hard: true }), [
    "npm install b@^2.0.0",
    "npm install a@^2.0.0 --workspace=app",
  ]);
});

test("toUpdateCommand: returns an empty array when nothing needs a bump", () => {
  const rows = [
    {
      name: "leftpad",
      requested: "^1.0.0",
      needsBump: false,
      latestBump: "1.2.0",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows), []);
  assert.deepEqual(toUpdateCommand([]), []);
});

test("toUpdateCommand: batches every dependency type for a location into one command", () => {
  const rows = [
    {
      name: "chalk",
      requested: "^5.0.0",
      needsBump: true,
      latestBump: "5.4.1",
      type: "main",
    },
    {
      name: "eslint",
      requested: "^9.0.0",
      needsBump: true,
      latestBump: "9.1.0",
      type: "dev",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows), [
    "npm install chalk@^5.4.1 eslint@^9.1.0",
  ]);
  assert.deepEqual(toUpdateCommand(rows, "yarn"), [
    "yarn upgrade chalk@^5.4.1 eslint@^9.1.0",
  ]);
});

test("toUpdateCommand: a transitive dependency is refreshed by name at the root", () => {
  const rows = [
    {
      name: "glob-parent",
      requested: "^6.0.2",
      needsBump: true,
      latestBump: "6.0.3",
      declared: "transitive",
      workspace: "app",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows), ["npm update glob-parent"]);
  assert.deepEqual(toUpdateCommand(rows, "yarn"), ["yarn upgrade glob-parent"]);
  assert.deepEqual(toUpdateCommand(rows, "pnpm"), [
    "pnpm update --depth Infinity glob-parent",
  ]);
  assert.deepEqual(toUpdateCommand(rows, "bun"), ["bun update glob-parent"]);
});

test("toUpdateCommand: transitive dependencies are deduped, sorted and batched", () => {
  const rows = ["minimatch", "glob-parent", "glob-parent"].map((name, i) => ({
    name,
    requested: "^1.0.0",
    needsBump: true,
    latestBump: "1.1.0",
    declared: "transitive",
    workspace: i === 2 ? "web" : "app",
  }));
  assert.deepEqual(toUpdateCommand(rows), ["npm update glob-parent minimatch"]);
});

test("toUpdateCommand: hard mode skips transitive dependencies", () => {
  const rows = [
    {
      name: "glob-parent",
      requested: "^6.0.2",
      version: "6.0.2",
      latest: "7.0.0",
      declared: "transitive",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows, "npm", { hard: true }), []);
});
