import { test } from "node:test";
import assert from "node:assert/strict";

import { parseCliArgs, HELP_TEXT, FORMATS, DEFAULT_FORMAT } from "./cli.js";

test("parseCliArgs: defaults to '.' with no output, no help, and main+dev types", () => {
  assert.deepEqual(parseCliArgs([]), {
    help: false,
    output: null,
    dir: ".",
    types: ["main", "dev"],
    columns: null,
    sort: null,
    full: false,
    quiet: false,
    format: DEFAULT_FORMAT,
    hard: false,
  });
});

test("parseCliArgs: takes the starting directory from the first positional", () => {
  assert.equal(parseCliArgs(["some/dir"]).dir, "some/dir");
});

test("parseCliArgs: reads --output and its -o alias", () => {
  assert.equal(parseCliArgs(["--output", "out.csv"]).output, "out.csv");
  assert.equal(parseCliArgs(["-o", "out.csv"]).output, "out.csv");
  assert.equal(parseCliArgs(["--output=out.csv"]).output, "out.csv");
});

test("parseCliArgs: recognizes --help and its -h alias", () => {
  assert.equal(parseCliArgs(["--help"]).help, true);
  assert.equal(parseCliArgs(["-h"]).help, true);
});

test("parseCliArgs: combines an option and a positional", () => {
  assert.deepEqual(parseCliArgs(["-o", "report.csv", "packages/app"]), {
    help: false,
    output: "report.csv",
    dir: "packages/app",
    types: ["main", "dev"],
    columns: null,
    sort: null,
    full: false,
    quiet: false,
    format: DEFAULT_FORMAT,
    hard: false,
  });
});

test("parseCliArgs: reads --types as a comma-separated list", () => {
  assert.deepEqual(parseCliArgs(["--types", "main,peer"]).types, [
    "main",
    "peer",
  ]);
});

test("parseCliArgs: accepts repeated -t flags and merges them", () => {
  assert.deepEqual(parseCliArgs(["-t", "dev", "-t", "optional"]).types, [
    "dev",
    "optional",
  ]);
});

test("parseCliArgs: throws on an unrecognized dependency type", () => {
  assert.throws(
    () => parseCliArgs(["--types", "main,bogus"]),
    /Unknown dependency type/,
  );
});

test("parseCliArgs: columns default to null (all columns)", () => {
  assert.equal(parseCliArgs([]).columns, null);
});

test("parseCliArgs: reads --columns as an ordered, comma-separated list", () => {
  assert.deepEqual(parseCliArgs(["--columns", "name,latest"]).columns, [
    "name",
    "latest",
  ]);
  assert.deepEqual(parseCliArgs(["-c", "version", "-c", "size"]).columns, [
    "version",
    "size",
  ]);
});

test("parseCliArgs: throws on an unrecognized column", () => {
  assert.throws(
    () => parseCliArgs(["--columns", "name,bogus"]),
    /Unknown column/,
  );
});

test("parseCliArgs: sort defaults to null (depreport's default order)", () => {
  assert.equal(parseCliArgs([]).sort, null);
});

test("parseCliArgs: reads --sort as a comma-separated list of keys", () => {
  // A value starting with "-" must use the = form (parseArgs would otherwise
  // read it as an option); after that, commas and repetition work as usual.
  assert.deepEqual(parseCliArgs(["--sort=-published,name"]).sort, [
    "-published",
    "name",
  ]);
  assert.deepEqual(parseCliArgs(["-s", "name", "-s", "+size"]).sort, [
    "name",
    "+size",
  ]);
});

test("parseCliArgs: recognizes --full and its -f alias", () => {
  assert.equal(parseCliArgs([]).full, false);
  assert.equal(parseCliArgs(["--full"]).full, true);
  assert.equal(parseCliArgs(["-f"]).full, true);
});

test("parseCliArgs: recognizes --quiet and its -q alias", () => {
  assert.equal(parseCliArgs([]).quiet, false);
  assert.equal(parseCliArgs(["--quiet"]).quiet, true);
  assert.equal(parseCliArgs(["-q"]).quiet, true);
});

test("parseCliArgs: format defaults to csv", () => {
  assert.equal(parseCliArgs([]).format, "csv");
  assert.deepEqual(FORMATS, ["csv", "json", "package"]);
});

test("parseCliArgs: reads --format and its -F alias", () => {
  assert.equal(parseCliArgs(["--format", "json"]).format, "json");
  assert.equal(parseCliArgs(["-F", "package"]).format, "package");
});

test("parseCliArgs: throws on an unrecognized --format value", () => {
  assert.throws(() => parseCliArgs(["--format", "xml"]), /Unknown format: xml/);
});

test("parseCliArgs: recognizes --hard and its -H alias", () => {
  assert.equal(parseCliArgs([]).hard, false);
  assert.equal(parseCliArgs(["--hard"]).hard, true);
  assert.equal(parseCliArgs(["-H"]).hard, true);
});

test("parseCliArgs: throws on a sort key naming an unknown column", () => {
  assert.throws(
    () => parseCliArgs(["--sort", "name,-bogus"]),
    /Unknown sort column\(s\): bogus/,
  );
});

test("parseCliArgs: throws on an unknown option", () => {
  assert.throws(() => parseCliArgs(["--nope"]));
});

test("parseCliArgs: throws when --output is missing its value", () => {
  assert.throws(() => parseCliArgs(["--output"]));
});

test("HELP_TEXT: describes usage and the options", () => {
  assert.match(HELP_TEXT, /Usage: depreport/);
  assert.match(HELP_TEXT, /--output/);
  assert.match(HELP_TEXT, /--types/);
  assert.match(HELP_TEXT, /--sort/);
  assert.match(HELP_TEXT, /--full/);
  assert.match(HELP_TEXT, /--format/);
  assert.match(HELP_TEXT, /--hard/);
  assert.match(HELP_TEXT, /--quiet/);
  assert.match(HELP_TEXT, /--help/);
});
