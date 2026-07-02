import { test } from "node:test";
import assert from "node:assert/strict";

import { parseCliArgs, HELP_TEXT } from "./cli.js";

test("parseCliArgs: defaults to '.' with no output and no help", () => {
  assert.deepEqual(parseCliArgs([]), {
    help: false,
    output: null,
    dir: ".",
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
  });
});

test("parseCliArgs: throws on an unknown option", () => {
  assert.throws(() => parseCliArgs(["--nope"]));
});

test("parseCliArgs: throws when --output is missing its value", () => {
  assert.throws(() => parseCliArgs(["--output"]));
});

test("HELP_TEXT: describes usage and both options", () => {
  assert.match(HELP_TEXT, /Usage: depreport/);
  assert.match(HELP_TEXT, /--output/);
  assert.match(HELP_TEXT, /--help/);
});
