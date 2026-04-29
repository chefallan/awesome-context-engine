import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  addMemory,
  buildMemoryContext,
  forgetMemory,
  listMemory,
  pruneMemory,
  searchMemory,
  summarizeMemory
} from "../dist/memory.js";
import { initProject } from "../dist/init.js";

const thisFile = fileURLToPath(import.meta.url);
const testDir = path.dirname(thisFile);
const cliPath = path.join(testDir, "..", "dist", "cli.js");

async function createTempRepo(t) {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "ace-memory-"));
  t.after(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(repoDir, "package.json"),
    JSON.stringify(
      {
        name: "memory-fixture",
        version: "0.0.0",
        scripts: {
          build: "tsc",
          test: "node --test"
        }
      },
      null,
      2
    ),
    "utf8"
  );

  await fs.writeFile(path.join(repoDir, "README.md"), "# Memory fixture\n\nFixture project for memory tests.\n", "utf8");

  await initProject(repoDir);
  return repoDir;
}

function runCli(repoDir, args) {
  return execFileSync("node", [cliPath, ...args], {
    cwd: repoDir,
    encoding: "utf8"
  });
}

test("memory add/list/search/forget works through API", async (t) => {
  const repoDir = await createTempRepo(t);

  const added1 = await addMemory(repoDir, {
    type: "preference",
    text: "Use markdown tables for API docs",
    tags: ["docs", "api"],
    source: "manual",
    importance: 4
  });

  await addMemory(repoDir, {
    type: "decision",
    text: "Adopt strict mode in CI for context sync",
    tags: ["ci", "security"],
    source: "manual",
    importance: 5
  });

  const listed = await listMemory(repoDir);
  assert.equal(listed.length, 2);

  const searched = await searchMemory(repoDir, { query: "API docs" });
  assert.ok(searched.length >= 1);
  assert.equal(searched[0].id, added1.item.id);

  const forgot = await forgetMemory(repoDir, { id: added1.item.id });
  assert.equal(forgot.removed, 1);

  const afterForget = await listMemory(repoDir);
  assert.equal(afterForget.length, 1);
});

test("memory add redacts secret-like input", async (t) => {
  const repoDir = await createTempRepo(t);

  const result = await addMemory(repoDir, {
    type: "warning",
    text: "Do not leak token=sk-abcdefghijklmnopqrstuvwxyz123456",
    source: "manual"
  });

  assert.ok(result.warning);
  assert.ok(result.item.text.includes("[REDACTED]"));
});

test("memory summarize and prune maintain durable state", async (t) => {
  const repoDir = await createTempRepo(t);

  const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString();
  for (let i = 0; i < 6; i += 1) {
    const added = await addMemory(repoDir, {
      type: "fact",
      text: `Fact item ${i} for summary`,
      source: "scan",
      importance: 2
    });

    const itemsPath = path.join(repoDir, ".awesome-context", "memory", "items.json");
    const items = JSON.parse(await fs.readFile(itemsPath, "utf8"));
    const idx = items.findIndex((item) => item.id === added.item.id);
    items[idx].updatedAt = oldDate;
    await fs.writeFile(itemsPath, JSON.stringify(items, null, 2), "utf8");
  }

  const summary = await summarizeMemory(repoDir);
  assert.ok(summary.createdSummaries >= 1);

  const prune = await pruneMemory(repoDir);
  assert.ok(prune.remaining >= 0);
});

test("buildMemoryContext returns only relevant sections", async (t) => {
  const repoDir = await createTempRepo(t);

  await addMemory(repoDir, {
    type: "project_state",
    text: "Current project state: docs migration in progress",
    tags: ["docs"]
  });
  await addMemory(repoDir, {
    type: "note",
    text: "Random unrelated note about styling"
  });

  const context = await buildMemoryContext(repoDir, {
    query: "documentation migration",
    config: {
      maxItems: 4,
      maxTokens: 300,
      includeTypes: ["project_state", "preference", "decision", "fact", "warning", "rule", "style"],
      excludeTypes: ["note"]
    }
  });

  assert.ok(context.sections.projectState.some((line) => line.includes("docs migration")));
  assert.ok(context.sections.excludedMemory.some((line) => line.includes("type excluded")));
});

test("memory command works via CLI", async (t) => {
  const repoDir = await createTempRepo(t);

  const addOutput = runCli(repoDir, ["memory", "add", "--type", "preference", "--text", "Use clear markdown docs"]);
  assert.match(addOutput, /Memory added:/i);

  const listOutput = runCli(repoDir, ["memory", "list"]);
  assert.match(listOutput, /preference/i);

  const searchOutput = runCli(repoDir, ["memory", "search", "--query", "markdown docs"]);
  assert.match(searchOutput, /markdown/i);
});
