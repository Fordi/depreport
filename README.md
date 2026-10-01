# @fordi-org/depreport

Generate a CSV report on your project's dependencies: what's installed, when it was published, how far behind the latest release it is, how large it is on disk (including its transitive closure), and how often you actually import it.

It works for single packages and for npm/yarn-style monorepos, reads private registry configuration from your `.npmrc`, and caches registry lookups on disk so repeated runs are fast.

## Requirements

- Node.js `>= 22.22.2`

## Installation

As a global CLI:

```bash
git clone https://github.com/Fordi/depreport
npm i -g ./depreport
```

As a project dependency (for the JavaScript API):

```bash
npm i -D github:Fordi/depreport
```

## CLI

```bash
depreport --help
```

<!--usage-->
Usage: `depreport [options] [dir]`

| Option                     | Description                                                           |
|----------------------------|-----------------------------------------------------------------------|
| `dir`                      | Directory to start from (default: `.`)                                |
| `-o` / `--output` {file}   | Write the report to {file} (default: stdout)                          |
| `-t` / `--types` {list}    | Dependency types to include, comma-separated[^1]; default: main, dev) |
| `-c` / `--columns` {list}  | Columns to emit, comma-separated and in order (default: all)          |
| `-s` / `--sort` {list}     | Sort order[^2]                                                        |
| `-f` / `--full`            | Keep the workspace/declared columns even in a single-package repo     |
| `-T` / `--transitive`      | Include transitive dependencies in report rows                        |
| `-O` / `--transitive-only` | Only include transitive dependencies                                  |
| `-F` / `--format {fmt}`    | Output format: csv, markdown, json, package[^3]; default: csv         |
| `-H` / `--hard`            | Upgrade aggressively[^4]                                              |
| `-q` / `--quiet`           | Suppress progress messages on stderr                                  |
| `-h` / `--help`            | Show this help                                                        |

[^1]: Dependency types:

    | Type     | Section              |
    |----------|----------------------|
    | main     | dependencies         |
    | dev      | devDependencies      |
    | peer     | peerDependencies     |
    | optional | optionalDependencies |

[^2]: column names, comma-separated, each optionally prefixed with + (ascending, the default) or - (descending). Use `--sort=-col` instead of `--sort col` when the list starts with - (default: -needsBump,published,-size)

[^3]: Output formats:

    | Format     | Description                               |
    |------------|-------------------------------------------|
    | `csv`      | the dependency report as CSV              |
    | `markdown` | the dependency report as a Markdown table |
    | `json`     | the report as JSON                        |
    | `package`  | an upgrade command per workspace          |

    For `package`, the package manager (`npm`/`yarn`/`pnpm`/`bun`) is autodetected

[^4]: `--hard` works like `--format=package`, but includes any dependency whose version doesn't match latest (not just in-range bumps), one dependency per line, pinned to latest instead of latestBump. Overrides `--format`
<!--/usage-->

The CSV report is written to **stdout**; all progress/diagnostic messages go to **stderr**, so you can safely pipe or redirect the report on its own:

```bash
depreport > report.csv
```

Pass `--quiet` (`-q`) to suppress the progress messages entirely (including the written-path echo from `--output`); errors are still reported on stderr.

`dir` may be anywhere inside a project — depreport walks up to the nearest
`package.json` and treats that directory as the project (or monorepo) root.

### Examples

```bash
# Report the current project to stdout
depreport

# Start from a subdirectory and write to a file
depreport ./packages/app -o report.csv

# Include peer and optional dependencies as well
depreport -t main,peer,optional

# Include transitive dependencies too
depreport --transitive

# Only transitive dependencies
depreport --transitive-only

# Emit only a subset of columns, in the order you specify
depreport -c name,version,latest,needsBump

# Sort by name; or descending size (the = form is required when the
# list starts with -, so it is not read as an option)
depreport -s name
depreport --sort=-size,name

# Emit the report as JSON instead of CSV
depreport --format json

# Print (and optionally run) upgrade command(s) for everything that
# needs an in-range bump
depreport --format package
depreport -F package | sh

# Same, but include out-of-range/breaking upgrades too, one per line
depreport --hard
```

### Sample output

