import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseVersion,
  isStableVersion,
  compareVersions,
  satisfiesCaret,
  satisfiesTilde,
  satisfiesRange,
} from "./version.js";

test("parseVersion: parses major.minor.patch into a numeric tuple", () => {
  assert.deepEqual(parseVersion("1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseVersion("10.20.30"), [10, 20, 30]);
});

test("parseVersion: trims surrounding whitespace", () => {
  assert.deepEqual(parseVersion("  1.2.3  "), [1, 2, 3]);
});

test("parseVersion: ignores prerelease and build metadata", () => {
  assert.deepEqual(parseVersion("1.2.3-beta.1"), [1, 2, 3]);
  assert.deepEqual(parseVersion("1.2.3+build.7"), [1, 2, 3]);
});

test("parseVersion: returns null for non-versions", () => {
  assert.equal(parseVersion("1.2"), null);
  assert.equal(parseVersion("v1.2.3"), null);
  assert.equal(parseVersion("^1.2.3"), null);
  assert.equal(parseVersion(""), null);
  assert.equal(parseVersion("   "), null);
  assert.equal(parseVersion(null), null);
  assert.equal(parseVersion(42), null);
});

test("isStableVersion: true only for versions without prerelease/build", () => {
  assert.equal(isStableVersion("1.2.3"), true);
  assert.equal(isStableVersion("  1.2.3  "), true);
  assert.equal(isStableVersion("1.2.3-rc.1"), false);
  assert.equal(isStableVersion("1.2.3+build"), false);
  assert.equal(isStableVersion(null), false);
});

test("compareVersions: orders by major, then minor, then patch", () => {
  assert.equal(compareVersions([1, 0, 0], [1, 0, 0]), 0);
  assert.ok(compareVersions([1, 0, 0], [2, 0, 0]) < 0);
  assert.ok(compareVersions([2, 0, 0], [1, 9, 9]) > 0);
  assert.ok(compareVersions([1, 1, 0], [1, 2, 0]) < 0);
  assert.ok(compareVersions([1, 2, 5], [1, 2, 3]) > 0);
});

test("compareVersions: treats missing operands as equal", () => {
  assert.equal(compareVersions(null, [1, 0, 0]), 0);
  assert.equal(compareVersions([1, 0, 0], null), 0);
});

test("satisfiesCaret: for major>=1, same major and at or above base (<next major)", () => {
  assert.equal(satisfiesCaret("1.2.0", "1.2.0"), true);
  assert.equal(satisfiesCaret("1.5.9", "1.2.0"), true);
  assert.equal(satisfiesCaret("1.2.2", "1.2.3"), false); // below base patch
  assert.equal(satisfiesCaret("1.1.0", "1.2.0"), false);
  assert.equal(satisfiesCaret("2.0.0", "1.2.0"), false);
});

test("satisfiesCaret: for 0.minor.x, locks minor and requires >= base (<next minor)", () => {
  assert.equal(satisfiesCaret("0.2.5", "0.2.3"), true);
  assert.equal(satisfiesCaret("0.2.2", "0.2.3"), false);
  assert.equal(satisfiesCaret("0.3.0", "0.2.3"), false);
  assert.equal(satisfiesCaret("1.0.0", "0.2.3"), false);
});

test("satisfiesCaret: for 0.0.patch, matches only that exact patch", () => {
  assert.equal(satisfiesCaret("0.0.3", "0.0.3"), true);
  assert.equal(satisfiesCaret("0.0.4", "0.0.3"), false);
  assert.equal(satisfiesCaret("0.0.2", "0.0.3"), false);
  assert.equal(satisfiesCaret("0.1.0", "0.0.3"), false);
});

test("satisfiesCaret: false when either version is unparseable", () => {
  assert.equal(satisfiesCaret("not-a-version", "1.2.0"), false);
  assert.equal(satisfiesCaret("1.2.0", "not-a-version"), false);
});

test("satisfiesTilde: locks major and minor, allows patch at or above base", () => {
  assert.equal(satisfiesTilde("1.2.3", "1.2.3"), true);
  assert.equal(satisfiesTilde("1.2.9", "1.2.3"), true);
  assert.equal(satisfiesTilde("1.2.2", "1.2.3"), false); // below base patch
  assert.equal(satisfiesTilde("1.3.0", "1.2.3"), false); // next minor
  assert.equal(satisfiesTilde("2.2.3", "1.2.3"), false); // next major
  assert.equal(satisfiesTilde("1.2.3", "not-a-version"), false);
});

test("satisfiesRange: dispatches on the ^, ~, or bare-version operator", () => {
  assert.equal(satisfiesRange("1.5.0", "^1.2.0"), true);
  assert.equal(satisfiesRange("2.0.0", "^1.2.0"), false);
  assert.equal(satisfiesRange("1.2.9", "~1.2.3"), true);
  assert.equal(satisfiesRange("1.3.0", "~1.2.3"), false);
  assert.equal(satisfiesRange("1.2.3", "1.2.3"), true); // exact
  assert.equal(satisfiesRange("1.2.4", "1.2.3"), false); // exact mismatch
});

test("satisfiesRange: unsupported specifiers match nothing", () => {
  assert.equal(satisfiesRange("1.2.3", "*"), false);
  assert.equal(satisfiesRange("1.2.3", "latest"), false);
  assert.equal(satisfiesRange("1.2.3", "workspace:*"), false);
  assert.equal(satisfiesRange("1.2.3", null), false);
});
