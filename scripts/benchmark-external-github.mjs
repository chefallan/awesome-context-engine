#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const EXTERNAL_REPOS = [
  {
    id: "chalk-core",
    repo: "chalk/chalk",
    model: "GPT-5",
    assistant: "VS Code Copilot Chat",
    repoTaskType: "Console formatting library maintenance",
    contextSize: "small"
  },
  {
    id: "ky-http-client",
    repo: "sindresorhus/ky",
    model: "Claude Sonnet 4",
    assistant: "VS Code Copilot Chat",
    repoTaskType: "HTTP client feature and bugfix work",
    contextSize: "medium"
  },
  {
    id: "axios-networking",
    repo: "axios/axios",
    model: "Gemini 2.5 Pro",
    assistant: "VS Code Copilot Chat",
    repoTaskType: "Networking stack fixes and refactors",
    contextSize: "large"
  }
];

function run(command, args, cwd, label) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    const text = (result.stderr || result.stdout || "").trim();
    throw new Error(`${label} failed: ${text}`);
  }

  return (result.stdout || "").trim();
}

function parseJsonOutput(raw) {
  const text = raw.trim();
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) {
    throw new Error("JSON output not found in CLI response.");
  }
  return JSON.parse(text.slice(jsonStart));
}

function toMarkdownTable(rows) {
  const lines = [
    "| Scenario | Repository | Commit | Model | Assistant | Context Size | Without ACE Tokens | With ACE Tokens | Reduction | Data Source |",
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |"
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.id} | ${row.repo} | ${row.commit} | ${row.model} | ${row.assistant} | ${row.contextSize} | ${row.withoutAceTokens} | ${row.withAceTokens} | ${row.reductionPercent}% | measured external GitHub run |`
    );
  }

  return lines.join("\n");
}

async function main() {
  const rootDir = process.cwd();
  const cliPath = path.join(rootDir, "dist", "cli.js");
  const reposDir = path.join(rootDir, "test", "external-repos");
  const outPath = path.join(rootDir, ".awesome-context", "benchmark", "external-github-results.json");

  await fs.mkdir(reposDir, { recursive: true });

  const rows = [];

  for (const entry of EXTERNAL_REPOS) {
    const folderName = entry.repo.replace("/", "-");
    const repoDir = path.join(reposDir, folderName);
    await fs.rm(repoDir, { recursive: true, force: true });

    run(
      "git",
      ["clone", "--depth", "1", `https://github.com/${entry.repo}.git`, repoDir],
      rootDir,
      `clone ${entry.repo}`
    );

    const commit = run("git", ["rev-parse", "--short", "HEAD"], repoDir, `rev-parse ${entry.repo}`);

    run(process.execPath, [cliPath, "init", "--yes"], repoDir, `ace init in ${entry.repo}`);

    const benchmarkRaw = run(
      process.execPath,
      [cliPath, "benchmark", "--json", "--compact"],
      repoDir,
      `ace benchmark in ${entry.repo}`
    );

    const parsed = parseJsonOutput(benchmarkRaw);
    const withoutAceTokens = parsed?.baseline?.estimatedTokens;
    const withAceTokens = parsed?.optimized?.estimatedTokens;
    const reductionPercent = parsed?.delta?.percentSaved;

    if (
      typeof withoutAceTokens !== "number" ||
      typeof withAceTokens !== "number" ||
      typeof reductionPercent !== "number"
    ) {
      throw new Error(`Unexpected benchmark payload shape for ${entry.repo}`);
    }

    rows.push({
      id: entry.id,
      repo: entry.repo,
      commit,
      model: entry.model,
      assistant: entry.assistant,
      repoTaskType: entry.repoTaskType,
      contextSize: entry.contextSize,
      withoutAceTokens,
      withAceTokens,
      reductionPercent: Number(reductionPercent.toFixed(2))
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    scope: {
      assistant: "VS Code Copilot Chat",
      models: [...new Set(EXTERNAL_REPOS.map((item) => item.model))]
    },
    methodology: {
      cloneStrategy: "git clone --depth 1",
      benchmarkCommand: "node dist/cli.js benchmark --json --compact",
      notes: [
        "All rows are measured from real benchmark command output on cloned GitHub repositories.",
        "Token estimates use chars/4 as implemented by ace benchmark.",
        "No synthetic scenario scaling is used in this external table."
      ]
    },
    rows,
    markdownTable: toMarkdownTable(rows)
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`Wrote external benchmark results: ${path.relative(rootDir, outPath).replace(/\\/g, "/")}`);
  console.log("\nMarkdown table:\n");
  console.log(output.markdownTable);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
