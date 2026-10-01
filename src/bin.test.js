import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REPORT_COLUMNS } from "./csv.js";

const binPath = fileURLToPath(new URL("../bin/depreport", import.meta.url));
const header = REPORT_COLUMNS.join(",");

const tmpDirs = [];
function makeTmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(dir);
  return dir;
}

// A project with no dependencies: depreport emits only the CSV header row and
// makes no network calls, so the bin can be exercised hermetically.
function emptyProject() {
  const dir = makeTmp("depreport-bin-");
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "empty-proj" }),
  );
  return dir;
}

// Run the bin as a real child process with an isolated HOME/cache so a
// developer's ~/.npmrc or on-disk cache cannot influence the result.
function run(args) {
  return spawnSync(process.execPath, [binPath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: makeTmp("depreport-home-"),
      XDG_CACHE_HOME: makeTmp("depreport-cache-"),
    },
  });
}

after(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
});

test("bin: writes only the CSV to stdout, diagnostics to stderr", () => {
  const result = run([emptyProject()]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${header}\n`);
  assert.match(result.stderr, /Repository root:/);
});

test("bin: --quiet suppresses the stderr diagnostics", () => {
  const result = run(["--quiet", emptyProject()]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${header}\n`);
  assert.equal(result.stderr, "");
});

test("bin: -q with --output also silences the written-path echo", () => {
  const project = emptyProject();
  const outFile = path.join(project, "report.csv");
  const result = run(["-q", "-o", outFile, project]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(fs.readFileSync(outFile, "utf8"), `${header}\n`);
});

test("bin: --quiet does not silence errors", () => {
  const orphan = makeTmp("depreport-orphan-");
  const nested = path.join(orphan, "nested");
  fs.mkdirSync(nested);
  const result = run(["-q", nested]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Not inside a project/);
});

test("bin: --format json emits the rows as JSON", () => {
  const result = run(["--format", "json", emptyProject()]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "[]\n");
  assert.deepEqual(JSON.parse(result.stdout), []);
});

test("bin: --format markdown says everything is up to date when there are no rows", () => {
  const result = run(["--format", "markdown", emptyProject()]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "All packages are up-to-date\n");
});

test("bin: -F is the short alias for --format", () => {
  const result = run(["-F", "json", emptyProject()]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "[]\n");
});

test("bin: --format package emits nothing when no dependency needs a bump", () => {
  const result = run(["--format", "package", emptyProject()]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("bin: --hard emits nothing when there's nothing to update", () => {
  const result = run(["--hard", emptyProject()]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("bin: -H is the short alias for --hard, and overrides --format", () => {
  const result = run(["--format", "csv", "-H", emptyProject()]);
  assert.equal(result.status, 0);
  // --hard forces "package" output even though --format csv was also given.
  assert.equal(result.stdout, "");
});

test("bin: an unrecognized --format value exits 1 with a message on stderr", () => {
  const result = run(["--format", "xml", emptyProject()]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown format: xml/);
});

test("bin: --output writes the CSV to a file and leaves stdout empty", () => {
  const project = emptyProject();
  const outFile = path.join(project, "report.csv");
  const result = run(["-o", outFile, project]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(fs.readFileSync(outFile, "utf8"), `${header}\n`);
  // The written path is echoed to stderr.
  assert.ok(result.stderr.includes(outFile));
});

test("bin: --help prints usage to stdout and exits 0", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: `depreport/);
});

test("bin: an unknown option exits 1 with a message on stderr", () => {
  const result = run(["--nope"]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown option/);
});

test("bin: exits 1 with a clean message when run outside any project", () => {
  const orphan = makeTmp("depreport-orphan-");
  const nested = path.join(orphan, "nested");
  fs.mkdirSync(nested);
  const result = run([nested]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Not inside a project/);
});
