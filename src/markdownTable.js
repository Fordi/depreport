const SEPARATORS = {
  left: (width) => `-${"-".repeat(width - 2)}-`,
  right: (width) => `-${"-".repeat(width - 2)}:`,
  center: (width) => `:${"-".repeat(width - 2)}:`,
};

const PADDERS = {
  left: (text, width) => text.padEnd(width),
  right: (text, width) => text.padStart(width),
  center: (text, width) => {
    const total = width - text.length;
    const before = Math.floor(total / 2);
    return `${" ".repeat(before)}${text}${" ".repeat(total - before)}`;
  },
};

// Flatten newlines (a cell must stay on one line) and escape pipes, which
// would otherwise end the cell.
function escapeCell(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|");
}

/**
 * Render rows as a GitHub-flavored Markdown table, with columns padded so the
 * source reads as a table too.
 *
 * @param {string[][]} rows The first row is the header; the rest are the body.
 *   Short rows are padded with empty cells.
 * @param {object} [options]
 * @param {"left" | "right" | "center" | Array<"left" | "right" | "center">}
 *   [options.alignments="left"] One alignment for every column, or one per
 *   column (missing entries default to "left").
 * @param {string} [options.placeholder] Returned instead of the table when
 *   there is no body (only a header row, or no rows at all).
 * @returns {string} The table, one line per row plus the separator line; empty
 *   when there are no rows (unless a placeholder is given).
 */
export function markdownTable(rows, { alignments = "left", placeholder } = {}) {
  if (placeholder !== undefined && rows.length <= 1) {
    return placeholder;
  }
  if (rows.length === 0) {
    return "";
  }
  const columnCount = Math.max(...rows.map((row) => row.length));
  const cells = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => escapeCell(row[index])),
  );
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const requested = Array.isArray(alignments)
      ? alignments[index]
      : alignments;
    const alignment = requested in PADDERS ? requested : "left";
    // The separator needs at least three characters (`---`, `--:`, `:-:`).
    const width = Math.max(3, ...cells.map((row) => row[index].length));
    return { alignment, width };
  });
  const renderRow = (row) =>
    `| ${row
      .map((cell, index) =>
        PADDERS[columns[index].alignment](cell, columns[index].width),
      )
      .join(" | ")} |`;
  const separator = `|${columns
    .map(({ alignment, width }) => SEPARATORS[alignment](width + 2))
    .join("|")}|`;
  const [header, ...body] = cells;
  return [renderRow(header), separator, ...body.map(renderRow)].join("\n");
}
