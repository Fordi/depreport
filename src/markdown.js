import { REPORT_FORMATTERS, resolveColumns, visibleRows } from "./csv.js";
import { MARKDOWN_DEFAULT_COLUMNS } from "./columns.js";
import { markdownTable } from "./markdownTable.js";

const EMPTY_MESSAGE = "All packages are up-to-date";

// Render report rows as a Markdown table, ending with a trailing newline.
// Value formatting matches toCsv, but without an explicit `columns` list only
// MARKDOWN_DEFAULT_COLUMNS (those present on the rows) are shown. When no rows
// are left to show, a placeholder line is printed instead of a bare header.
export function toMarkdown(rows, columns, formatters = REPORT_FORMATTERS) {
  columns = resolveColumns(rows, columns, MARKDOWN_DEFAULT_COLUMNS);
  const body = visibleRows(rows, columns).map((row) =>
    columns.map((key) => {
      const formatter = formatters[key];
      return String(formatter ? formatter(row[key]) : (row[key] ?? ""));
    }),
  );
  return `${markdownTable([columns, ...body], { placeholder: EMPTY_MESSAGE })}\n`;
}
