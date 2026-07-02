# @fordi-org/depreport



## Installation

```bash
npm install @fordi-org/depreport
```



## API

### `delay(ms, abort?)`

Returns a promise that resolves with `undefined` after `ms` milliseconds.

```ts
import { delay } from "@fordi-org/promises";

await delay(1000); // wait one second
```

#### Cancellation via AbortSignal / AbortController

Pass an `AbortSignal` or `AbortController` to cancel the delay early.  If
aborted with a reason, the promise rejects with that reason.  If aborted
without a reason, the promise resolves with `undefined`.

```ts
const controller = new AbortController();

// Rejects with the given Error after 50ms
setTimeout(() => controller.abort(new Error("too slow")), 50);
try {
  await delay(5000, controller);
} catch (err) {
  console.log(err.message); // "too slow"
}

// Resolves early (no rejection) when aborted without a reason
setTimeout(() => controller.abort(), 50);
await delay(5000, controller.signal); // resolves after ~50ms
```

#### `delay.abortAll(reason?)`

Abort every in-flight `delay` at once.  Like per-signal abort, omitting the
reason resolves them; providing one rejects them.

```ts
const a = delay(10000);
const b = delay(20000);

delay.abortAll(); // both resolve immediately
```

### `asyncMap(iterable, callback, options?)`

Maps over an iterable or async iterable, running `callback` for each element
and returning an array of results in iteration order (not completion order).

```ts
import { asyncMap } from "@fordi-org/promises";

const results = await asyncMap([1, 2, 3], async (n) => n * 2);
// [2, 4, 6]
```

#### Concurrency control

Limit how many callbacks run in parallel with the `concurrency` option:

```ts
await asyncMap(urls, fetchData, { concurrency: 5 });
```

#### Cancellation via AbortSignal / AbortController

Pass an `AbortSignal` or `AbortController` via the `abort` option to stop
iteration early.  When aborted without a reason, `asyncMap` returns partial
results collected so far.  When aborted with a reason, it rejects with that
reason.  In both cases, any in-flight callbacks are allowed to settle before
`asyncMap` resolves or rejects.

```ts
const controller = new AbortController();

// Resolve with partial results
setTimeout(() => controller.abort(), 100);
const partial = await asyncMap(largeList, slowFn, { abort: controller });

// Reject with a reason
setTimeout(() => controller.abort(new Error("timeout")), 100);
try {
  await asyncMap(largeList, slowFn, { abort: controller.signal });
} catch (err) {
  console.log(err.message); // "timeout"
}
```

### `getAbortReason(...sources)`

Inspects one or more abort-related objects and returns a disposition object
indicating whether the caller should resolve, reject, or continue.

Accepts any combination of `AbortSignal`, `AbortController`, `CustomEvent`
(from `delay.abortAll`), or falsy values.  Returns:

- `{ resolve: true }` — aborted without a reason (or with the default
  `AbortError`); the caller should resolve / return early.
- `{ reject: reason }` — aborted with an explicit reason; the caller should
  reject / throw.
- `{}` — not aborted; the caller should continue.

```ts
import { getAbortReason } from "@fordi-org/promises";

function thingDoer(...) {
  // ...
  while (working) {
    const result = getAbortReason(signal);
    if (result.resolve) {
      break;
    } else if (result.reject) {
      throw result.reject;
    }
  }
  // ...
}
```

This is the same helper used internally by `delay` and `asyncMap` to
normalize abort handling.

#### Supported input types

- `Array<T>`
- `Iterable<T>`
- `AsyncIterable<T>`
- `Generator<T>`
- `AsyncGenerator<T>`
- `Promise<Iterable<T>>`

## Development

```bash
npm install
npm test
```

### Scripts

| Script | Description |
|---|---|
| `npm test` | Run tests with Node's built-in test runner |
| `npm run test:watch` | Run tests in watch mode |
| `npm run coverage` | Generate an HTML coverage report via c8 |

## License

ISC