```csv
name,requested,version,published,latest,latestBump,needsBump,size,uses,type
prettier,^3.8.3,3.8.4,2026-06-09T11:30:06.784Z,3.9.4,3.9.4,✓,8604556,0,dev
eslint-plugin-n,^18.2.0,18.2.0,2026-06-25T12:56:51.720Z,18.2.1,18.2.1,✓,3246830,1,dev
@types/node,^25.9.3,25.9.4,2026-06-19T07:15:05.196Z,26.1.0,25.9.4,,2508978,0,dev
```

This is a single-package repository, so the `workspace` and `declared` columns are vestigial (every row would say `{root}`/`root`) and are dropped. They appear automatically when the repo has workspaces; pass `--full` (API: `full: true`) to keep them regardless.

Fields are quoted only when they need it (values containing a comma or a double-quote); newlines within a value are flattened to spaces.

> **Note:** dependencies whose installed version already equals the version
> depreport would advise upgrading to (the `latest` column) are **omitted** —
> the report is a list of things that could move, not a full inventory.

## Columns

- `name`: Package name.
- `workspace`: `{root}` for the root package, otherwise the workspace package's name. Omitted in single-package repos.
- `requested`: The version range declared in the manifest (e.g. `^1.2.0`).
- `version`: The installed version (read from `node_modules`), falling back to the requested range if not installed.
- `published`: The registry publish timestamp of the installed `version`.
- `latest`: The version to upgrade to: the newer of the `latest` dist-tag and the newest in-range published release.
- `latestBump`: The highest **stable** published version that still satisfies `requested` (an in-range upgrade).
- `needsBump`: `✓` when the installed version is behind `latestBump`, `?` when that cannot be determined, else empty.
- `size`: Transitive on-disk size, in bytes, of the installed package and its dependency closure.
- `uses`: Number of `import`/`require`/dynamic-`import` references to the package found in the workspace's source.
- `declared`: `root` if from the root manifest, `subproject` if from a workspace's own, `transitive` if only reached through another dependency. Omitted in single-package repos.
- `type`: Which manifest section declared it: `main`, `dev`, `peer`, or `optional`.

Range handling for `latest`/`latestBump`/`needsBump` understands caret (`^`),
tilde (`~`), and exact versions; prereleases are excluded from upgrade suggestions.

In a repository without workspaces, `workspace` and `declared` carry no information, so both the row objects and the CSV omit them unless `--full`
(API: `full: true`) is given, or (API only) you supply your own extractor for one of them.

## Dependency types

`--types` (API: `types`) chooses which manifest sections to read, mapping:

| type       | manifest section       |
| ---------- | ---------------------- |
| `main`     | `dependencies`         |
| `dev`      | `devDependencies`      |
| `peer`     | `peerDependencies`     |
| `optional` | `optionalDependencies` |

The default is `main,dev`. When a package appears in more than one selected section, the canonical order above wins (so a package in both `dependencies`
and `devDependencies` reports as `main`).

## Sort order

`--sort` (API: `sort`) is a list of column names, each optionally prefixed with
`+` (ascending, the default when unprefixed) or `-` (descending); later keys break ties left by earlier ones. The default, `-needsBump,published,-size`,
puts the rows needing an in-range bump first, oldest publish date first among those, and largest install size first as the final discriminator.

Cells with no value (for example `published` when the registry document is missing) sort **last** regardless of direction, and any rows the spec leaves tied are ordered by `workspace` then `name` so output is deterministic.

## Output formats

`--format` (`-F`) selects what depreport prints, in place of the CSV report:

- `csv` (default) — the dependency report as CSV, as described above.
- `markdown` — the report as a GitHub-flavored Markdown table, with the columns padded so it reads well as plain text. Values are formatted as in CSV (pipes escaped, newlines flattened). Because wide tables are hard to read, only `workspace`, `type`, `requested`, `name`, `version` and `latestBump` are shown (those present on the rows) unless you choose columns with `--columns`. `--sort` applies as usual. When there are no rows to show, it prints `All packages are up-to-date` instead of an empty table.
- `json` — `JSON.stringify(rows, null, 2)`: the same row objects the JavaScript API returns, so `published` is an ISO string and `workspace: undefined` fields are simply absent from the output (JSON has no `undefined`). For speed, the CLI skips `size` calculation in this format.
- `package` — one or more shell commands that upgrade every dependency with `needsBump: true`, pinned to `latestBump` with the same `^`/`~` leader as the manifest's `requested` range (so `^1.2.0` stays a caret range, not an exact pin). There is one command per location, using the package manager's upgrade verb: `yarn upgrade`, `pnpm update`, `bun update`, and `npm install` for npm (which has no verb that moves a range). A dependency declared by a workspace's own manifest gets a command scoped to that workspace (`--workspace=<name>` for npm, `yarn workspace <name> upgrade ...`, `--filter <name>` for pnpm/bun); a dependency declared at the root — even if only reported because a workspace uses it — is upgraded once at the root. Upgrading keeps each dependency in its existing manifest section, so dev/peer/optional dependencies share their location's command. For speed, the CLI skips `size` calculation in this format. `--columns` and `--sort` are ignored for `json`/`package` (there's nothing to select or order).

In the `csv` and `markdown` table reports, when `needsBump` isn't among the columns being shown, rows whose `needsBump` is falsy are skipped: `false` (already at the newest in-range version), unknown (`?`), or missing. That makes the Markdown default a list of what needs bumping.

Rows with `declared: transitive` aren't direct dependencies, so they're never added to a manifest. Instead they're batched into one root command that refreshes them by name within the ranges their parents already allow: `npm update <names>`, `yarn upgrade <names>`, `pnpm update --depth Infinity <names>`, or `bun update <names>`. Only the lockfile changes, and a transitive dependency whose newest version is outside its parents' ranges can't be moved this way. `--hard` skips transitive rows for that reason.

```bash
depreport --format package
```

```plain
npm install chalk@^5.4.1 eslint@^9.1.0
npm install lodash@^4.17.21 --workspace=api
```

The package manager is detected from the lockfile at the repo root (`package-lock.json`/`npm-shrinkwrap.json` → npm, `yarn.lock` → yarn, `pnpm-lock.yaml` → pnpm, `bun.lockb`/`bun.lock` → bun; npm is the default when none is found).

This can be piped directly into bash, for a fast upgrade:

```bash
depreport --format package | bash
```

`--hard` (`-H`) is a variant of `package` format for riskier upgrades: instead of only rows with `needsBump: true` batched into one command per location, it includes **every** row whose installed version doesn't match `latest` — including bumps that fall outside the declared range (e.g. already at the newest `1.x` release under `^1.0.0`, but `2.0.0` is out) — pinned to `latest` rather than `latestBump`, and emitted **one command per dependency** rather than batched, so each can be reviewed or run independently. `--hard` overrides `--format` (it doesn't make sense combined with `csv`/`markdown`/`json`). Transitive rows are skipped, since they can only be refreshed within their parents' ranges.

```bash
depreport --hard
```

```plain
npm install @types/node@^26.1.0
npm install chalk@^5.4.1 --workspace=api
```

## Monorepos / workspaces

If the root `package.json` has a `workspaces` array, each workspace manifest is read and reported under its own `workspace` label. Workspace packages themselves are treated as internal and never reported as dependencies. A root-level dependency is additionally attributed to a workspace when that workspace's source actually imports it (tracked in `uses`), and is labelled `declared: root` there.

> **Note:** `workspaces` entries are resolved as **literal paths**; glob
> patterns like `packages/*` are not expanded. List explicit directories
> (e.g. `["packages/app", "packages/lib"]`) for them to be picked up.

## JavaScript API

```javascript
import { depreport } from "@fordi-org/depreport";

const rows = await depreport({
  dir: "./my-project",
  types: ["main", "dev"], // default
  sort: ["-needsBump", "published", "-size"], // default
  full: false, // default: drop workspace/declared in single-package repos
  transitive: false, // default: only direct dependencies
  transitiveOnly: false, // default
  includeSize: true, // default
  log: (message) => process.stderr.write(`${message}\n`),
});

console.log(rows);
```

`depreport(options)` returns a `Promise<Array<object>>` — one object per row, ordered per `sort` — where each object has the built-in columns described above (plus any custom columns you add). Rows carry rich values; the CSV layer formats them for display:

```javascript
[
  {
    name: "@types/node",
    requested: "^25.9.3",
    version: "25.9.4",
    published: new Date("2026-06-19T07:15:05.196Z"), // ISO string in the CSV
    latest: "26.1.0",
    latestBump: "25.9.4",
    needsBump: false, // "✓" / "" / "?" (true / false / null) in the CSV
    size: 2508978,
    uses: 0,
    type: "dev",
  },
];
```

In a repo with workspaces (or with `full: true`), rows additionally carry
`workspace` (the workspace package's name, or `undefined` for the root —
rendered `{root}` in the CSV) and `declared` (`"root"` | `"subproject"` |
`"transitive"`).

### Options

