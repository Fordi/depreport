import { BUILTIN_COLUMN_NAMES } from "./columns.js";

// Columns emitted by the CSV report, in order. These are the built-in report
// columns; they mirror the fields on the row objects returned by depreport().
export const REPORT_COLUMNS = BUILTIN_COLUMN_NAMES;

// Per-column value formatters: turn the rich values carried on the row objects
// into their CSV text representation before the generic escaping is applied.
// A `file:` dependency has no meaningful version or range to show.
const localFile = (value) => (/^file:/.test(value) ? "local file" : value);

export const REPORT_FORMATTERS = {
  workspace: (value) => value ?? "{root}",
  requested: localFile,
  version: localFile,
  published: (value) => (value ? value.toISOString() : ""),
  needsBump: (value) => (value === null ? "?" : value ? "✓" : ""),
};

// Format a single field. A column-specific `formatter` (if any) first maps the
// raw value to a display value; then newlines are flattened to spaces so each
// row stays on one line, and the field is quoted (with embedded quotes doubled)
// only when it actually needs it -- i.e. when it contains a comma or a
// double-quote. Plain values are emitted as-is.
function formatField(formatter, value) {
  const formatted = formatter ? formatter(value) : value;
  const text = String(formatted ?? "").replace(/\r?\n/g, " ");
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// The columns to emit. When `columns` is not given, the report columns
// actually present on the rows are used (depreport omits vestigial ones, e.g.
// workspace/declared in a single-package repo); with no rows at all, all of
// `defaults` is used.
export function resolveColumns(rows, columns, defaults = REPORT_COLUMNS) {
  return (
    columns ??
    (rows.length > 0
      ? defaults.filter((column) => column in rows[0])
      : defaults)
  );
}

// When the needsBump column isn't being shown, a report is read as "what needs
// a bump", so rows with any falsy needsBump (false, null/unknown, undefined,
// empty) are left out.
export function visibleRows(rows, columns) {
  return columns.includes("needsBump")
    ? rows
    : rows.filter((row) => row.needsBump);
}

// Render report rows as CSV, ending with a trailing newline. The header row
// lists the columns in order (see resolveColumns for the default set).
export function toCsv(rows, columns, formatters = REPORT_FORMATTERS) {
  columns = resolveColumns(rows, columns);
  const lines = [columns.join(",")];
  for (const row of visibleRows(rows, columns)) {
    lines.push(
      columns.map((key) => formatField(formatters[key], row[key])).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
