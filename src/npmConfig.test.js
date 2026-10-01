import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadNpmConfig,
  registryBaseFor,
  encodePackageName,
  authHeaderFor,
} from "./npmConfig.js";

const tmpDirs = [];
function makeTmp() {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "depreport-")),
  );
  tmpDirs.push(dir);
  return dir;
}

const savedEnv = { HOME: process.env.HOME, MY_TOKEN: process.env.MY_TOKEN };

afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
  process.env.HOME = savedEnv.HOME;
  process.env.MY_TOKEN = savedEnv.MY_TOKEN;
});

// Point os.homedir() at an empty temp dir so a developer's real ~/.npmrc
// cannot leak into these assertions.
function isolateHome() {
  process.env.HOME = makeTmp();
}

test("registryBaseFor: uses a scoped registry when one is configured", () => {
  const config = {
    defaultRegistry: "https://default.example/",
    scopeRegistries: new Map([["@scope", "https://scope.example/"]]),
    authEntries: new Map(),
  };
  assert.equal(registryBaseFor("@scope/pkg", config), "https://scope.example/");
  assert.equal(
    registryBaseFor("@other/pkg", config),
    "https://default.example/",
  );
  assert.equal(registryBaseFor("plain", config), "https://default.example/");
});

test("encodePackageName: percent-encodes the scope slash only", () => {
  assert.equal(encodePackageName("@scope/pkg"), "@scope%2fpkg");
  assert.equal(encodePackageName("plain"), "plain");
  assert.equal(encodePackageName("@scope/nested/path"), "@scope%2fnested/path");
});

test("authHeaderFor: builds Bearer, Basic, and username/password headers", () => {
  const encodedPw = Buffer.from("pw").toString("base64");
  const config = {
    defaultRegistry: "",
    scopeRegistries: new Map(),
    authEntries: new Map([
      ["//token.example/", { _authToken: "tok" }],
      ["//basic.example/", { _auth: "YWJj" }],
      ["//user.example/", { username: "user", _password: encodedPw }],
    ]),
  };
  assert.equal(authHeaderFor("https://token.example/", config), "Bearer tok");
  assert.equal(authHeaderFor("https://basic.example/", config), "Basic YWJj");
  assert.equal(
    authHeaderFor("https://user.example/", config),
    `Basic ${Buffer.from("user:pw").toString("base64")}`,
  );
});

test("authHeaderFor: matches a host-root entry from a deeper registry path", () => {
  const config = {
    defaultRegistry: "",
    scopeRegistries: new Map(),
    authEntries: new Map([["//host.example/", { _authToken: "tok" }]]),
  };
  assert.equal(
    authHeaderFor("https://host.example/deep/path/", config),
    "Bearer tok",
  );
});

test("authHeaderFor: returns null with no match or an invalid registry URL", () => {
  const config = {
    defaultRegistry: "",
    scopeRegistries: new Map(),
    authEntries: new Map([["//host.example/", { _authToken: "tok" }]]),
  };
  assert.equal(authHeaderFor("https://other.example/", config), null);
  assert.equal(authHeaderFor("not a url", config), null);
});

test("loadNpmConfig: defaults to the public registry when no .npmrc exists", () => {
  isolateHome();
  const root = makeTmp();
  const config = loadNpmConfig(root, root);
  assert.equal(config.defaultRegistry, "https://registry.npmjs.org/");
  assert.equal(config.scopeRegistries.size, 0);
  assert.equal(config.authEntries.size, 0);
});

test("loadNpmConfig: merges the project chain with startDir winning, and expands env", () => {
  isolateHome();
  process.env.MY_TOKEN = "sekret";
  const repoRoot = makeTmp();
  const startDir = path.join(repoRoot, "sub");
  fs.mkdirSync(startDir);

  fs.writeFileSync(
    path.join(repoRoot, ".npmrc"),
    [
      "registry=https://root.example/",
      "//root.example/:_authToken=ROOTTOKEN",
      '@scope:registry="https://scope.example/"',
      "# a comment line",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(startDir, ".npmrc"),
    [
      "registry=https://sub.example/",
      "//sub.example/:_authToken=${MY_TOKEN}",
    ].join("\n"),
  );

  const config = loadNpmConfig(startDir, repoRoot);
  // startDir (closest to cwd) wins over the repo root.
  assert.equal(config.defaultRegistry, "https://sub.example/");
  // Quotes are stripped from values.
  assert.equal(config.scopeRegistries.get("@scope"), "https://scope.example/");
  // Both auth entries survive; ${MY_TOKEN} is expanded from the environment.
  assert.deepEqual(config.authEntries.get("//root.example/"), {
    _authToken: "ROOTTOKEN",
  });
  assert.deepEqual(config.authEntries.get("//sub.example/"), {
    _authToken: "sekret",
  });
});