- `dir` (`string`, default `"."`) any path inside the project; the report is built for its root.
- `types` (`("main"|"dev"|"peer"|"optional")[]`, default `["main","dev"]`) which manifest sections to include.
- `columns` (`Record<string, ColumnExtractor>`, default `{}`) extra columns, merged on top of the built-ins (see below).
- `sort` (`` `${"+"|"-"|""}${column}`[] ``, default `["-needsBump","published","-size"]`) row ordering (see "Sort order" above).
- `full` (`boolean`, default `false`) keep `workspace`/`declared` even in a single-package repo.
- `transitive` (`boolean`, default `false`) include transitive dependencies reached from selected direct dependencies.
- `transitiveOnly` (`boolean`, default `false`) only report transitive dependencies.
- `includeSize` (`boolean`, default `true`) include built-in `size`; set `false` to skip expensive transitive size traversal.
- `log` (`(message: string) => void`, default no-op) sink for progress messages (repo root, manifests, workspaces).

### Custom columns

Every built-in column is itself an extractor following one contract, and you can add your own the same way:

```typescript
type ColumnExtractor = (
  metadata,
  context,
) =>
  | string
  | number
  | boolean
  | null
  | Promise<string | number | boolean | null>;
```

- **`metadata`** — the package's npm registry document, `{ time, latest, versions }`, or `null` if it could not be fetched. (Registry lookups are warmed up front and served from cache, so reading `metadata` is cheap.)
- **`context`** — the dependency being reported:

  ```javascript
  {
    name,        // package name
    workspace,   // workspace package name, or undefined for the root
    requested,   // declared version range
    version,     // installed (or declared) version
    declared,    // "root" | "subproject" | "transitive"
    type,        // "main" | "dev" | "peer" | "optional"
    uses,        // import count in the workspace's source
    packageDir,  // resolved install directory, or null
    repoRoot,    // project root
    npmConfig,   // resolved npm/registry config
  }
  ```

A key that matches a built-in column replaces it.

```javascript
import { depreport } from "@fordi-org/depreport";

const rows = await depreport({
  dir: ".",
  columns: {
    // Add a column combining context and metadata.
    tagline: (metadata, context) =>
      `${context.name}@${metadata?.latest ?? "?"}`,
    // Override a built-in: report size in KiB instead of bytes.
    size: async (metadata, context) => {
      const { getTransitivePackageSize } =
        await import("@fordi-org/depreport/src/packageSize.js");
      if (!context.packageDir) return 0;
      const bytes = await getTransitivePackageSize(
        context.packageDir,
        context.repoRoot,
      );
      return Math.round(bytes / 1024);
    },
  },
});
```

To render your own rows as CSV (including custom columns, in your own order):

```javascript
import { toCsv } from "@fordi-org/depreport";

const csv = toCsv(rows, ["name", "version", "latest", "tagline"]);
```

Without an explicit column list, `toCsv(rows)` emits the built-in report columns that are actually present on the rows (so vestigial columns depreport dropped stay dropped), or the full set when `rows` is empty.

`toMarkdown(rows, columns?)` takes the same arguments and renders a Markdown table. Without a column list it uses the narrower Markdown default set (`MARKDOWN_DEFAULT_COLUMNS` in `src/columns.js`):

```javascript
import { toMarkdown } from "@fordi-org/depreport";

const table = toMarkdown(rows, ["name", "version", "latest"]);
```

## Registry configuration

depreport resolves the registry and authentication the way npm does, reading
`~/.npmrc` and then the project's `.npmrc` chain (from the repo root down to the starting directory, closest wins). It honors:

- `registry` and scoped `@scope:registry` entries
- auth entries: `_authToken`, `_auth`, and `username` / `_password`
- `${ENV_VAR}` expansion in values (e.g. `//registry.example/:_authToken=${NPM_TOKEN}`)

## Caching & environment variables

Registry metadata is cached on disk between runs.

| Variable                | Default                       | Effect                                                          |
| ----------------------- | ----------------------------- | --------------------------------------------------------------- |
| `XDG_CACHE_HOME`        | `~/.cache`                    | Base directory for the cache (stored under `depreport/`).       |
| `DEPREPORT_CACHE_TTL`   | `21600` (6 hours), in seconds | How long cached registry documents stay fresh.                  |
| `DEPREPORT_CONCURRENCY` | number of CPUs minus one      | Maximum parallel registry requests during the warm-up prefetch. |

## License

ISC
