import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { detectPackageManager } from "./packageManager.js";

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "depreport-pm-"));
}

test("detectPackageManager: defaults to npm when no lockfile is present", () => {
  assert.equal(detectPackageManager(makeTmp()), "npm");
});

test("detectPackageManager: recognizes package-lock.json as npm", () => {
  const dir = makeTmp();
  fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");
  assert.equal(detectPackageManager(dir), "npm");
});

test("detectPackageManager: recognizes yarn.lock as yarn", () => {
  const dir = makeTmp();
  fs.writeFileSync(path.join(dir, "yarn.lock"), "");
  assert.equal(detectPackageManager(dir), "yarn");
});

test("detectPackageManager: recognizes pnpm-lock.yaml as pnpm", () => {
  const dir = makeTmp();
  fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
  assert.equal(detectPackageManager(dir), "pnpm");
});

test("detectPackageManager: recognizes bun.lockb and bun.lock as bun", () => {
  const dir = makeTmp();
  fs.writeFileSync(path.join(dir, "bun.lockb"), "");
  assert.equal(detectPackageManager(dir), "bun");

  const dir2 = makeTmp();
  fs.writeFileSync(path.join(dir2, "bun.lock"), "");
  assert.equal(detectPackageManager(dir2), "bun");
});

test("detectPackageManager: prefers a more specific lockfile when several are present", () => {
  const dir = makeTmp();
  fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");
  fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
  // pnpm-lock.yaml is checked before package-lock.json.
  assert.equal(detectPackageManager(dir), "pnpm");
});
