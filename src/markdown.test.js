import { test } from "node:test";
import assert from "node:assert/strict";

import { toMarkdown } from "./markdown.js";
import { toCsv } from "./csv.js";

const rows = [
  { name: "chalk", version: "5.0.0", needsBump: true },
  { name: "left|pad", version: "1.0.0", needsBump: null },
];

test("toMarkdown: renders the same columns and values as toCsv, as a table", () => {
  assert.equal(
    toMarkdown(rows, ["name", "version", "needsBump"]),
    [
      "| name      | version | needsBump |",
      "|-----------|---------|-----------|",
      "| chalk     | 5.0.0   | ✓         |",
      "| left\\|pad | 1.0.0   | ?         |",
      "",
    ].join("\n"),
  );
});

test("toMarkdown: defaults to the Markdown column set, minus columns absent from the rows", () => {
  const out = toMarkdown(rows);
  assert.equal(out.split("\n")[0], "| name  | version |");
  assert.equal(toCsv(rows).split("\n")[0], "name,version,needsBump");
});

test("toMarkdown: prints a placeholder instead of a header-only table", () => {
  assert.equal(
    toMarkdown([], ["name", "version"]),
    "All packages are up-to-date\n",
  );
  assert.equal(
    toMarkdown([{ name: "a", needsBump: false }], ["name"]),
    "All packages are up-to-date\n",
  );
});

test("toMarkdown: without a needsBump column, rows with a falsy needsBump are skipped", () => {
  const input = [
    { name: "a", needsBump: false },
    { name: "b", needsBump: true },
    { name: "c" },
  ];
  assert.equal(
    toMarkdown(input, ["name"]),
    ["| name |", "|------|", "| b    |", ""].join("\n"),
  );
});
