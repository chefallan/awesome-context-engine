import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildContextPack,
  checkContextMarks,
  impactContextMarks,
  markContextFiles,
  refreshContextMarks
} from "../dist/context-marks.js";

const thisFile = fileURLToPath(import.meta.url);
const testDir = path.dirname(thisFile);
const cliPath = path.join(testDir, "..", "dist", "cli.js");

async function createTempRepo(t) {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "ace-context-marks-"));
  t.after(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(repoDir, "src", "routes"), { recursive: true });
  await fs.mkdir(path.join(repoDir, "test"), { recursive: true });

  await fs.writeFile(
    path.join(repoDir, "package.json"),
    JSON.stringify(
      {
        name: "context-marks-fixture",
        version: "0.0.0",
        type: "module"
      },
      null,
      2
    ),
    "utf8"
  );

  await fs.writeFile(
    path.join(repoDir, "src", "user.ts"),
    await fs.readFile(path.join(testDir, "fixtures", "context-marks", "typescript", "user.ts"), "utf8"),
    "utf8"
  );

  await fs.writeFile(
    path.join(repoDir, "src", "routes", "user.ts"),
    "import { createUser } from \"../user\";\n\nexport function routeCreateUser() {\n  return createUser(\"a@example.com\");\n}\n",
    "utf8"
  );

  await fs.writeFile(
    path.join(repoDir, "src", "consumer.ts"),
    "import { routeCreateUser } from \"./routes/user\";\n\nexport function runConsumer() {\n  return routeCreateUser();\n}\n",
    "utf8"
  );

  await fs.writeFile(
    path.join(repoDir, "test", "user.test.ts"),
    "import { createUser } from \"../src/user\";\n\nexport function runUserTest() {\n  return createUser(\"t@example.com\");\n}\n",
    "utf8"
  );

  return repoDir;
}

