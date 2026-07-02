// Columns emitted by the CSV report, in order. These mirror the fields on the
// row objects returned by depreport().
export const REPORT_COLUMNS = [
  "name",
  "workspace",
  "requested",
  "version",
  "age",
  "latest",
  "latestBump",
  "needsBump",
  "size",
  "uses",
  "declared",
];

// Format a single field: newlines are flattened to spaces so each row stays on
// one line, and the field is quoted (with embedded quotes doubled) only when it
// actually needs it -- i.e. when it contains a comma or a double-quote. Plain
// values are emitted as-is.
function formatField(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Render report rows as CSV, ending with a trailing newline. The header row
// lists the columns in order.
export function toCsv(rows, columns = REPORT_COLUMNS) {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((key) => formatField(row[key])).join(","));
  }
  return `${lines.join("\n")}\n`;
}
