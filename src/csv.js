import { BUILTIN_COLUMN_NAMES } from "./columns.js";

// Columns emitted by the CSV report, in order. These are the built-in report
// columns; they mirror the fields on the row objects returned by depreport().
export const REPORT_COLUMNS = BUILTIN_COLUMN_NAMES;

// Per-column value formatters: turn the rich values carried on the row objects
// into their CSV text representation before the generic escaping is applied.
export const REPORT_FORMATTERS = {
  workspace: (value) => value ?? "{root}",
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

// Render report rows as CSV, ending with a trailing newline. The header row
// lists the columns in order. When `columns` is not given, the report columns
// actually present on the rows are emitted (depreport omits vestigial ones,
// e.g. workspace/declared in a single-package repo); with no rows at all, the
// full set is emitted.
export function toCsv(rows, columns, formatters = REPORT_FORMATTERS) {
  columns ??=
    rows.length > 0
      ? REPORT_COLUMNS.filter((column) => column in rows[0])
      : REPORT_COLUMNS;
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(
      columns.map((key) => formatField(formatters[key], row[key])).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