async function createTempPythonRepo(t) {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "ace-context-python-"));
  t.after(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(repoDir, "app", "routes"), { recursive: true });

  await fs.writeFile(
    path.join(repoDir, "app", "user.py"),
    await fs.readFile(path.join(testDir, "fixtures", "context-marks", "python", "user.py"), "utf8"),
    "utf8"
  );

  await fs.writeFile(
    path.join(repoDir, "app", "routes", "user.py"),
    "from app.user import create_user\n\n\ndef route_create():\n    return create_user('a@example.com')\n",
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

test("context marks refresh/mark/check/impact works and is idempotent", async (t) => {
  const repoDir = await createTempRepo(t);

  const refreshed = await refreshContextMarks(repoDir);
  assert.equal(refreshed.written, true);
  assert.ok(refreshed.data.files["src/user.ts"]);
  assert.ok(refreshed.data.files["src/user.ts"].provides.includes("createUser"));
  assert.ok(refreshed.data.files["src/user.ts"].consumed_by.includes("src/routes/user.ts"));

  const marked = await markContextFiles(repoDir);
  assert.ok(marked.filesUpdated.includes("src/user.ts"));

  const markedTwice = await markContextFiles(repoDir);
  assert.equal(markedTwice.filesUpdated.length, 0);

  const fileSource = await fs.readFile(path.join(repoDir, "src", "user.ts"), "utf8");
  assert.ok(fileSource.includes("@ace-dna"));

  const checked = await checkContextMarks(repoDir);
  assert.equal(checked.issues.length, 0);

  const impact = await impactContextMarks(repoDir, "src/user.ts");
  assert.ok(impact.directConsumers.includes("src/routes/user.ts"));
  assert.ok(impact.transitiveConsumers.includes("src/consumer.ts"));

  const scopedImpact = await impactContextMarks(repoDir, "src/user.ts", {
    include: ["src/"],
    exclude: ["src/routes/"]
  });
  assert.equal(scopedImpact.directConsumers.length, 0);
});

test("context marks check detects stale headers", async (t) => {
  const repoDir = await createTempRepo(t);

  await markContextFiles(repoDir);

  const filePath = path.join(repoDir, "src", "user.ts");
  const before = await fs.readFile(filePath, "utf8");
  const after = before.replace("provides:", "provides: stale-");
  await fs.writeFile(filePath, after, "utf8");

  const checked = await checkContextMarks(repoDir);
  assert.ok(checked.issues.some((issue) => issue.file === "src/user.ts" && issue.status === "stale"));

  const duplicated = `/**\n * @ace-dna\n * provides: x\n * consumed_by: -\n * constraints: -\n * related: -\n */\n\n${after}`;
  await fs.writeFile(filePath, duplicated, "utf8");
  const checkedDuplicate = await checkContextMarks(repoDir);
  assert.ok(checkedDuplicate.issues.some((issue) => issue.file === "src/user.ts" && issue.status === "duplicate"));
});

test("context marks dry-run does not write files", async (t) => {
  const repoDir = await createTempRepo(t);
  const metadataPath = path.join(repoDir, ".awesome-context", "file-context.json");

  const refreshDryRun = await refreshContextMarks(repoDir, { dryRun: true });
  assert.equal(refreshDryRun.written, false);

  await assert.rejects(async () => fs.access(metadataPath));

  const before = await fs.readFile(path.join(repoDir, "src", "user.ts"), "utf8");
  const markDryRun = await markContextFiles(repoDir, { dryRun: true });
  const after = await fs.readFile(path.join(repoDir, "src", "user.ts"), "utf8");

  assert.equal(before, after);
  assert.ok(markDryRun.filesUpdated.length > 0);
});

test("context marks derive constraints from context files and honor include/exclude", async (t) => {
  const repoDir = await createTempRepo(t);
  await fs.mkdir(path.join(repoDir, ".awesome-context"), { recursive: true });

  await fs.writeFile(
    path.join(repoDir, ".awesome-context", "preferences.md"),
    [
      "# Preferences",
      "",
      "- Validate email before persistence",
      "- Keep handlers deterministic and side-effect aware"
    ].join("\n"),
    "utf8"
  );

  const refreshed = await refreshContextMarks(repoDir, { include: ["src/"], exclude: ["src/routes/"] });
  assert.ok(refreshed.data.files["src/user.ts"]);
  assert.equal(refreshed.data.files["src/routes/user.ts"], undefined);
  assert.ok(refreshed.data.files["src/user.ts"].constraints.includes("Validate email before persistence"));

  const marked = await markContextFiles(repoDir, { include: ["src/"], exclude: ["src/routes/"] });
  assert.ok(marked.filesUpdated.includes("src/user.ts"));
  assert.ok(!marked.filesUpdated.includes("src/routes/user.ts"));
});

test("context marks uses python line-comment header style", async (t) => {
  const repoDir = await createTempPythonRepo(t);
  await markContextFiles(repoDir, { include: ["app/"] });

  const source = await fs.readFile(path.join(repoDir, "app", "user.py"), "utf8");
  assert.ok(source.startsWith("# @ace-dna"));
  assert.ok(source.includes("# provides:"));
  assert.ok(source.includes("# consumed_by:"));
});

test("context pack output is compact and includes impact data", async (t) => {
  const repoDir = await createTempRepo(t);
  await markContextFiles(repoDir);

  const pack = await buildContextPack(repoDir, "src/user.ts");
  assert.ok(pack.markdown.includes("# Context Pack: src/user.ts"));
  assert.ok(pack.markdown.includes("Purpose:"));
  assert.ok(pack.pack.provides.includes("createUser"));
  assert.ok(pack.pack.likelyImpacted.includes("src/routes/user.ts"));
  assert.ok(Array.isArray(pack.pack.relevantDecisions));
  assert.ok(Array.isArray(pack.pack.relevantPreferences));
  assert.ok(Array.isArray(pack.pack.suggestedTests));

  const withSource = await buildContextPack(repoDir, "src/user.ts", {
    includeSource: true,
    maxFiles: 2,
    tokens: 900
  });
  assert.ok(withSource.pack.sourceSnippets.length >= 1);
});

test("context marks command works via CLI", async (t) => {
  const repoDir = await createTempRepo(t);

  const refreshOutput = runCli(repoDir, ["context:refresh"]);
  assert.match(refreshOutput, /Context metadata and headers refreshed/i);

  const markOutput = runCli(repoDir, ["context:mark"]);
  assert.match(markOutput, /Context Marks applied/i);

  const checkOutput = runCli(repoDir, ["context:check"]);
  assert.match(checkOutput, /Context Marks are up to date/i);

  const impactOutput = runCli(repoDir, ["context:impact", "src/user.ts"]);
  assert.match(impactOutput, /Context Impact/i);

  const scopedMark = runCli(repoDir, ["context:mark", "--include", "src", "--exclude", "src/routes"]);
  assert.match(scopedMark, /Context Marks applied/i);

  const scopedCheck = runCli(repoDir, ["context:check", "--include", "src", "--exclude", "src/routes"]);
  assert.match(scopedCheck, /Context Marks are up to date/i);

  const scopedImpactOutput = runCli(repoDir, ["context:impact", "src/user.ts", "--include", "src", "--exclude", "src/routes"]);
  assert.match(scopedImpactOutput, /Context Impact/i);

  const graphOutput = runCli(repoDir, ["graph"]);
  assert.match(graphOutput, /Graph generated/i);

  const packOutput = runCli(repoDir, ["context:pack", "src/user.ts"]);
  assert.match(packOutput, /Context Pack/i);

  const explainOutput = runCli(repoDir, ["context:explain", "src/user.ts"]);
  assert.match(explainOutput, /File: src\/user.ts/i);
});
