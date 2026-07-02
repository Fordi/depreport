import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_REGISTRY = "https://registry.npmjs.org/";
const AUTH_FIELDS = ["_authToken", "_auth", "username", "_password"];

// Expand ${VAR} references the way npm does, so tokens can live in the
// environment (e.g. //host/:_authToken=${NPM_TOKEN}) rather than on disk.
function expandEnv(value) {
  return value.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? "");
}

// Minimal ini parse: `key = value`, `#`/`;` comments, optional quotes.
// Sections are ignored (npm registry/auth keys are flat).
function parseNpmrc(contents, config) {
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    if (line.startsWith("[") && line.endsWith("]")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) config[key] = expandEnv(value);
  }
}

// Load and merge .npmrc from ~/.npmrc (lowest precedence) then the project
// chain from repoRoot down to startDir (closest to cwd wins), mirroring how
// npm resolves user + project config.
export function loadNpmConfig(startDir, repoRoot) {
  const files = [path.join(os.homedir(), ".npmrc")];
  const chain = [];
  let dir = startDir;
  while (true) {
    chain.push(path.join(dir, ".npmrc"));
    if (dir === repoRoot || dir === path.dirname(dir)) break;
    dir = path.dirname(dir);
  }
  files.push(...chain.reverse());

  const config = {};
  for (const file of files) {
    try {
      parseNpmrc(fs.readFileSync(file, "utf8"), config);
    } catch {
      // Missing/unreadable .npmrc is fine; fall back to defaults.
    }
  }

  const defaultRegistry = config.registry || DEFAULT_REGISTRY;
  const scopeRegistries = new Map();
  const authEntries = new Map();
  for (const [key, value] of Object.entries(config)) {
    const scopeMatch = key.match(/^(@[^:]+):registry$/);
    if (scopeMatch) {
      scopeRegistries.set(scopeMatch[1], value);
      continue;
    }
    for (const field of AUTH_FIELDS) {
      if (key.endsWith(`:${field}`) && key.startsWith("//")) {
        const dart = key.slice(0, -(field.length + 1));
        const entry = authEntries.get(dart) || {};
        entry[field] = value;
        authEntries.set(dart, entry);
        break;
      }
    }
  }
  return { defaultRegistry, scopeRegistries, authEntries };
}

export function registryBaseFor(packageName, npmConfig) {
  if (packageName.startsWith("@")) {
    const scope = packageName.slice(0, packageName.indexOf("/"));
    const scoped = npmConfig.scopeRegistries.get(scope);
    if (scoped) return scoped;
  }
  return npmConfig.defaultRegistry;
}

// npm requests scoped packages as @scope%2fname (slash encoded, @ kept).
export function encodePackageName(packageName) {
  return packageName.startsWith("@")
    ? packageName.replace("/", "%2f")
    : packageName;
}

// Walk the registry URL's "nerf dart" from most specific path to the host
// root, returning the first matching auth entry (npm's matching rule).
function authEntryForRegistry(registryBase, npmConfig) {
  let url;
  try {
    url = new URL(registryBase);
  } catch {
    return null;
  }
  let pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  while (true) {
    const entry = npmConfig.authEntries.get(`//${url.host}${pathname}`);
    if (entry) return entry;
    if (pathname === "/") return null;
    pathname = pathname.replace(/[^/]+\/$/, "");
  }
}

export function authHeaderFor(registryBase, npmConfig) {
  const entry = authEntryForRegistry(registryBase, npmConfig);
  if (!entry) return null;
  if (entry._authToken) return `Bearer ${entry._authToken}`;
  if (entry._auth) return `Basic ${entry._auth}`;
  if (entry.username && entry._password) {
    const password = Buffer.from(entry._password, "base64").toString("utf8");
    const basic = Buffer.from(`${entry.username}:${password}`).toString(
      "base64",
    );
    return `Basic ${basic}`;
  }
  return null;
}
