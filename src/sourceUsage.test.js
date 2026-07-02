import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { countUses } from "./sourceUsage.js";

const tmpDirs = [];
function makeTmp() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "depreport-")));
  tmpDirs.push(dir);
  return dir;
}

function write(dir, rel, contents) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
});

test("countUses: tallies import, side-effect, require, dynamic import, and export-from", () => {
  const ws = makeTmp();
  write(
    ws,
    "a.js",
    [
      'import foo from "foo";',
      'import "bar";',
      'const y = require("foo");',
      'const z = await import("baz");',
      'export { thing } from "foo";',
    ].join("\n"),
  );

  assert.equal(countUses(ws, "foo", "ws"), 3);
  assert.equal(countUses(ws, "bar", "ws"), 1);
  assert.equal(countUses(ws, "baz", "ws"), 1);
  assert.equal(countUses(ws, "never-imported", "ws"), 0);
});

test("countUses: aggregates across multiple source files and extensions", () => {
  const ws = makeTmp();
  write(ws, "a.js", 'import foo from "foo";');
  write(ws, "sub/b.ts", 'import foo from "foo";');
  write(ws, "sub/c.tsx", 'import foo from "foo";');
  assert.equal(countUses(ws, "foo", "ws"), 3);
});

test("countUses: skips node_modules, dist, and non-source files", () => {
  const ws = makeTmp();
  write(ws, "a.js", 'import foo from "foo";');
  write(ws, "node_modules/pkg/index.js", 'import foo from "foo";');
  write(ws, "dist/bundle.js", 'import foo from "foo";');
  write(ws, "notes.md", 'import foo from "foo";');
  assert.equal(countUses(ws, "foo", "ws"), 1);
});

test("countUses: the {root} label skips the packages directory", () => {
  const ws = makeTmp();
  write(ws, "packages/p/x.js", 'import qux from "qux";');
  assert.equal(countUses(ws, "qux", "{root}"), 0);
});

test("countUses: a non-root label descends into the packages directory", () => {
  const ws = makeTmp();
  write(ws, "packages/p/x.js", 'import qux from "qux";');
  assert.equal(countUses(ws, "qux", "some-workspace"), 1);
});

test("countUses: results are stable when called repeatedly (cache)", () => {
  const ws = makeTmp();
  write(ws, "a.js", 'import foo from "foo";');
  assert.equal(countUses(ws, "foo", "ws"), 1);
  // Adding a file after the first walk must not change the cached count.
  write(ws, "b.js", 'import foo from "foo";');
  assert.equal(countUses(ws, "foo", "ws"), 1);
});
