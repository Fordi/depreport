import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getTransitivePackageSize } from "./packageSize.js";

const tmpDirs = [];
function makeTmp() {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "depreport-")),
  );
  tmpDirs.push(dir);
  return dir;
}

// Sum the size of every file under `dir`, mirroring getDirectorySize.
function actualSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += actualSize(full);
    } else if (entry.isFile()) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

// Install <name> under base/node_modules with a manifest and a payload file.
function installPackage(base, name, { deps = {}, payload = "x" } = {}) {
  const dir = path.join(base, "node_modules", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", dependencies: deps }),
  );
  fs.writeFileSync(path.join(dir, "index.js"), payload);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
});

test("getTransitivePackageSize: sums the package plus its resolved dependencies", async () => {
  const repoRoot = makeTmp();
  fs.writeFileSync(path.join(repoRoot, "package.json"), "{}");
  const depDir = installPackage(repoRoot, "dep", { payload: "dep-bytes" });
  const pkgDir = installPackage(repoRoot, "pkg", {
    deps: { dep: "^1.0.0" },
    payload: "pkg-bytes",
  });

  const total = await getTransitivePackageSize(pkgDir, repoRoot);
  assert.equal(total, actualSize(pkgDir) + actualSize(depDir));
});

test("getTransitivePackageSize: counts each package once across a dependency cycle", async () => {
  const repoRoot = makeTmp();
  fs.writeFileSync(path.join(repoRoot, "package.json"), "{}");
  const depDir = installPackage(repoRoot, "dep", { deps: { dep2: "^1.0.0" } });
  const dep2Dir = installPackage(repoRoot, "dep2", { deps: { dep: "^1.0.0" } });
  const pkgDir = installPackage(repoRoot, "pkg", { deps: { dep: "^1.0.0" } });

  const total = await getTransitivePackageSize(pkgDir, repoRoot);
  assert.equal(
    total,
    actualSize(pkgDir) + actualSize(depDir) + actualSize(dep2Dir),
  );
});

test("getTransitivePackageSize: skips dependencies that do not resolve", async () => {
  const repoRoot = makeTmp();
  fs.writeFileSync(path.join(repoRoot, "package.json"), "{}");
  const pkgDir = installPackage(repoRoot, "pkg", {
    deps: { missing: "^1.0.0" },
  });

  const total = await getTransitivePackageSize(pkgDir, repoRoot);
  assert.equal(total, actualSize(pkgDir));
});

test("getTransitivePackageSize: a directory without a manifest is just its file size", async () => {
  const repoRoot = makeTmp();
  const bare = path.join(repoRoot, "bare");
  fs.mkdirSync(bare);
  fs.writeFileSync(path.join(bare, "a.txt"), "hello");
  fs.writeFileSync(path.join(bare, "b.txt"), "world!!");

  const total = await getTransitivePackageSize(bare, repoRoot);
  assert.equal(total, actualSize(bare));
});

test("getTransitivePackageSize: caches the closure size by real path", async () => {
  const repoRoot = makeTmp();
  fs.writeFileSync(path.join(repoRoot, "package.json"), "{}");
  const pkgDir = installPackage(repoRoot, "pkg", { payload: "seed" });

  const first = await getTransitivePackageSize(pkgDir, repoRoot);
  // Grow the package after the first measurement; the cache must hold.
  fs.writeFileSync(path.join(pkgDir, "extra.js"), "a lot more bytes here");
  const second = await getTransitivePackageSize(pkgDir, repoRoot);
  assert.equal(second, first);
});
