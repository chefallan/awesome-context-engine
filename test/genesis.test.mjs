import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildContextPack, explainContextFile, refreshContextMarks } from "../dist/context-marks.js";
import {
  learnCapture,
  learnForget,
  learnProfile,
  learnRecall,
  learnReflect,
  learnSkill,
  learnSuggest
} from "../dist/genesis.js";
import { initProject } from "../dist/init.js";

async function createTempRepo(t) {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "ace-genesis-"));
  t.after(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(repoDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(repoDir, "package.json"),
    JSON.stringify({ name: "ace-genesis-fixture", version: "0.0.0", type: "module" }, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(repoDir, "src", "main.ts"),
    'export function runTask() {\n  return "ok";\n}\n',
    "utf8"
  );

  await initProject(repoDir);
  return repoDir;
}

test("genesis capture creates experience and keeps profile gated by approval", async (t) => {
  const repoDir = await createTempRepo(t);

  const captured = await learnCapture(repoDir, {
    text: [
      "User prefers concise README-ready summaries.",
      "Decision: use managed headers for source metadata.",
      "Failure: stale output in CI was fixed.",
      "Followup: add release checklist skill."
    ].join("\n"),
    summary: "ACE Genesis initial capture",
    approvedForLongTermMemory: false,
    approveProfile: false
  });

  assert.ok(captured.experience.id.startsWith("exp_"));
  assert.equal(captured.profileUpdated, false);

  const profile = await learnProfile(repoDir);
  assert.equal(profile.preferences.coding.length, 0);
});

test("genesis capture updates profile when approved", async (t) => {
  const repoDir = await createTempRepo(t);

  await learnCapture(repoDir, {
    text: "User prefers incremental implementation prompts for Copilot and deterministic updates.",
    summary: "Profile-approved capture",
    approvedForLongTermMemory: true,
    approveProfile: true
  });

  const profile = await learnProfile(repoDir);
  assert.ok(profile.preferences.coding.length >= 1);
  const projectEntries = Object.values(profile.projects);
  assert.ok(projectEntries.length >= 1);
  assert.ok(projectEntries.some((entry) => entry.features.includes("ACE Genesis")));
});

test("genesis recall returns relevant ranked items", async (t) => {
  const repoDir = await createTempRepo(t);

  await learnCapture(repoDir, {
    text: "Decision: use .awesome-context/cache.json for incremental cache behavior.",
    summary: "Cache decision capture",
    approvedForLongTermMemory: false,
    approveProfile: false
  });

  const recalled = await learnRecall(repoDir, "incremental cache", { limit: 5 });
  assert.ok(recalled.length >= 1);
  assert.ok(recalled[0].text.toLowerCase().includes("cache"));
});

test("genesis suggest and skill draft generation work", async (t) => {
  const repoDir = await createTempRepo(t);

  for (let i = 0; i < 3; i += 1) {
    await learnCapture(repoDir, {
      text: "Workflow pattern: run graph, run context refresh, run context check.",
      summary: "Repeated workflow planner",
      taskType: "feature-design",
      approvedForLongTermMemory: false,
      approveProfile: false
    });
  }

  const suggest = await learnSuggest(repoDir);
  assert.ok(suggest.suggestions.length >= 1);

  const drafted = await learnSkill(repoDir, { suggestionId: suggest.suggestions[0].id });
  const skillPath = path.join(drafted.draftDir, "SKILL.md");
  const changelogPath = path.join(drafted.draftDir, "CHANGELOG.md");
  const skillRaw = await fs.readFile(skillPath, "utf8");
  const changelogRaw = await fs.readFile(changelogPath, "utf8");

  assert.match(skillRaw, /Checklist/i);
  assert.match(changelogRaw, /Draft generated/i);
});

test("genesis reflect appends draft changelog hints", async (t) => {
  const repoDir = await createTempRepo(t);

  for (let i = 0; i < 3; i += 1) {
    await learnCapture(repoDir, {
      text: "Workflow pattern: update release automation checklist.",
      summary: "Release workflow loop",
      approvedForLongTermMemory: false,
      approveProfile: false
    });
  }

  const suggest = await learnSuggest(repoDir);
  const drafted = await learnSkill(repoDir, { suggestionId: suggest.suggestions[0].id });

  await learnCapture(repoDir, {
    text: "Failure: missing verification step in release draft.",
    summary: "Reflect failure input",
    approvedForLongTermMemory: false,
    approveProfile: false
  });

  const reflected = await learnReflect(repoDir);
  assert.ok(reflected.updates.length >= 1);

  const changelogRaw = await fs.readFile(path.join(drafted.draftDir, "CHANGELOG.md"), "utf8");
  assert.match(changelogRaw, /Reflection hint/i);
});

test("genesis forget removes selected entries", async (t) => {
  const repoDir = await createTempRepo(t);

  const captured = await learnCapture(repoDir, {
    text: "Decision: keep generated memory local and forgettable.",
    summary: "Forget target",
    approvedForLongTermMemory: false,
    approveProfile: false
  });

  const removed = await learnForget(repoDir, { experienceId: captured.experience.id });
  assert.ok(removed.removed.some((item) => item.includes(captured.experience.id)));

  const recalled = await learnRecall(repoDir, "forgettable", { limit: 5 });
  assert.equal(recalled.some((item) => item.sourceId === captured.experience.id), false);
});

test("context pack and explain include genesis recall/decisions when available", async (t) => {
  const repoDir = await createTempRepo(t);

  await learnCapture(repoDir, {
    text: "Decision: keep context generation deterministic and concise.",
    summary: "Deterministic decision",
    approvedForLongTermMemory: false,
    approveProfile: false
  });

  await refreshContextMarks(repoDir);

  const pack = await buildContextPack(repoDir, "src/main.ts");
  assert.ok(Array.isArray(pack.pack.relevantDecisions));
  assert.ok(Array.isArray(pack.pack.relevantPreferences));
  assert.ok(Array.isArray(pack.pack.suggestedTests));

  const explain = await explainContextFile(repoDir, "src/main.ts");
  assert.match(explain, /Prior decisions:/i);
});
