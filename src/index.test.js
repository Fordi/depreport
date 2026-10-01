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

const { depreport, toCsv, REPORT_COLUMNS, REPORT_FORMATTERS } =
  await import("./index.js");

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
  // A single-package repo drops the vestigial workspace/declared columns.
  assert.equal("workspace" in row, false);
  assert.equal("declared" in row, false);
  assert.equal(row.requested, "^1.0.0");
  assert.equal(row.version, "1.0.5");
  // published is a Date in the primary data.
  assert.ok(row.published instanceof Date);
  assert.equal(row.published.toISOString(), "2020-01-02T00:00:00.000Z");
  assert.equal(row.latest, "1.2.0");
  // ^1.0.0 admits everything published up to <2.0.0, so the latest in-range
  // bump is 1.2.0, and the installed 1.0.5 is behind it.
  assert.equal(row.latestBump, "1.2.0");
  assert.equal(row.needsBump, true);
  assert.equal(row.uses, 1);
  assert.ok(row.size > 0);

  // Progress is reported through the log callback, not stdout/stderr.
  assert.ok(logs.some((message) => message.includes("Repository root:")));

  // full: true overrides the single-package detection and keeps both columns.
  const [fullRow] = await depreport({ dir: projectDir, full: true });
  assert.equal(fullRow.workspace, undefined);
  assert.equal("workspace" in fullRow, true);
  assert.equal(fullRow.declared, "root");
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

    // Root workspace: its own declared dependency, with an undefined workspace.
    const rootShared = findRow(rows, "shared-dep", undefined);
    assert.ok(rootShared, "expected shared-dep under the root");
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

