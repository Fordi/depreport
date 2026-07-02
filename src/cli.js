import { parseArgs } from "node:util";

import { DEP_TYPES, DEFAULT_TYPES } from "./depTypes.js";
import { REPORT_COLUMNS } from "./csv.js";
import { DEFAULT_SORT, parseSortKey } from "./sort.js";

export const FORMATS = ["csv", "json", "package"];
export const DEFAULT_FORMAT = "csv";

export const HELP_TEXT = [
  "Usage: depreport [options] [dir]",
  "",
  "  dir                  Directory to start from (default: '.')",
  "  -o, --output <file>  Write the CSV report to <file> (default: stdout)",
  `  -t, --types <list>   Dependency types to include, comma-separated`,
  `                       (${DEP_TYPES.join(", ")}; default: ${DEFAULT_TYPES.join(", ")})`,
  "  -c, --columns <list> Columns to emit, comma-separated and in order",
  `                       (default: all)`,
  "  -s, --sort <list>    Sort order: column names, comma-separated, each",
  "                       optionally prefixed with + (ascending, the default)",
  "                       or - (descending). Use --sort=-col when the list",
  `                       starts with - (default: ${DEFAULT_SORT.join(",")})`,
  "  -f, --full           Keep the workspace/declared columns even in a",
  "                       single-package repo (they are dropped by default)",
  `  -F, --format <fmt>   Output format: ${FORMATS.join(", ")} (default: ${DEFAULT_FORMAT})`,
  "                       csv: the dependency report as CSV",
  "                       json: the report rows as JSON",
  "                       package: an install command (detected package",
  "                       manager, e.g. npm/yarn/pnpm/bun) for every",
  "                       dependency needing an in-range bump",
  "  -q, --quiet          Suppress progress messages on stderr",
  "  -h, --help           Show this help",
].join("\n");

/**
 * Parse depreport's command-line arguments.
 *
 * @param {string[]} argv Arguments without the `node` / script prefix (i.e.
 *   `process.argv.slice(2)`).
 * @returns {{ help: boolean, output: string | null, dir: string,
 *   types: string[], columns: string[] | null, sort: string[] | null,
 *   full: boolean, quiet: boolean, format: "csv" | "json" | "package" }}
 *   Normalized options: whether help was requested, the raw `--output` path
 *   (or null for stdout), the starting directory (defaulting to "."), the
 *   dependency types to include (defaulting to DEFAULT_TYPES), the columns to
 *   emit (null = all), the sort keys (null = depreport's default order),
 *   whether to keep the vestigial single-package columns, whether to
 *   suppress progress messages, and the output format (defaulting to
 *   DEFAULT_FORMAT).
 * @throws {TypeError} If an unknown option is passed or a value is missing.
 * @throws {Error} If `--types`, `--columns`, `--sort`, or `--format` includes
 *   an unrecognized value.
 */
export function parseCliArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      output: { type: "string", short: "o" },
      types: { type: "string", short: "t", multiple: true },
      columns: { type: "string", short: "c", multiple: true },
      sort: { type: "string", short: "s", multiple: true },
      full: { type: "boolean", short: "f" },
      format: { type: "string", short: "F" },
      quiet: { type: "boolean", short: "q" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  return {
    help: Boolean(values.help),
    output: values.output ?? null,
    dir: positionals[0] || ".",
    types: parseTypes(values.types),
    columns: parseColumns(values.columns),
    sort: parseSort(values.sort),
    full: Boolean(values.full),
    quiet: Boolean(values.quiet),
    format: parseFormat(values.format),
  };
}

// Turn the repeatable, comma-separated --types values into a validated list,
// e.g. ["main,dev", "peer"] -> ["main", "dev", "peer"]. Defaults when omitted.
function parseTypes(rawTypes) {
  if (!rawTypes || rawTypes.length === 0) {
    return [...DEFAULT_TYPES];
  }
  const types = rawTypes
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const invalid = types.filter((type) => !DEP_TYPES.includes(type));
  if (invalid.length > 0) {
    throw new Error(
      `Unknown dependency type(s): ${invalid.join(", ")}. ` +
        `Valid types: ${DEP_TYPES.join(", ")}`,
    );
  }
  return types;
}

// Turn the repeatable, comma-separated --columns values into a validated,
// ordered list, or null when omitted (meaning "all columns, default order").
function parseColumns(rawColumns) {
  if (!rawColumns || rawColumns.length === 0) {
    return null;
  }
  const columns = rawColumns
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const invalid = columns.filter((column) => !REPORT_COLUMNS.includes(column));
  if (invalid.length > 0) {
    throw new Error(
      `Unknown column(s): ${invalid.join(", ")}. ` +
        `Valid columns: ${REPORT_COLUMNS.join(", ")}`,
    );
  }
  return columns;
}

// Turn the repeatable, comma-separated --sort values into a validated list of
// sort keys (column names with an optional +/- direction prefix), or null when
// omitted (meaning depreport's default order).
function parseSort(rawSort) {
  if (!rawSort || rawSort.length === 0) {
    return null;
  }
  const sort = rawSort
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const invalid = sort
    .map((key) => parseSortKey(key).column)
    .filter((column) => !REPORT_COLUMNS.includes(column));
  if (invalid.length > 0) {
    throw new Error(
      `Unknown sort column(s): ${invalid.join(", ")}. ` +
        `Valid columns: ${REPORT_COLUMNS.join(", ")}`,
    );
  }
  return sort;
}

// Validate --format against the known output formats, defaulting to "csv"
// when omitted.
function parseFormat(rawFormat) {
  if (!rawFormat) {
    return DEFAULT_FORMAT;
  }
  if (!FORMATS.includes(rawFormat)) {
    throw new Error(
      `Unknown format: ${rawFormat}. Valid formats: ${FORMATS.join(", ")}`,
    );
  }
  return rawFormat;
}
