import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BUILTIN_COLUMNS,
  BUILTIN_COLUMN_NAMES,
  latestEffective,
} from "./columns.js";

// A representative registry document and dependency context.
const metadata = {
  latest: "1.4.0",
  time: { "1.0.5": "2020-01-02T00:00:00Z", "1.4.0": "2021-06-01T00:00:00Z" },
  versions: ["1.0.5", "1.2.0", "1.4.0", "1.5.0-beta", "2.0.0"],
};
const context = {
  name: "leftpad",
  workspace: "@mono/app",
  requested: "^1.0.0",
  version: "1.0.5",
  declared: "subproject",
  type: "main",
  uses: 3,
  packageDir: null,
  repoRoot: "/repo",
  npmConfig: {},
};

test("BUILTIN_COLUMN_NAMES: the report columns in order", () => {
  assert.deepEqual(BUILTIN_COLUMN_NAMES, [
    "name",
    "workspace",
    "requested",
    "version",
    "published",
    "latest",
    "latestBump",
    "needsBump",
    "size",
    "uses",
    "declared",
    "type",
  ]);
});

test("context columns: read straight from context", () => {
  assert.equal(BUILTIN_COLUMNS.name(metadata, context), "leftpad");
  assert.equal(BUILTIN_COLUMNS.workspace(metadata, context), "@mono/app");
  assert.equal(BUILTIN_COLUMNS.requested(metadata, context), "^1.0.0");
  assert.equal(BUILTIN_COLUMNS.version(metadata, context), "1.0.5");
  assert.equal(BUILTIN_COLUMNS.uses(metadata, context), 3);
  assert.equal(BUILTIN_COLUMNS.declared(metadata, context), "subproject");
  assert.equal(BUILTIN_COLUMNS.type(metadata, context), "main");
});

test("published: the registry publish time of the installed version, as a Date", () => {
  const published = BUILTIN_COLUMNS.published(metadata, context);
  assert.ok(published instanceof Date);
  assert.equal(published.toISOString(), "2020-01-02T00:00:00.000Z");
  // Unknown version or missing metadata -> undefined.
  assert.equal(
    BUILTIN_COLUMNS.published(metadata, { ...context, version: "9.9.9" }),
    undefined,
  );
  assert.equal(BUILTIN_COLUMNS.published(null, context), undefined);
});

test("latest / latestBump: newest tag vs newest in-range (prereleases excluded)", () => {
  // In-range max for ^1.0.0 is 1.4.0 (2.0.0 out of range, 1.5.0-beta unstable).
  assert.equal(BUILTIN_COLUMNS.latestBump(metadata, context), "1.4.0");
  // latest tag is also 1.4.0, so the effective latest is 1.4.0.
  assert.equal(BUILTIN_COLUMNS.latest(metadata, context), "1.4.0");
});

test("latest: prefers an in-range bump that is ahead of the dist-tag", () => {
  // Tag lags behind a newer in-range release.
  const laggingTag = { ...metadata, latest: "1.2.0" };
  assert.equal(BUILTIN_COLUMNS.latest(laggingTag, context), "1.4.0");
  assert.equal(latestEffective(laggingTag, "^1.0.0"), "1.4.0");
});

test("needsBump: true when the installed version is behind the in-range max", () => {
  assert.equal(BUILTIN_COLUMNS.needsBump(metadata, context), true);
  // Already at the in-range max -> no bump needed.
  assert.equal(
    BUILTIN_COLUMNS.needsBump(metadata, { ...context, version: "1.4.0" }),
    false,
  );
});

test("needsBump: null when the comparison is indeterminate", () => {
  // No registry metadata: there is no in-range max to compare against.
  assert.equal(BUILTIN_COLUMNS.needsBump(null, context), null);
  // Unparseable installed version: the current side cannot be compared.
  assert.equal(
    BUILTIN_COLUMNS.needsBump(metadata, { ...context, version: "not-semver" }),
    null,
  );
});

test("size: 0 without an install dir", async () => {
  assert.equal(await BUILTIN_COLUMNS.size(metadata, context), 0);
});

test("latestEffective: handles null metadata", () => {
  assert.equal(latestEffective(null, "^1.0.0"), "");
});
