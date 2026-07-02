import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";

import {
  registryBaseFor,
  encodePackageName,
  authHeaderFor,
} from "./npmConfig.js";
import { maxSatisfying } from "./version.js";

const npmMetadataCache = new Map();

const CACHE_DIR = path.join(
  process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
  "depreport",
);
const CACHE_TTL_MS = process.env.DEPREPORT_CACHE_TTL
  ? Number(process.env.DEPREPORT_CACHE_TTL) * 1000
  : 6 * 60 * 60 * 1000;

const FETCH_CONCURRENCY = process.env.DEPREPORT_CONCURRENCY
  ? Number(process.env.DEPREPORT_CONCURRENCY)
  : os.cpus().length - 1;

function cachePathFor(packageName) {
  const hash = crypto.createHash("sha1").update(packageName).digest("hex");
  return path.join(CACHE_DIR, `${hash}.json`);
}

function readDiskCache(packageName) {
  try {
    const file = cachePathFor(packageName);
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function writeDiskCache(packageName, payload) {
  (async () => {
    try {
      await fsPromises.mkdir(CACHE_DIR, { recursive: true });
      await fsPromises.writeFile(
        cachePathFor(packageName),
        JSON.stringify(payload),
        "utf8",
      );
    } catch {
      // Cache writes are best-effort; ignore failures.
    }
  })();
}

async function fetchFromRegistry(packageName, npmConfig) {
  const registryBase = registryBaseFor(packageName, npmConfig).replace(
    /\/+$/,
    "",
  );
  const url = `${registryBase}/${encodePackageName(packageName)}`;
  const headers = { Accept: "application/json" };
  const authHeader = authHeaderFor(registryBase, npmConfig);
  if (authHeader) headers.Authorization = authHeader;
  const response = await fetch(url, { headers });
  if (!response.ok) return null;
  const payload = await response.json();
  // Keep only the fields we consume; the full registry document can be
  // megabytes per package, which we neither need nor want to cache.
  return {
    time: payload.time || {},
    latest: payload["dist-tags"]?.latest || "",
    versions: payload.versions ? Object.keys(payload.versions) : [],
  };
}

export async function fetchNpmMetadata(packageName, npmConfig) {
  if (!packageName) return null;
  if (npmMetadataCache.has(packageName)) {
    return npmMetadataCache.get(packageName);
  }
  const cached = readDiskCache(packageName);
  if (cached !== undefined) {
    npmMetadataCache.set(packageName, cached);
    return cached;
  }
  let result;
  try {
    result = await fetchFromRegistry(packageName, npmConfig);
  } catch {
    /* */
  }
  if (result) {
    writeDiskCache(packageName, result);
  }
  // Cache negatives in-memory too, so one failure doesn't trigger repeated
  // refetches within a single run.
  npmMetadataCache.set(packageName, result);
  return result;
}

// Warm the caches for every package up front, in parallel with a bounded
// pool, so the per-row lookups below all resolve from memory instead of
// serializing one network round-trip at a time.
export async function prefetchMetadata(packageNames, npmConfig) {
  const queue = [...new Set(packageNames)];
  const workers = Array.from(
    { length: Math.min(FETCH_CONCURRENCY, queue.length) },
    async () => {
      while (queue.length) {
        await fetchNpmMetadata(queue.pop(), npmConfig);
      }
    },
  );
  await Promise.all(workers);
}

export async function fetchPublishedAt(packageName, version, npmConfig) {
  if (!packageName || !version) return "";
  if (
    version.startsWith("file:") ||
    version.startsWith("link:") ||
    version.startsWith("workspace:") ||
    version.startsWith("http")
  ) {
    return "";
  }
  const payload = await fetchNpmMetadata(packageName, npmConfig);
  if (!payload || !payload.time) return "";
  return payload.time[version] || "";
}

export async function fetchLatestVersion(packageName, npmConfig) {
  const payload = await fetchNpmMetadata(packageName, npmConfig);
  if (!payload) return "";
  return payload.latest || "";
}

export async function fetchLatestCompatibleVersion(
  packageName,
  range,
  npmConfig,
) {
  const payload = await fetchNpmMetadata(packageName, npmConfig);
  return payload ? maxSatisfying(payload.versions, range) : "";
}
