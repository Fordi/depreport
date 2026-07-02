// Minimal semver handling: just enough to parse `major.minor.patch`, compare
// releases, and evaluate caret/tilde ranges. Not a full semver implementation.

export function parseVersion(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(
    /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:[-+].*)?$/,
  );
  return match
    ? [
        Number(match.groups.major),
        Number(match.groups.minor),
        Number(match.groups.patch),
      ]
    : null;
}

export function isStableVersion(value) {
  return typeof value === "string" && !/[-+]/.test(value.trim());
}

export function compareVersions(left, right) {
  if (!left || !right) return 0;
  const [leftMajor, leftMinor, leftPatch] = left;
  const [rightMajor, rightMinor, rightPatch] = right;
  if (leftMajor !== rightMajor) return leftMajor - rightMajor;
  if (leftMinor !== rightMinor) return leftMinor - rightMinor;
  return leftPatch - rightPatch;
}

// Exclusive upper bound of a caret range, anchored on the leftmost non-zero
// component (npm semantics): ^1.2.3 -> <2.0.0, ^0.2.3 -> <0.3.0,
// ^0.0.3 -> <0.0.4.
function caretUpperBound([major, minor, patch]) {
  if (major > 0) return [major + 1, 0, 0];
  if (minor > 0) return [0, minor + 1, 0];
  return [0, 0, patch + 1];
}

// Exclusive upper bound of a tilde range: ~1.2.3 -> <1.3.0 (patch-level
// changes only, once minor is fixed).
function tildeUpperBound([major, minor]) {
  return [major, minor + 1, 0];
}

export function satisfiesCaret(candidateVersion, baseVersion) {
  const candidate = parseVersion(candidateVersion);
  const base = parseVersion(baseVersion);
  if (!candidate || !base) return false;
  return (
    compareVersions(candidate, base) >= 0 &&
    compareVersions(candidate, caretUpperBound(base)) < 0
  );
}

export function satisfiesTilde(candidateVersion, baseVersion) {
  const candidate = parseVersion(candidateVersion);
  const base = parseVersion(baseVersion);
  if (!candidate || !base) return false;
  return (
    compareVersions(candidate, base) >= 0 &&
    compareVersions(candidate, tildeUpperBound(base)) < 0
  );
}

// Evaluate a manifest range specifier against a concrete version. Supports the
// operators that dominate package.json: `^` (caret), `~` (tilde), and a bare
// version (exact match). Anything else (complex ranges, tags, `file:`/
// `workspace:` specifiers, etc.) matches nothing.
export function satisfiesRange(candidateVersion, rangeSpec) {
  if (typeof rangeSpec !== "string") return false;
  const trimmed = rangeSpec.trim();
  if (trimmed.startsWith("^")) {
    return satisfiesCaret(candidateVersion, trimmed.slice(1));
  }
  if (trimmed.startsWith("~")) {
    return satisfiesTilde(candidateVersion, trimmed.slice(1));
  }
  const candidate = parseVersion(candidateVersion);
  const base = parseVersion(trimmed);
  if (!candidate || !base) return false;
  return compareVersions(candidate, base) === 0;
}
