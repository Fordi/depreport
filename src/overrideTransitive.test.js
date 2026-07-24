import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseOverrideSpec,
  overrideFieldFor,
  applyTransitiveOverrides,
} from "./overrideTransitive.js";

test("parseOverrideSpec: parses unscoped and scoped specs", () => {
  assert.deepEqual(parseOverrideSpec("left-pad@1.3.0"), {
    name: "left-pad",
    range: "1.3.0",
  });
  assert.deepEqual(parseOverrideSpec("@scope/pkg@^2.0.0"), {
    name: "@scope/pkg",
    range: "^2.0.0",
  });
});

test("parseOverrideSpec: rejects invalid shapes", () => {
  assert.throws(() => parseOverrideSpec("left-pad"), /Invalid override spec/);
  assert.throws(() => parseOverrideSpec("left-pad@"), /Invalid override spec/);
  assert.throws(() => parseOverrideSpec(" @x@1.0.0"), /Invalid override spec/);
});

test("overrideFieldFor: yarn uses resolutions, others use overrides", () => {
  assert.equal(overrideFieldFor("yarn"), "resolutions");
  assert.equal(overrideFieldFor("npm"), "overrides");
  assert.equal(overrideFieldFor("pnpm"), "overrides");
  assert.equal(overrideFieldFor("bun"), "overrides");
});

test("applyTransitiveOverrides: writes overrides and merges existing keys", () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "depreport-override-")),
  );
  try {
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "proj",
        overrides: { existing: "1.0.0" },
      }),
    );

    const result = applyTransitiveOverrides({
      dir: root,
      packageManager: "npm",
      specs: ["left-pad@1.3.0", "@scope/pkg@^2.0.0"],
    });

    assert.equal(result.field, "overrides");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    assert.deepEqual(manifest.overrides, {
      "@scope/pkg": "^2.0.0",
      existing: "1.0.0",
      "left-pad": "1.3.0",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("applyTransitiveOverrides: writes resolutions for yarn", () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "depreport-resolution-")),
  );
  try {
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "proj" }));
    fs.writeFileSync(path.join(root, "yarn.lock"), "# lock\n");

    const result = applyTransitiveOverrides({
      dir: root,
      specs: ["left-pad@1.3.0"],
    });

    assert.equal(result.field, "resolutions");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    assert.deepEqual(manifest.resolutions, { "left-pad": "1.3.0" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
