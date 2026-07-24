import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const binPath = fileURLToPath(
  new URL("../bin/overrideTransitive", import.meta.url),
);

const tmpDirs = [];
function makeTmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(dir);
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    encoding: "utf8",
  });
}

after(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
});

test("overrideTransitive bin: updates root package.json overrides", () => {
  const root = makeTmp("depreport-override-bin-");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "proj" }));

  const result = run(["left-pad@1.3.0", "@scope/pkg@^2.0.0"], root);
  assert.equal(result.status, 0);

  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  assert.deepEqual(manifest.overrides, {
    "@scope/pkg": "^2.0.0",
    "left-pad": "1.3.0",
  });
});

test("overrideTransitive bin: exits 1 for invalid args", () => {
  const root = makeTmp("depreport-override-bin-bad-");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "proj" }));

  const result = run(["not-a-spec"], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid override spec/);
});
