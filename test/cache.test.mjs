import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { impactContextMarks, markContextFiles, refreshContextMarks } from "../dist/context-marks.js";
import { clearAceCache, generateGraphContext, getAceCacheStatus } from "../dist/graph.js";

const thisFile = fileURLToPath(import.meta.url);
const testDir = path.dirname(thisFile);
const cliPath = path.join(testDir, "..", "dist", "cli.js");

async function createTempRepo(t) {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "ace-cache-"));
  t.after(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(repoDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(repoDir, "package.json"),
    JSON.stringify({ name: "ace-cache-fixture", version: "0.0.0", type: "module" }, null, 2),
    "utf8"
  );

  await fs.writeFile(
    path.join(repoDir, "src", "a.ts"),
    'import { b } from "./b";\n\nexport function a() {\n  return b();\n}\n',
    "utf8"
  );
  await fs.writeFile(
    path.join(repoDir, "src", "b.ts"),
    'export function b() {\n  return "b";\n}\n',
    "utf8"
  );

  return repoDir;
}

function runCli(repoDir, args) {
  return execFileSync("node", [cliPath, ...args], {
    cwd: repoDir,
    encoding: "utf8"
  });
}

test("first run creates ACE Cache", async (t) => {
  const repoDir = await createTempRepo(t);
  const result = await generateGraphContext(repoDir);
  const raw = await fs.readFile(result.cachePath, "utf8");
  const cache = JSON.parse(raw);
  assert.equal(cache.version, 1);
  assert.ok(cache.files["src/a.ts"]);
  assert.ok(cache.files["src/b.ts"]);
});

test("second run reuses cache for unchanged files", async (t) => {
  const repoDir = await createTempRepo(t);
  await generateGraphContext(repoDir);
  const second = await generateGraphContext(repoDir);
  assert.equal(second.stats.extractedFiles, 0);
  assert.equal(second.stats.cache.changed, 0);
  assert.equal(second.stats.cache.unchanged, second.stats.cache.trackedFiles);
});

test("changed file is reprocessed while unchanged is skipped", async (t) => {
  const repoDir = await createTempRepo(t);
  await generateGraphContext(repoDir);

  await fs.writeFile(
    path.join(repoDir, "src", "b.ts"),
    'export function b() {\n  return "b2";\n}\n\nexport const c = 1;\n',
    "utf8"
  );

  const next = await generateGraphContext(repoDir);
  assert.equal(next.stats.cache.changed, 1);
  assert.equal(next.stats.cache.unchanged, next.stats.cache.trackedFiles - 1);
  assert.equal(next.stats.extractedFiles, 1);
});

test("deleted file is removed from graph and cache", async (t) => {
  const repoDir = await createTempRepo(t);
  await generateGraphContext(repoDir);

  await fs.rm(path.join(repoDir, "src", "b.ts"));
  const next = await generateGraphContext(repoDir);
  assert.equal(next.stats.cache.deleted, 1);
  assert.ok(!next.graph.nodes.some((node) => node.path === "src/b.ts"));

  const raw = await fs.readFile(path.join(repoDir, ".awesome-context", "cache.json"), "utf8");
  const cache = JSON.parse(raw);
  assert.equal(cache.files["src/b.ts"], undefined);
});

test("added file is processed and cached", async (t) => {
  const repoDir = await createTempRepo(t);
  await generateGraphContext(repoDir);

  await fs.writeFile(path.join(repoDir, "src", "c.ts"), 'export const c = 1;\n', "utf8");
  const next = await generateGraphContext(repoDir);
  assert.equal(next.stats.cache.added, 1);
  assert.ok(next.graph.nodes.some((node) => node.path === "src/c.ts"));
});

test("cache clear removes cache file and status reflects cold state", async (t) => {
  const repoDir = await createTempRepo(t);
  await generateGraphContext(repoDir);
  const cleared = await clearAceCache(repoDir);
  assert.equal(cleared.removed, true);

  const status = await getAceCacheStatus(repoDir);
  assert.equal(status.added, status.trackedFiles);
  assert.equal(status.unchanged, 0);
});

test("corrupt cache rebuilds safely", async (t) => {
  const repoDir = await createTempRepo(t);
  await generateGraphContext(repoDir);

  await fs.writeFile(path.join(repoDir, ".awesome-context", "cache.json"), "{not-json", "utf8");
  const next = await generateGraphContext(repoDir);
  assert.equal(next.stats.cache.invalidated, true);
  assert.ok(next.stats.cache.reasons.includes("cache corrupt"));
});

test("context headers refresh only when stale", async (t) => {
  const repoDir = await createTempRepo(t);
  const first = await markContextFiles(repoDir);
  assert.ok(first.filesUpdated.length > 0);

  const second = await markContextFiles(repoDir);
  assert.equal(second.filesUpdated.length, 0);

  const sourcePath = path.join(repoDir, "src", "a.ts");
  const source = await fs.readFile(sourcePath, "utf8");
  await fs.writeFile(sourcePath, source.replace("related:", "related: stale-"), "utf8");

  const third = await markContextFiles(repoDir);
  assert.ok(third.filesUpdated.includes("src/a.ts"));
});

test("impact map updates after dependency changes", async (t) => {
  const repoDir = await createTempRepo(t);
  await refreshContextMarks(repoDir);

  let impact = await impactContextMarks(repoDir, "src/b.ts");
  assert.ok(impact.directConsumers.includes("src/a.ts"));

  await fs.writeFile(path.join(repoDir, "src", "a.ts"), 'export function a() {\n  return "no-dep";\n}\n', "utf8");
  await refreshContextMarks(repoDir);

  impact = await impactContextMarks(repoDir, "src/b.ts");
  assert.equal(impact.directConsumers.includes("src/a.ts"), false);
});

test("cache commands work via CLI", async (t) => {
  const repoDir = await createTempRepo(t);
  runCli(repoDir, ["graph"]);

  const statusOut = runCli(repoDir, ["cache:status"]);
  assert.match(statusOut, /ACE Cache Status/i);

  const clearOut = runCli(repoDir, ["cache:clear"]);
  assert.match(clearOut, /ACE Cache cleared|already clear/i);
});
