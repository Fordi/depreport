import { test } from "node:test";
import assert from "node:assert/strict";

import { toUpdateCommand } from "./updateCommand.js";

test("toUpdateCommand: builds an install command for rows needing a bump", () => {
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
  // yarn install doesn't accept package specs at all, so root always uses add.
  assert.deepEqual(toUpdateCommand(rows, "yarn"), ["yarn add leftpad@^1.2.0"]);
  assert.deepEqual(toUpdateCommand(rows, "pnpm"), [
    "pnpm install leftpad@^1.2.0",
  ]);
  assert.deepEqual(toUpdateCommand(rows, "bun"), [
    "bun install leftpad@^1.2.0",
  ]);
});

test("toUpdateCommand: yarn root install adds -W only in a monorepo", () => {
  const rows = [
    {
      name: "leftpad",
      requested: "^1.0.0",
      needsBump: true,
      latestBump: "1.2.0",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows, "yarn"), ["yarn add leftpad@^1.2.0"]);
  assert.deepEqual(toUpdateCommand(rows, "yarn", { isMonorepo: true }), [
    "yarn add leftpad@^1.2.0 -W",
  ]);
});

test("toUpdateCommand: isMonorepo does not affect other package managers", () => {
  const rows = [
    {
      name: "leftpad",
      requested: "^1.0.0",
      needsBump: true,
      latestBump: "1.2.0",
    },
  ];
  assert.deepEqual(toUpdateCommand(rows, "npm", { isMonorepo: true }), [
    "npm install leftpad@^1.2.0",
  ]);
  assert.deepEqual(toUpdateCommand(rows, "pnpm", { isMonorepo: true }), [
    "pnpm install leftpad@^1.2.0",
  ]);
  assert.deepEqual(toUpdateCommand(rows, "bun", { isMonorepo: true }), [
    "bun install leftpad@^1.2.0",
  ]);
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
    "yarn workspace app add leftpad@^1.2.0",
  ]);
  assert.deepEqual(toUpdateCommand(rows, "pnpm"), [
    "pnpm add leftpad@^1.2.0 --filter app",
  ]);
  assert.deepEqual(toUpdateCommand(rows, "bun"), [
    "bun add leftpad@^1.2.0 --filter app",
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