test("depreport: a workspace's own type/range wins over the root's declaration", async () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "depreport-xtalk-")),
  );
  try {
    // The same package is declared three ways: dev at the root, main in app
    // (with its own range), dev in lib. Each row must reflect its own
    // manifest -- the root's entry must not bleed into workspaces that
    // declare (and use) the package themselves.
    write(
      root,
      "package.json",
      JSON.stringify({
        name: "xtalk-root",
        workspaces: ["packages/app", "packages/lib"],
        devDependencies: { shady: "^1.0.0" },
      }),
    );
    write(
      root,
      "packages/app/package.json",
      JSON.stringify({ name: "@x/app", dependencies: { shady: "^1.2.0" } }),
    );
    write(
      root,
      "packages/lib/package.json",
      JSON.stringify({ name: "@x/lib", devDependencies: { shady: "^1.0.0" } }),
    );
    write(root, "packages/app/src/index.js", 'import s from "shady";\n');
    write(root, "packages/lib/src/index.js", 'import s from "shady";\n');
    installPackage(root, "shady", "1.2.0");
    serve({ shady: outdatedDoc() });

    const rows = await depreport({ dir: root });

    const app = findRow(rows, "shady", "@x/app");
    assert.ok(app, "expected shady under @x/app");
    assert.equal(app.declared, "subproject");
    assert.equal(app.type, "main");
    assert.equal(app.requested, "^1.2.0");

    const lib = findRow(rows, "shady", "@x/lib");
    assert.ok(lib, "expected shady under @x/lib");
    assert.equal(lib.declared, "subproject");
    assert.equal(lib.type, "dev");
    assert.equal(lib.requested, "^1.0.0");

    const rootRow = findRow(rows, "shady", undefined);
    assert.ok(rootRow, "expected shady under the root");
    assert.equal(rootRow.declared, "root");
    assert.equal(rootRow.type, "dev");
    assert.equal(rootRow.requested, "^1.0.0");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("depreport: honors the types option and reports the declaring section", async () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "depreport-types-")),
  );
  try {
    write(
      root,
      "package.json",
      JSON.stringify({
        name: "typed-proj",
        dependencies: { maindep: "^1.0.0" },
        devDependencies: { devdep: "^1.0.0" },
        peerDependencies: { peerdep: "^1.0.0" },
        optionalDependencies: { optdep: "^1.0.0" },
      }),
    );
    for (const name of ["maindep", "devdep", "peerdep", "optdep"]) {
      installPackage(root, name, "1.0.0");
    }
    serve({
      maindep: outdatedDoc(),
      devdep: outdatedDoc(),
      peerdep: outdatedDoc(),
      optdep: outdatedDoc(),
    });

    // Default types: main + dev only.
    const def = await depreport({ dir: root });
    assert.deepEqual(def.map((r) => [r.name, r.type]).sort(), [
      ["devdep", "dev"],
      ["maindep", "main"],
    ]);

    // Explicit selection pulls in the other two sections and labels them.
    const peerOptional = await depreport({
      dir: root,
      types: ["peer", "optional"],
    });
    assert.deepEqual(peerOptional.map((r) => [r.name, r.type]).sort(), [
      ["optdep", "optional"],
      ["peerdep", "peer"],
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("depreport: transitive and transitive-only include nested dependencies", async () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "depreport-transitive-")),
  );
  try {
    write(
      root,
      "package.json",
      JSON.stringify({
        name: "transitive-proj",
        dependencies: { appdep: "^1.0.0" },
      }),
    );
    write(root, "index.js", 'import appdep from "appdep";\n');
    installPackage(root, "appdep", "1.0.0");
    // appdep depends on nesteddep; nesteddep is not directly declared.
    write(
      root,
      "node_modules/appdep/package.json",
      JSON.stringify({
        name: "appdep",
        version: "1.0.0",
        dependencies: { nesteddep: "^1.0.0" },
      }),
    );
    installPackage(root, "nesteddep", "1.0.0");

    serve({ appdep: outdatedDoc(), nesteddep: outdatedDoc() });

    const withoutTransitive = await depreport({ dir: root });
    assert.ok(findRow(withoutTransitive, "appdep", undefined));
    assert.equal(findRow(withoutTransitive, "nesteddep", undefined), undefined);

    const withTransitive = await depreport({
      dir: root,
      full: true,
      transitive: true,
    });
    const nested = findRow(withTransitive, "nesteddep", undefined);
    assert.ok(nested);
    assert.equal(nested.declared, "transitive");
    assert.equal(nested.type, "main");
    assert.ok(findRow(withTransitive, "appdep", undefined));

    const transitiveOnly = await depreport({
      dir: root,
      transitiveOnly: true,
    });
    assert.deepEqual(
      transitiveOnly.map((row) => row.name),
      ["nesteddep"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("depreport: includeSize=false omits the built-in size column", async () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "depreport-nosize-")),
  );
  try {
    write(
      root,
      "package.json",
      JSON.stringify({
        name: "nosize-proj",
        dependencies: { appdep: "^1.0.0" },
      }),
    );
    write(root, "index.js", 'import appdep from "appdep";\n');
    installPackage(root, "appdep", "1.0.0");
    serve({ appdep: outdatedDoc() });

    const [withSize] = await depreport({ dir: root, full: true });
    assert.equal("size" in withSize, true);

    const [withoutSize] = await depreport({
      dir: root,
      full: true,
      includeSize: false,
    });
    assert.equal("size" in withoutSize, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("depreport: includeSize=false keeps an explicit custom size extractor", async () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "depreport-nosize-custom-")),
  );
  try {
    write(
      root,
      "package.json",
      JSON.stringify({
        name: "nosize-custom-proj",
        dependencies: { appdep: "^1.0.0" },
      }),
    );
    write(root, "index.js", 'import appdep from "appdep";\n');
    installPackage(root, "appdep", "1.0.0");
    serve({ appdep: outdatedDoc() });

    const [row] = await depreport({
      dir: root,
      full: true,
      includeSize: false,
      columns: {
        size: () => 42,
      },
    });
    assert.equal(row.size, 42);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("depreport: supports custom columns with the (metadata, context) contract", async () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "depreport-cols-")),
  );
  try {
    write(
      root,
      "package.json",
      JSON.stringify({
        name: "cols-proj",
        dependencies: { leftpad: "^1.0.0" },
      }),
    );
    write(root, "index.js", 'import leftpad from "leftpad";\n');
    installPackage(root, "leftpad", "1.0.5");
    serve({
      leftpad: {
        "dist-tags": { latest: "1.2.0" },
        time: { "1.0.5": "2020-01-02T00:00:00Z" },
        versions: { "1.0.5": {}, "1.2.0": {} },
      },
    });

    const seen = [];
    const rows = await depreport({
      dir: root,
      columns: {
        // A custom column that reads both metadata and context.
        tagline: (metadata, context) => {
          seen.push({ name: context.name, latest: metadata?.latest });
          return `${context.name}@${metadata?.latest}`;
        },
        // Overriding a vestigial column keeps it, even in a single-package
        // repo where the built-in would have been dropped.
        declared: () => "custom",
      },
    });

    assert.equal(rows.length, 1);
    // Built-in columns are still present alongside the custom one.
    assert.equal(rows[0].name, "leftpad");
    assert.equal(rows[0].latest, "1.2.0");
    assert.equal(rows[0].tagline, "leftpad@1.2.0");
    assert.equal(rows[0].declared, "custom");
    // The un-overridden vestigial column is still dropped.
    assert.equal("workspace" in rows[0], false);
    // The extractor received the fetched metadata and the dependency context.
    assert.deepEqual(seen, [{ name: "leftpad", latest: "1.2.0" }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("depreport: orders rows per the sort option", async () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "depreport-sort-")),
  );
  try {
    write(
      root,
      "package.json",
      JSON.stringify({
        name: "sort-proj",
        dependencies: {
          alpha: "^1.0.0",
          beta: "^1.0.0",
          gamma: "^1.0.0",
        },
      }),
    );
    for (const name of ["alpha", "beta", "gamma"]) {
      installPackage(root, name, "1.0.0");
    }
    // alpha and beta need a bump (published 2021 and 2019 respectively);
    // gamma has no registry metadata, so its needsBump is indeterminate
    // (null) and its published is undefined.
    const docFor = (published) => ({
      "dist-tags": { latest: "1.5.0" },
      time: { "1.0.0": published },
      versions: { "1.0.0": {}, "1.5.0": {} },
    });
    serve({
      alpha: docFor("2021-05-01T00:00:00Z"),
      beta: docFor("2019-01-01T00:00:00Z"),
    });

    const names = (rows) => rows.map((r) => r.name);

    // Default (-needsBump, published, -size): bump-needed rows first, oldest
    // publish date first among them; gamma's nullish cells sort last.
    assert.deepEqual(names(await depreport({ dir: root })), [
      "beta",
      "alpha",
      "gamma",
    ]);

    // An explicit spec replaces the default entirely.
    assert.deepEqual(names(await depreport({ dir: root, sort: ["name"] })), [
      "alpha",
      "beta",
      "gamma",
    ]);
    assert.deepEqual(names(await depreport({ dir: root, sort: ["-name"] })), [
      "gamma",
      "beta",
      "alpha",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("index: re-exports the CSV API from the package root", async () => {
  const csv = await import("./csv.js");
  assert.equal(toCsv, csv.toCsv);
  assert.equal(REPORT_COLUMNS, csv.REPORT_COLUMNS);
  assert.equal(REPORT_FORMATTERS, csv.REPORT_FORMATTERS);
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
