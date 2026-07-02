import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate registry cache + npm config, and fix concurrency, before importing
// the module graph (registry.js reads these at import time).
const cacheDir = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "depreport-cache-")),
);
const homeDir = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "depreport-home-")),
);
const savedHome = process.env.HOME;
process.env.XDG_CACHE_HOME = cacheDir;
process.env.HOME = homeDir;
process.env.DEPREPORT_CONCURRENCY = "2";

const { depreport } = await import("./index.js");

const originalFetch = globalThis.fetch;

function installPackage(base, name, version, payload = "payload") {
  const dir = path.join(base, "node_modules", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name, version }),
  );
  fs.writeFileSync(path.join(dir, "index.js"), payload);
}

function write(dir, rel, contents) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

function serve(docs) {
  globalThis.fetch = async (url) => {
    const name = decodeURIComponent(String(url).split("/").pop());
    if (!Object.prototype.hasOwnProperty.call(docs, name)) {
      return { ok: false, json: async () => ({}) };
    }
    return { ok: true, json: async () => docs[name] };
  };
}

// A registry doc whose latest (and in-range bump) is 1.5.0, ahead of an
// installed 1.0.0, so the resulting row survives the up-to-date filter.
function outdatedDoc() {
  return {
    "dist-tags": { latest: "1.5.0" },
    time: { "1.0.0": "2021-01-01T00:00:00Z" },
    versions: { "1.0.0": {}, "1.2.0": {}, "1.5.0": {} },
  };
}

function findRow(rows, name, workspace) {
  return rows.find((r) => r.name === name && r.workspace === workspace);
}

const projectDir = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "depreport-project-")),
);

after(() => {
  globalThis.fetch = originalFetch;
  process.env.HOME = savedHome;
  for (const dir of [cacheDir, homeDir, projectDir]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("depreport: builds a row per outdated external dependency", async () => {
  fs.writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({
      name: "root-proj",
      dependencies: { leftpad: "^1.0.0", sameveldep: "^2.0.0" },
    }),
  );
  fs.writeFileSync(
    path.join(projectDir, "index.js"),
    'import leftpad from "leftpad";\n',
  );
  installPackage(projectDir, "leftpad", "1.0.5");
  installPackage(projectDir, "sameveldep", "2.0.0");

  serve({
    leftpad: {
      "dist-tags": { latest: "1.2.0" },
      time: { "1.0.5": "2020-01-02T00:00:00Z" },
      versions: { "1.0.5": {}, "1.1.0": {}, "1.2.0": {} },
    },
    sameveldep: {
      "dist-tags": { latest: "2.0.0" },
      time: { "2.0.0": "2019-01-01T00:00:00Z" },
      versions: { "2.0.0": {} },
    },
  });

  const logs = [];
  const rows = await depreport({
    dir: projectDir,
    log: (message) => logs.push(message),
  });

  // sameveldep is up to date (installed === latest), so it is omitted.
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.name, "leftpad");
  assert.equal(row.workspace, "{root}");
  assert.equal(row.requested, "^1.0.0");
  assert.equal(row.version, "1.0.5");
  assert.equal(row.age, "2020-01-02T00:00:00Z");
  assert.equal(row.latest, "1.2.0");
  // ^1.0.0 admits everything published up to <2.0.0, so the latest in-range
  // bump is 1.2.0, and the installed 1.0.5 is behind it.
  assert.equal(row.latestBump, "1.2.0");
  assert.equal(row.needsBump, "✓");
  assert.equal(row.uses, 1);
  assert.equal(row.declared, "root");
  assert.ok(row.size > 0);

  // Progress is reported through the log callback, not stdout/stderr.
  assert.ok(logs.some((message) => message.includes("Repository root:")));
});

test("depreport: reports across workspaces, excluding internal packages", async () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "depreport-mono-")),
  );
  try {
    // Root declares one shared external dep and two workspaces (explicit
    // paths -- the resolver does not expand globs like "packages/*").
    write(
      root,
      "package.json",
      JSON.stringify({
        name: "monorepo-root",
        workspaces: ["packages/app", "packages/lib"],
        dependencies: { "shared-dep": "^1.0.0" },
      }),
    );
    write(
      root,
      "packages/app/package.json",
      JSON.stringify({
        name: "@mono/app",
        dependencies: { leftpad: "^1.0.0", "@mono/lib": "^1.0.0" },
      }),
    );
    write(
      root,
      "packages/lib/package.json",
      JSON.stringify({ name: "@mono/lib", dependencies: { rimraf: "^1.0.0" } }),
    );
    // app uses the root-level shared-dep (so it should be inherited into app);
    // lib does not, and pulls in an internal workspace package.
    write(
      root,
      "packages/app/src/index.js",
      'import s from "shared-dep";\nimport lp from "leftpad";\nimport lib from "@mono/lib";\n',
    );
    write(root, "packages/lib/src/index.js", 'import r from "rimraf";\n');

    // Only external packages are installed; @mono/lib is internal and skipped.
    installPackage(root, "shared-dep", "1.0.0");
    installPackage(root, "leftpad", "1.0.0");
    installPackage(root, "rimraf", "1.0.0");

    serve({
      "shared-dep": outdatedDoc(),
      leftpad: outdatedDoc(),
      rimraf: outdatedDoc(),
    });

    const logs = [];
    const rows = await depreport({
      dir: root,
      log: (message) => logs.push(message),
    });

    // Internal packages (the root and both workspaces) never appear as rows.
    for (const internal of ["monorepo-root", "@mono/app", "@mono/lib"]) {
      assert.equal(
        rows.some((r) => r.name === internal),
        false,
        `${internal} should be excluded as an internal package`,
      );
    }

    // Root workspace: its own declared dependency, labelled {root}/root.
    const rootShared = findRow(rows, "shared-dep", "{root}");
    assert.ok(rootShared, "expected shared-dep under {root}");
    assert.equal(rootShared.declared, "root");

    // app workspace: its own dep is "subproject"; the root dep it imports is
    // inherited and labelled "root".
    const appLeftpad = findRow(rows, "leftpad", "@mono/app");
    assert.ok(appLeftpad, "expected leftpad under @mono/app");
    assert.equal(appLeftpad.declared, "subproject");

    const appShared = findRow(rows, "shared-dep", "@mono/app");
    assert.ok(appShared, "expected inherited shared-dep under @mono/app");
    assert.equal(appShared.declared, "root");
    assert.ok(appShared.uses >= 1);

    // lib workspace: its own dep only. It never imports shared-dep, so the
    // root dep is NOT inherited here (inheritance is gated on real usage).
    const libRimraf = findRow(rows, "rimraf", "@mono/lib");
    assert.ok(libRimraf, "expected rimraf under @mono/lib");
    assert.equal(libRimraf.declared, "subproject");
    assert.equal(findRow(rows, "shared-dep", "@mono/lib"), undefined);

    // Exactly those four rows.
    assert.equal(rows.length, 4);

    // Workspaces are announced through the log callback.
    assert.ok(logs.some((m) => m.includes("Workspaces:")));
    assert.ok(logs.some((m) => m.includes("@mono/app")));
    assert.ok(logs.some((m) => m.includes("@mono/lib")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("depreport: throws when started outside any project", async () => {
  const orphan = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "depreport-orphan-")),
  );
  try {
    // No package.json here or (in a temp dir) above it up to the fs root.
    await assert.rejects(
      depreport({ dir: path.join(orphan, "nested") }),
      /Not inside a project/,
    );
  } finally {
    fs.rmSync(orphan, { recursive: true, force: true });
  }
});
