import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TYPE_SECTIONS,
  DEP_TYPES,
  DEFAULT_TYPES,
  sectionsForTypes,
} from "./depTypes.js";

test("DEP_TYPES / TYPE_SECTIONS: cover the four manifest sections in order", () => {
  assert.deepEqual(DEP_TYPES, ["main", "dev", "peer", "optional"]);
  assert.deepEqual(
    TYPE_SECTIONS.map((e) => e.section),
    [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ],
  );
});

test("DEFAULT_TYPES: main and dev", () => {
  assert.deepEqual(DEFAULT_TYPES, ["main", "dev"]);
});

test("sectionsForTypes: returns matching entries in canonical order", () => {
  // Input order does not matter; output follows TYPE_SECTIONS order.
  assert.deepEqual(sectionsForTypes(["peer", "main"]), [
    { type: "main", section: "dependencies" },
    { type: "peer", section: "peerDependencies" },
  ]);
});

test("sectionsForTypes: ignores unrecognized types and dedupes implicitly", () => {
  assert.deepEqual(sectionsForTypes(["bogus", "dev", "dev"]), [
    { type: "dev", section: "devDependencies" },
  ]);
  assert.deepEqual(sectionsForTypes([]), []);
});
