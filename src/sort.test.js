import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SORT, parseSortKey, buildComparator } from "./sort.js";

test("DEFAULT_SORT: bump-needed first, then oldest, then largest", () => {
  assert.deepEqual(DEFAULT_SORT, ["-needsBump", "published", "-size"]);
});

test("parseSortKey: reads the optional +/- direction prefix", () => {
  assert.deepEqual(parseSortKey("published"), {
    column: "published",
    direction: 1,
  });
  assert.deepEqual(parseSortKey("+published"), {
    column: "published",
    direction: 1,
  });
  assert.deepEqual(parseSortKey("-size"), { column: "size", direction: -1 });
  assert.throws(() => parseSortKey(""), /Invalid sort key/);
});

test("buildComparator: sorts strings ascending by default", () => {
  const rows = [{ name: "c" }, { name: "a" }, { name: "b" }];
  rows.sort(buildComparator(["name"]));
  assert.deepEqual(
    rows.map((r) => r.name),
    ["a", "b", "c"],
  );
});

test("buildComparator: a - prefix reverses the order", () => {
  const rows = [{ size: 10 }, { size: 300 }, { size: 25 }];
  rows.sort(buildComparator(["-size"]));
  assert.deepEqual(
    rows.map((r) => r.size),
    [300, 25, 10],
  );
});

test("buildComparator: Dates compare chronologically, not lexically", () => {
  const rows = [
    { published: new Date("2021-12-01T00:00:00Z") },
    { published: new Date("2021-02-01T00:00:00Z") },
    { published: new Date("2020-06-01T00:00:00Z") },
  ];
  rows.sort(buildComparator(["published"]));
  assert.deepEqual(
    rows.map(
      (r) => r.published.getUTCFullYear() * 100 + r.published.getUTCMonth() + 1,
    ),
    [202006, 202102, 202112],
  );
});

test("buildComparator: -needsBump puts true before false", () => {
  const rows = [
    { needsBump: false },
    { needsBump: true },
    { needsBump: false },
  ];
  rows.sort(buildComparator(["-needsBump"]));
  assert.deepEqual(
    rows.map((r) => r.needsBump),
    [true, false, false],
  );
});

test("buildComparator: nullish cells sort last in either direction", () => {
  const forward = [{ size: null }, { size: 5 }, {}, { size: 1 }];
  forward.sort(buildComparator(["size"]));
  assert.deepEqual(
    forward.map((r) => r.size ?? "none"),
    [1, 5, "none", "none"],
  );

  const reverse = [{ size: null }, { size: 5 }, {}, { size: 1 }];
  reverse.sort(buildComparator(["-size"]));
  assert.deepEqual(
    reverse.map((r) => r.size ?? "none"),
    [5, 1, "none", "none"],
  );
});

test("buildComparator: later keys break ties left by earlier ones", () => {
  const rows = [
    { needsBump: true, name: "b" },
    { needsBump: false, name: "a" },
    { needsBump: true, name: "a" },
  ];
  rows.sort(buildComparator(["-needsBump", "name"]));
  assert.deepEqual(
    rows.map((r) => `${r.needsBump}:${r.name}`),
    ["true:a", "true:b", "false:a"],
  );
});

test("buildComparator: a key absent from every row leaves the order alone", () => {
  const rows = [{ name: "z" }, { name: "a" }, { name: "m" }];
  rows.sort(buildComparator(["bogus"]));
  assert.deepEqual(
    rows.map((r) => r.name),
    ["z", "a", "m"],
  );
});
