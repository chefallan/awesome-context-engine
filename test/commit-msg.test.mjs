import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateCommitMessageSuggestion } from "../dist/commit-message.js";

const thisFile = fileURLToPath(import.meta.url);
const testDir = path.dirname(thisFile);
const fixturesRoot = path.join(testDir, "fixtures", "commit-msg");

function runGit(repoDir, args) {
  return execFileSync("git", args, {
    cwd: repoDir,
    encoding: "utf8"
  }).trim();
}

async function loadFixtureManifest(fixtureName) {
  const manifestPath = path.join(fixturesRoot, fixtureName, "fixture.json");
  return JSON.parse(await fs.readFile(manifestPath, "utf8"));
}

async function applySnapshot(fixtureDir, snapshotName, repoDir) {
  const snapshotDir = path.join(fixtureDir, snapshotName);
  await fs.cp(snapshotDir, repoDir, { recursive: true, force: true });
}

async function createRepoFromFixture(t, fixtureName) {
  const fixtureDir = path.join(fixturesRoot, fixtureName);
  const manifest = await loadFixtureManifest(fixtureName);
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), `ace-${fixtureName}-`));

  t.after(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  runGit(repoDir, ["init", "-b", "main"]);
  runGit(repoDir, ["config", "user.name", "Fixture User"]);
  runGit(repoDir, ["config", "user.email", "fixture@example.com"]);

  for (const commit of manifest.commits) {
    await applySnapshot(fixtureDir, commit.snapshot, repoDir);
    runGit(repoDir, ["add", "-A"]);
    runGit(repoDir, ["commit", "-m", commit.message]);
  }

  if (manifest.workspace) {
    await applySnapshot(fixtureDir, manifest.workspace, repoDir);
  }

  return { repoDir, manifest };
}

test("commit-msg handles repositories with no commits yet", async (t) => {
  const { repoDir } = await createRepoFromFixture(t, "no-commits-initial");

  const result = await generateCommitMessageSuggestion(repoDir);

  assert.equal(result.source, "initial-workspace");
  assert.equal(result.type, "new");
  assert.match(result.title, /bootstrap initial project structure/i);
  assert.deepEqual(result.changedFiles.sort(), ["package.json", "src/index.ts"]);
});

test("commit-msg falls back to the latest meaningful commit when the workspace is clean", async (t) => {
  const { repoDir } = await createRepoFromFixture(t, "clean-fallback-last-commit");

  const result = await generateCommitMessageSuggestion(repoDir);

  assert.equal(result.source, "last-commit");
  assert.equal(result.basedOn.subject, "docs: expand contribution guide");
  assert.ok(result.changedFiles.includes("CONTRIBUTING.md"));
});

test("commit-msg titles include function names when the diff introduces a focused symbol", async (t) => {
  const { repoDir } = await createRepoFromFixture(t, "workspace-function-focus");

  const result = await generateCommitMessageSuggestion(repoDir);

  assert.equal(result.source, "workspace");
  assert.match(result.title, /generateCommitPlan/);
});

test("commit-msg titles include command names when CLI cases change", async (t) => {
  const { repoDir } = await createRepoFromFixture(t, "workspace-command-focus");

  const result = await generateCommitMessageSuggestion(repoDir);

  assert.equal(result.source, "workspace");
  assert.match(result.title, /doctor command/i);
});

test("commit-msg titles include script names when package scripts change", async (t) => {
  const { repoDir } = await createRepoFromFixture(t, "workspace-script-focus");

  const result = await generateCommitMessageSuggestion(repoDir);

  assert.equal(result.source, "workspace");
  assert.match(result.title, /test script/i);
});