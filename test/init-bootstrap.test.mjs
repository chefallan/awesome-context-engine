import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const testDir = path.dirname(thisFile);
const cliPath = path.join(testDir, "..", "dist", "cli.js");

function runCli(repoDir, args) {
  return execFileSync("node", [cliPath, ...args], {
    cwd: repoDir,
    encoding: "utf8"
  });
}

test("init bootstraps scan graph cache and context artifacts", async (t) => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "ace-init-"));
  t.after(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(repoDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(repoDir, "package.json"),
    JSON.stringify({ name: "ace-init-fixture", version: "0.0.0", type: "module" }, null, 2),
    "utf8"
  );
  await fs.writeFile(path.join(repoDir, "src", "index.ts"), "export const run = () => 'ok';\n", "utf8");

  const output = runCli(repoDir, ["init"]);
  assert.match(output, /Repository scanned and context baselined/i);
  assert.match(output, /Graph, cache, and context metadata prepared/i);
  assert.match(output, /Next: ace context:pack/i);

  const requiredFiles = [
    ".awesome-context/ai-context.md",
    ".awesome-context/project-map.md",
    ".awesome-context/graph.json",
    ".awesome-context/file-context.json",
    ".awesome-context/impact-map.json",
    ".awesome-context/cache.json",
    ".awesome-context/memory-index.json",
    ".awesome-context/profile.json",
    ".awesome-context/skill-suggestions.json"
  ];

  for (const relativePath of requiredFiles) {
    await fs.access(path.join(repoDir, relativePath));
  }

  const experiencesDir = path.join(repoDir, ".awesome-context", "experiences");
  const stat = await fs.stat(experiencesDir);
  assert.equal(stat.isDirectory(), true);
});
