import { parseArgs } from "node:util";

export const HELP_TEXT = [
  "Usage: depreport [options] [dir]",
  "",
  "  dir                 Directory to start from (default: '.')",
  "  -o, --output <file> Write the CSV report to <file> (default: stdout)",
  "  -h, --help          Show this help",
].join("\n");

/**
 * Parse depreport's command-line arguments.
 *
 * @param {string[]} argv Arguments without the `node` / script prefix (i.e.
 *   `process.argv.slice(2)`).
 * @returns {{ help: boolean, output: string | null, dir: string }} Normalized
 *   options: whether help was requested, the raw `--output` path (or null for
 *   stdout), and the starting directory (defaulting to ".").
 * @throws {TypeError} If an unknown option is passed or a value is missing.
 */
export function parseCliArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  return {
    help: Boolean(values.help),
    output: values.output ?? null,
    dir: positionals[0] || ".",
  };
}
