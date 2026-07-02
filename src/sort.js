/**
 * Report row ordering.
 *
 * A sort spec is a list of column names, each optionally prefixed with `+`
 * (ascending, the default when unprefixed) or `-` (descending), applied in
 * order: later keys break ties left by earlier ones.
 */

// Default report order: rows needing a bump first, oldest publish date first
// within those, largest install size first as the final discriminator.
export const DEFAULT_SORT = ["-needsBump", "published", "-size"];

/**
 * Split a sort key into its column name and direction.
 *
 * @param {string} spec A column name, optionally prefixed with `+` or `-`.
 * @returns {{ column: string, direction: 1 | -1 }}
 * @throws {Error} If the spec is empty.
 */
export function parseSortKey(spec) {
  const match = /^([+-]?)(.+)$/.exec(spec);
  if (!match) {
    throw new Error(`Invalid sort key: ${JSON.stringify(spec)}`);
  }
  return { column: match[2], direction: match[1] === "-" ? -1 : 1 };
}

// Compare two defined cell values. Dates compare chronologically and booleans
// as false < true; two numbers compare numerically; anything else falls back
// to string comparison.
function compareDefined(a, b) {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  if (typeof x === "number" && typeof y === "number") {
    return x - y;
  }
  if (typeof x === "boolean" && typeof y === "boolean") {
    return x - y;
  }
  return String(x).localeCompare(String(y));
}

/**
 * Build a row comparator from a sort spec. Nullish cells sort after defined
 * ones regardless of direction, so indeterminate values land at the bottom
 * either way.
 *
 * @param {string[]} sort Sort keys as accepted by {@link parseSortKey}.
 * @returns {(a: object, b: object) => number}
 */
export function buildComparator(sort = DEFAULT_SORT) {
  const keys = sort.map(parseSortKey);
  return (a, b) => {
    for (const { column, direction } of keys) {
      const left = a[column];
      const right = b[column];
      if (left == null || right == null) {
        if (left != null) return -1;
        if (right != null) return 1;
        continue;
      }
      const order = compareDefined(left, right);
      if (order !== 0) {
        return direction * order;
      }
    }
    return 0;
  };
}
