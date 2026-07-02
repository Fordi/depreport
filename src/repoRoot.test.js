import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findRepoRoot } from "./repoRoot.js";

const tmpDirs = [];
function makeTmp() {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "depreport-")),
  );
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
});

test("findRepoRoot: returns startDir when it holds a package.json", () => {
  const root = makeTmp();
  fs.writeFileSync(path.join(root, "package.json"), "{}");
  assert.equal(findRepoRoot(root), root);
});

test("findRepoRoot: ascends until it finds the nearest package.json", () => {
  const root = makeTmp();
  fs.writeFileSync(path.join(root, "package.json"), "{}");
  const nested = path.join(root, "a", "b", "c");
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(findRepoRoot(nested), root);
});

test("findRepoRoot: stops at the closest ancestor, not the outermost", () => {
  const root = makeTmp();
  fs.writeFileSync(path.join(root, "package.json"), "{}");
  const inner = path.join(root, "inner");
  fs.mkdirSync(inner);
  fs.writeFileSync(path.join(inner, "package.json"), "{}");
  const nested = path.join(inner, "deep");
  fs.mkdirSync(nested);
  assert.equal(findRepoRoot(nested), inner);
});

test("findRepoRoot: throws when no package.json exists up to the filesystem root", () => {
  const root = makeTmp();
  const nested = path.join(root, "x", "y");
  fs.mkdirSync(nested, { recursive: true });
  assert.throws(() => findRepoRoot(nested), /Not inside a project/);
});
