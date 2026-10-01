import { test } from "node:test";
import assert from "node:assert/strict";

import { markdownTable } from "./markdownTable.js";

test("markdownTable: renders a padded, left-aligned table by default", () => {
  assert.equal(
    markdownTable([
      ["Flag", "Meaning"],
      ["`-q`", "Quiet"],
    ]),
    ["| Flag | Meaning |", "|------|---------|", "| `-q` | Quiet   |"].join(
      "\n",
    ),
  );
});

test("markdownTable: applies one alignment to every column", () => {
  assert.equal(
    markdownTable(
      [
        ["a", "bb"],
        ["ccc", "d"],
      ],
      { alignments: "right" },
    ),
    ["|   a |  bb |", "|----:|----:|", "| ccc |   d |"].join("\n"),
  );
});

test("markdownTable: applies per-column alignments", () => {
  assert.equal(
    markdownTable(
      [
        ["name", "n"],
        ["x", "1"],
      ],
      { alignments: ["center", "right"] },
    ),
    ["| name |   n |", "|:----:|----:|", "|  x   |   1 |"].join("\n"),
  );
});

test("markdownTable: defaults missing or unknown alignments to left", () => {
  assert.equal(
    markdownTable([["a", "b"]], { alignments: ["right", "bogus"] }),
    ["|   a | b   |", "|----:|-----|"].join("\n"),
  );
});

test("markdownTable: pads short rows with empty cells", () => {
  assert.equal(
    markdownTable([["a", "b"], ["x"]]),
    ["| a   | b   |", "|-----|-----|", "| x   |     |"].join("\n"),
  );
});

test("markdownTable: escapes pipes and flattens newlines", () => {
  assert.equal(
    markdownTable([["h"], ["a|b\nc"]]),
    ["| h      |", "|--------|", "| a\\|b c |"].join("\n"),
  );
});

test("markdownTable: returns an empty string for no rows", () => {
  assert.equal(markdownTable([]), "");
});

test("markdownTable: prints the placeholder instead of a header-only table", () => {
  assert.equal(
    markdownTable([["a", "b"]], { placeholder: "_Nothing to show._" }),
    "_Nothing to show._",
  );
  assert.equal(
    markdownTable([], { placeholder: "_Nothing to show._" }),
    "_Nothing to show._",
  );
});

test("markdownTable: ignores the placeholder when there is a body row", () => {
  assert.equal(
    markdownTable([["a"], ["b"]], { placeholder: "none" }),
    ["| a   |", "|-----|", "| b   |"].join("\n"),
  );
});
