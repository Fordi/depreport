import { test } from "node:test";
import assert from "node:assert/strict";

import { toCsv, REPORT_COLUMNS } from "./csv.js";

const sampleRow = {
  name: "leftpad",
  workspace: "{root}",
  requested: "^1.0.0",
  version: "1.0.5",
  age: "2020-01-02T00:00:00Z",
  latest: "1.2.0",
  latestBump: "1.2.0",
  needsBump: "✓",
  size: 2048,
  uses: 3,
  declared: "root",
};

test("toCsv: emits the header row in column order", () => {
  const csv = toCsv([]);
  assert.equal(csv, `${REPORT_COLUMNS.join(",")}\n`);
});

test("toCsv: leaves plain values unquoted, preserving column order", () => {
  const csv = toCsv([sampleRow]);
  const [header, dataLine] = csv.trimEnd().split("\n");
  assert.equal(header, REPORT_COLUMNS.join(","));
  // None of these values contain a comma or double-quote, so none are quoted.
  assert.equal(
    dataLine,
    [
      "leftpad",
      "{root}",
      "^1.0.0",
      "1.0.5",
      "2020-01-02T00:00:00Z",
      "1.2.0",
      "1.2.0",
      "✓",
      "2048",
      "3",
      "root",
    ].join(","),
  );
});

test("toCsv: stringifies numbers and renders missing fields as empty", () => {
  const csv = toCsv([{ name: "solo", size: 0, uses: 10 }]);
  const cells = csv.trimEnd().split("\n")[1].split(",");
  assert.equal(cells[REPORT_COLUMNS.indexOf("name")], "solo");
  // numbers become strings, including 0
  assert.equal(cells[REPORT_COLUMNS.indexOf("size")], "0");
  assert.equal(cells[REPORT_COLUMNS.indexOf("uses")], "10");
  // absent fields render as an empty cell
  assert.equal(cells[REPORT_COLUMNS.indexOf("version")], "");
});

test("toCsv: quotes and doubles double-quotes, and flattens newlines to spaces", () => {
  const csv = toCsv([
    { name: 'a "quoted" name', workspace: "line1\nline2\r\nline3" },
  ]);
  const cells = csv.trimEnd().split("\n")[1].split(",");
  // The double-quote forces quoting (and escaping); the newlines do not.
  assert.equal(cells[REPORT_COLUMNS.indexOf("name")], '"a ""quoted"" name"');
  assert.equal(
    cells[REPORT_COLUMNS.indexOf("workspace")],
    "line1 line2 line3",
  );
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
