# Contributing

## Getting started

```bash
git clone https://github.com/Fordi/depreport
cd depreport
npm install
```

## Project structure

```
src/
  index.ts          # Public exports
  {module}.ts       # {module} implementation
  {module}.test.ts  # Tests for {module}
```

Source lives in `src/`.  Each module has a corresponding `.test.ts` file next to it.  Public API is re-exported from `src/index.ts`.

## Running tests

Tests use Node's built-in test runner (`node:test`) and `node:assert`:

```bash
npm test            # single run
npm run test:watch  # re-run on changes
npm run coverage    # Generate HTML coverage report (written to coverage/)
```

## Writing tests

Add a `<module>.test.ts` file alongside the source file. Follow the existing pattern:

```ts
import { myFunction } from "./myFunction.ts";
import { describe, it } from "node:test";
import assert from "node:assert";

describe("myFunction", () => {
  it("does the thing", async () => {
    const result = await myFunction();
    assert.strictEqual(result, expected);
  });
});
```

## Code style

The project uses ESLint and Prettier. Run the linter before submitting:

```bash
npm run neaten # fix any easy problems
npm run validate # check lint, format, and type constraints
```

## Adding a new utility

1. Create `src/<name>.ts` with your implementation.
2. Create `src/<name>.test.ts` with tests.
3. Re-export from `src/index.ts`.
4. Run `npm run neaten` to validate style and format
5. Run `npm run build` to make sure it builds
6. Run `npm test` to make sure everything passes.

## Cleaning up

You can clean this repository of coverage and build artifacts with the following:

```bash
npm run clean # cleans up artifacts
npm run clean -- -a # also cleans out dependencies
```

## License

By contributing you agree that your contributions will be licensed under the ISC license.
