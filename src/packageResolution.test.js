import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveInstalledPackageDir } from "./packageResolution.js";

const tmpDirs = [];
function makeTmp() {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "depreport-")),
  );
  tmpDirs.push(dir);
  return dir;
}

// Create node_modules/<name>/package.json under `base` and return its dir.
function installPackage(base, name, manifest = {}) {
  const dir = path.join(base, "node_modules", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", ...manifest }),
  );
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
});

test("resolveInstalledPackageDir: finds a package in the fromDir's node_modules", () => {
  const repoRoot = makeTmp();
  fs.writeFileSync(path.join(repoRoot, "package.json"), "{}");
  const fromDir = path.join(repoRoot, "pkg");
  fs.mkdirSync(fromDir);
  fs.writeFileSync(path.join(fromDir, "package.json"), "{}");
  const depDir = installPackage(fromDir, "dep");

  assert.equal(resolveInstalledPackageDir("dep", [fromDir], repoRoot), depDir);
});

test("resolveInstalledPackageDir: falls back to the repo root's node_modules", () => {
  const repoRoot = makeTmp();
  fs.writeFileSync(path.join(repoRoot, "package.json"), "{}");
  const fromDir = path.join(repoRoot, "pkg");
  fs.mkdirSync(fromDir);
  fs.writeFileSync(path.join(fromDir, "package.json"), "{}");
  const hoistedDir = installPackage(repoRoot, "hoisted");

  assert.equal(
    resolveInstalledPackageDir("hoisted", [fromDir], repoRoot),
    hoistedDir,
  );
});

test("resolveInstalledPackageDir: returns null when nothing resolves", () => {
  const repoRoot = makeTmp();
  fs.writeFileSync(path.join(repoRoot, "package.json"), "{}");
  assert.equal(
    resolveInstalledPackageDir("does-not-exist", [repoRoot], repoRoot),
    null,
  );
});

test("resolveInstalledPackageDir: skips fromDirs that have no package.json", () => {
  const repoRoot = makeTmp();
  fs.writeFileSync(path.join(repoRoot, "package.json"), "{}");
  const bogusDir = path.join(repoRoot, "no-manifest-here");
  const depDir = installPackage(repoRoot, "dep");

  // bogusDir has no package.json, so it is skipped; repoRoot resolves it.
  assert.equal(
    resolveInstalledPackageDir("dep", [bogusDir, repoRoot], repoRoot),
    depDir,
  );
});

test("resolveInstalledPackageDir: caches results by name, root, and fromDirs", () => {
  const repoRoot = makeTmp();
  fs.writeFileSync(path.join(repoRoot, "package.json"), "{}");
  const depDir = installPackage(repoRoot, "dep");

  assert.equal(resolveInstalledPackageDir("dep", [repoRoot], repoRoot), depDir);
  // Remove the package; a cached lookup must still return the original dir.
  fs.rmSync(path.join(repoRoot, "node_modules"), {
    recursive: true,
    force: true,
  });
  assert.equal(resolveInstalledPackageDir("dep", [repoRoot], repoRoot), depDir);
});
