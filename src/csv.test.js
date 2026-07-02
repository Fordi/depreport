import { test } from "node:test";
import assert from "node:assert/strict";

import { toCsv, REPORT_COLUMNS } from "./csv.js";

// Rows carry rich values (workspace undefined for root, published as a Date,
// needsBump as a boolean); the CSV formatters render them back to text.
const sampleRow = {
  name: "leftpad",
  workspace: undefined,
  requested: "^1.0.0",
  version: "1.0.5",
  published: new Date("2020-01-02T00:00:00.000Z"),
  latest: "1.2.0",
  latestBump: "1.2.0",
  needsBump: true,
  size: 2048,
  uses: 3,
  declared: "root",
  type: "main",
};

test("toCsv: emits the header row in column order", () => {
  const csv = toCsv([]);
  assert.equal(csv, `${REPORT_COLUMNS.join(",")}\n`);
});

test("toCsv: formats rich values and leaves plain ones unquoted, in order", () => {
  const csv = toCsv([sampleRow]);
  const [header, dataLine] = csv.trimEnd().split("\n");
  assert.equal(header, REPORT_COLUMNS.join(","));
  // Formatters render workspace (undefined -> "{root}"), published (Date ->
  // ISO string), and needsBump (true -> "✓"); nothing needs quoting.
  assert.equal(
    dataLine,
    [
      "leftpad",
      "{root}",
      "^1.0.0",
      "1.0.5",
      "2020-01-02T00:00:00.000Z",
      "1.2.0",
      "1.2.0",
      "✓",
      "2048",
      "3",
      "root",
      "main",
    ].join(","),
  );
});

test("toCsv: stringifies numbers and renders missing fields as empty", () => {
  const columns = ["name", "size", "uses", "version"];
  const csv = toCsv([{ name: "solo", size: 0, uses: 10 }], columns);
  const cells = csv.trimEnd().split("\n")[1].split(",");
  assert.equal(cells[columns.indexOf("name")], "solo");
  // numbers become strings, including 0
  assert.equal(cells[columns.indexOf("size")], "0");
  assert.equal(cells[columns.indexOf("uses")], "10");
  // an explicitly requested column absent from the row renders empty
  assert.equal(cells[columns.indexOf("version")], "");
});

test("toCsv: default columns are the report columns present on the rows", () => {
  // depreport drops vestigial columns (e.g. workspace/declared in a
  // single-package repo); the default column set follows the rows.
  const single = { ...sampleRow };
  delete single.workspace;
  delete single.declared;
  const csv = toCsv([single]);
  const header = csv.split("\n")[0].split(",");
  assert.deepEqual(
    header,
    REPORT_COLUMNS.filter((c) => c !== "workspace" && c !== "declared"),
  );
  // With no rows to inspect, the full set is emitted.
  assert.equal(toCsv([]).split("\n")[0], REPORT_COLUMNS.join(","));
});

test("toCsv: quotes and doubles double-quotes, and flattens newlines to spaces", () => {
  const csv = toCsv([
    { name: 'a "quoted" name', workspace: "line1\nline2\r\nline3" },
  ]);
  const cells = csv.trimEnd().split("\n")[1].split(",");
  // The double-quote forces quoting (and escaping); the newlines do not.
  assert.equal(cells[REPORT_COLUMNS.indexOf("name")], '"a ""quoted"" name"');
  assert.equal(cells[REPORT_COLUMNS.indexOf("workspace")], "line1 line2 line3");
});

test("toCsv: renders an indeterminate needsBump (null) as ?", () => {
  // The extractor yields null when it cannot compare versions (e.g. no
  // registry metadata); the formatter distinguishes that from a plain "no".
  const render = (needsBump) =>
    toCsv([{ name: "x", needsBump }], ["needsBump"]).split("\n")[1];
  assert.equal(render(null), "?");
  assert.equal(render(true), "✓");
  assert.equal(render(false), "");
  // Absent entirely (undefined) is treated as "no", not indeterminate.
  assert.equal(render(undefined), "");
});

test("toCsv: quotes a field that contains a comma", () => {
  assert.equal(toCsv([{ name: "x,y" }], ["name"]), 'name\n"x,y"\n');
});

test("toCsv: always ends with a trailing newline", () => {
  assert.ok(toCsv([]).endsWith("\n"));
  assert.ok(toCsv([sampleRow]).endsWith("\n"));
});

test("toCsv: accepts a custom column selection", () => {
  const csv = toCsv([sampleRow], ["name", "version"]);
  assert.equal(csv, "name,version\nleftpad,1.0.5\n");
});
