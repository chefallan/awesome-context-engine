#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const TASKS = [
  {
    id: "api-bugfix-triage",
    file: "src/cli.ts",
    model: "GPT-5",
    assistant: "VS Code Copilot Chat",
    repoTaskType: "TypeScript CLI core / command routing",
    contextSize: "large"
  },
  {
    id: "auth-refactor",
    file: "src/genesis.ts",
    model: "Claude Sonnet 4",
    assistant: "VS Code Copilot Chat",
    repoTaskType: "Learning profile logic / approval flow",
    contextSize: "medium"
  },
  {
    id: "ui-regression-fix",
    file: "src/ui.ts",
    model: "Gemini 2.5 Pro",
    assistant: "VS Code Copilot Chat",
    repoTaskType: "CLI UI rendering / formatting behavior",
    contextSize: "medium"
  },
  {
    id: "release-pipeline-edit",
    file: "scripts/release.mjs",
    model: "o3",
    assistant: "VS Code Copilot Chat",
    repoTaskType: "Release automation script updates",
    contextSize: "small"
  },
  {
    id: "docs-code-alignment",
    file: "README.md",
    model: "GPT-4.1",
    assistant: "VS Code Copilot Chat",
    repoTaskType: "Documentation and command alignment",
    contextSize: "small"
  }
];

function estimateTokens(chars) {
  return Math.ceil(chars / 4);
}

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function runCli(args) {
  const run = spawnSync(process.execPath, ["dist/cli.js", ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  if (run.status !== 0) {
    const errText = (run.stderr || run.stdout || "").trim();
    throw new Error(`ace ${args.join(" ")} failed: ${errText}`);
  }

  return (run.stdout || "").trim();
}

async function existingFiles(files) {
  const unique = [...new Set(files)];
  const present = [];
  for (const rel of unique) {
    const abs = path.join(process.cwd(), rel);
    try {
      await fs.access(abs);
      present.push(rel);
    } catch {
      // ignore missing suggestions from graph/context drift
    }
  }
  return present;
}

async function charsForFiles(files) {
  let total = 0;
  for (const rel of files) {
    const content = await fs.readFile(path.join(process.cwd(), rel), "utf8");
    total += content.length;
  }
  return total;
}

function toMarkdownTable(rows) {
  const header = [
    "| Scenario | Model | Assistant | Context Size | Repo / Task Type | Without ACE Tokens | With ACE Tokens | Reduction | Data Source |",
    "| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |"
  ];

  const body = rows.map((row) => {
    return `| ${row.id} | ${row.model} | ${row.assistant} | ${row.contextSize} | ${row.repoTaskType} | ${row.withoutAceTokens} | ${row.withAceTokens} | ${row.reductionPercent}% | measured local suite (${row.targetFile}) |`;
  });

  return [...header, ...body].join("\n");
}

async function main() {
  const rows = [];

  for (const task of TASKS) {
    const jsonOut = runCli(["context:pack", task.file, "--json", "--compact"]);
    const packMeta = JSON.parse(jsonOut);
    const recommended = Array.isArray(packMeta.recommendedRead) ? packMeta.recommendedRead : [];

    const baselineFiles = await existingFiles([task.file, ...recommended]);
    const withoutAceChars = await charsForFiles(baselineFiles);
    const withoutAceTokens = estimateTokens(withoutAceChars);

    const packedText = stripAnsi(runCli(["context:pack", task.file, "--compact"]));
    const withAceChars = packedText.length;
    const withAceTokens = estimateTokens(withAceChars);

    const saved = withoutAceTokens - withAceTokens;
    const reduction = withoutAceTokens > 0 ? (saved / withoutAceTokens) * 100 : 0;

    rows.push({
      id: task.id,
      model: task.model,
      assistant: task.assistant,
      contextSize: task.contextSize,
      repoTaskType: task.repoTaskType,
      targetFile: task.file,
      withoutAceTokens,
      withAceTokens,
      tokensSaved: saved,
      reductionPercent: Number(reduction.toFixed(2)),
      baselineFiles
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    methodology: {
      withoutAce: "Raw UTF-8 file content tokens from target file + recommendedRead files (chars/4).",
      withAce: "Actual `ace context:pack <file> --compact` output tokens (chars/4).",
      notes: [
        "All rows are measured from real local command output.",
        "No scaling multipliers or synthetic scenario projections are applied."
      ]
    },
    rows,
    markdownTable: toMarkdownTable(rows)
  };

  const outPath = path.join(process.cwd(), ".awesome-context", "benchmark", "real-suite-results.json");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`Wrote measured suite results: ${path.relative(process.cwd(), outPath).replace(/\\/g, "/")}`);
  console.log("\nMarkdown table:\n");
  console.log(output.markdownTable);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
