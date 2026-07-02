import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// registry.js reads these at import time, so configure the environment before
// dynamically importing it: an isolated disk cache and a fixed concurrency.
const cacheDir = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "depreport-cache-")),
);
process.env.XDG_CACHE_HOME = cacheDir;
process.env.DEPREPORT_CONCURRENCY = "2";

const {
  fetchLatestVersion,
  fetchPublishedAt,
  fetchLatestCompatibleVersion,
  prefetchMetadata,
} = await import("./registry.js");

// npmConfig the report layer would normally supply; the mock ignores the host.
const cfg = {
  defaultRegistry: "https://registry.test/",
  scopeRegistries: new Map(),
  authEntries: new Map(),
};

const originalFetch = globalThis.fetch;
let fetchCalls = [];

// Serve the given registry documents keyed by package name; reset the call
// log so each test can assert exactly how many network round-trips happened.
function serve(docs) {
  fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    const name = decodeURIComponent(String(url).split("/").pop());
    if (!Object.prototype.hasOwnProperty.call(docs, name)) {
      return { ok: false, json: async () => ({}) };
    }
    return { ok: true, json: async () => docs[name] };
  };
}

after(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test("fetchLatestVersion: returns dist-tags.latest and caches by package", async () => {
  serve({
    alpha: {
      "dist-tags": { latest: "1.2.0" },
      time: { "1.2.0": "2021-01-01T00:00:00Z" },
      versions: { "1.2.0": {} },
    },
  });
  assert.equal(await fetchLatestVersion("alpha", cfg), "1.2.0");
  assert.equal(fetchCalls.length, 1);
  // A second lookup is served from the in-memory cache.
  assert.equal(await fetchLatestVersion("alpha", cfg), "1.2.0");
  assert.equal(fetchCalls.length, 1);
});

test("fetchLatestVersion: unknown package resolves to '' and caches the negative", async () => {
  serve({});
  assert.equal(await fetchLatestVersion("ghost", cfg), "");
  assert.equal(fetchCalls.length, 1);
  // The failed lookup is remembered; no refetch within the run.
  assert.equal(await fetchLatestVersion("ghost", cfg), "");
  assert.equal(fetchCalls.length, 1);
});

test("fetchPublishedAt: returns the publish time for a known version", async () => {
  serve({
    bravo: {
      "dist-tags": { latest: "2.0.0" },
      time: { "2.0.0": "2020-05-05T00:00:00Z" },
      versions: { "2.0.0": {} },
    },
  });
  assert.equal(
    await fetchPublishedAt("bravo", "2.0.0", cfg),
    "2020-05-05T00:00:00Z",
  );
  assert.equal(await fetchPublishedAt("bravo", "9.9.9", cfg), "");
});

test("fetchPublishedAt: short-circuits local specifiers without any fetch", async () => {
  serve({});
  assert.equal(await fetchPublishedAt("x", "file:./local", cfg), "");
  assert.equal(await fetchPublishedAt("x", "link:../l", cfg), "");
  assert.equal(await fetchPublishedAt("x", "workspace:*", cfg), "");
  assert.equal(await fetchPublishedAt("x", "https://host/x.tgz", cfg), "");
  assert.equal(await fetchPublishedAt("", "1.0.0", cfg), "");
  assert.equal(await fetchPublishedAt("x", "", cfg), "");
  assert.equal(fetchCalls.length, 0);
});

test("fetchLatestCompatibleVersion: highest stable version within a caret range", async () => {
  serve({
    charlie: {
      "dist-tags": { latest: "1.4.1-beta" },
      time: {},
      versions: {
        "1.2.0": {},
        "1.3.5": {},
        "1.4.0": {},
        "1.4.1-beta": {},
        "2.0.0": {},
      },
    },
  });
  // ^1.2.0 admits same-major, >= base, < 2.0.0; prereleases are excluded, so
  // 1.4.0 is the highest compatible stable release.
  assert.equal(
    await fetchLatestCompatibleVersion("charlie", "^1.2.0", cfg),
    "1.4.0",
  );
  assert.equal(await fetchLatestCompatibleVersion("ghost", "^1.0.0", cfg), "");
});

test("fetchLatestCompatibleVersion: a tilde range is capped at the next minor", async () => {
  serve({
    tango: {
      "dist-tags": { latest: "1.3.0" },
      time: {},
      versions: { "1.2.0": {}, "1.2.5": {}, "1.2.9": {}, "1.3.0": {} },
    },
  });
  // ~1.2.0 admits 1.2.x only, so 1.2.9 is the highest match (1.3.0 excluded).
  assert.equal(
    await fetchLatestCompatibleVersion("tango", "~1.2.0", cfg),
    "1.2.9",
  );
});

test("fetchLatestCompatibleVersion: an exact pin resolves to itself, unsupported ranges to ''", async () => {
  serve({
    victor: {
      "dist-tags": { latest: "1.4.0" },
      time: {},
      versions: { "1.2.0": {}, "1.4.0": {} },
    },
  });
  assert.equal(
    await fetchLatestCompatibleVersion("victor", "1.2.0", cfg),
    "1.2.0",
  );
  // Non-^/~/exact specifiers (tags, wildcards, protocols) match nothing.
  assert.equal(await fetchLatestCompatibleVersion("victor", "*", cfg), "");
});

test("prefetchMetadata: warms the cache so later lookups need no fetch", async () => {
  serve({
    delta: {
      "dist-tags": { latest: "1.0.0" },
      time: {},
      versions: { "1.0.0": {} },
    },
    echo: {
      "dist-tags": { latest: "2.0.0" },
      time: {},
      versions: { "2.0.0": {} },
    },
  });
  await prefetchMetadata(["delta", "echo", "delta"], cfg);
  assert.equal(fetchCalls.length, 2); // deduped to two unique packages
  assert.equal(await fetchLatestVersion("delta", cfg), "1.0.0");
  assert.equal(await fetchLatestVersion("echo", cfg), "2.0.0");
  assert.equal(fetchCalls.length, 2); // both served from cache
});
