#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] ?? "help";
  const kv = {};

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const [key, inline] = arg.slice(2).split("=", 2);
    if (inline !== undefined) {
      kv[key] = inline;
      continue;
    }
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      kv[key] = next;
      i += 1;
    } else {
      kv[key] = "true";
    }
  }

  return { command, kv };
}

function repoRoot() {
  return process.cwd();
}

function benchmarkDir(rootDir) {
  return path.join(rootDir, ".awesome-context", "benchmark");
}

function manifestPath(rootDir) {
  return path.join(benchmarkDir(rootDir), "eval-scenarios.json");
}

function templatePath(rootDir) {
  return path.join(benchmarkDir(rootDir), "measured-runs.template.jsonl");
}

function samplePath(rootDir) {
  return path.join(benchmarkDir(rootDir), "measured-runs.sample.jsonl");
}

function resultsPath(rootDir) {
  return path.join(benchmarkDir(rootDir), "eval-results.json");
}

function runAceEval(rootDir) {
  const run = spawnSync(process.execPath, ["dist/cli.js", "benchmark:eval", "--json", "--compact"], {
    cwd: rootDir,
    encoding: "utf8"
  });

  if (run.status !== 0) {
    const stderr = (run.stderr || run.stdout || "").trim();
    throw new Error(`benchmark:eval failed: ${stderr}`);
  }

  return JSON.parse(run.stdout);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function ensureManifest(rootDir) {
  try {
    await fs.access(manifestPath(rootDir));
  } catch {
    runAceEval(rootDir);
  }
  return readJson(manifestPath(rootDir));
}

function toJsonl(lines) {
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

async function commandPrepare(rootDir) {
  const manifest = await ensureManifest(rootDir);

  const templateRows = [];
  for (const scenario of manifest.scenarios ?? []) {
    templateRows.push({
      scenarioId: scenario.id,
      model: scenario.model,
      assistant: scenario.assistant,
      repoTaskType: scenario.repoTaskType,
      runId: "replace-with-run-id",
      withoutAceTokens: 0,
      withAceTokens: 0,
      withoutAceCostUsd: 0,
      withAceCostUsd: 0,
      relevanceWithoutAceScore: 0,
      relevanceWithAceScore: 0,
      withoutAceSuccessRate: 0,
      withAceSuccessRate: 0,
      notes: "replace with run notes"
    });
  }

  const templateFile = templatePath(rootDir);
  await fs.mkdir(path.dirname(templateFile), { recursive: true });
  await fs.writeFile(templateFile, toJsonl(templateRows), "utf8");

  const sampleRows = [
    {
      scenarioId: "api-bugfix-triage",
      model: "GPT-5 class",
      assistant: "VS Code Copilot Chat",
      repoTaskType: "TypeScript SaaS monorepo / API bugfix",
      runId: "gpt5-copilot-2026-04-29-r1",
      withoutAceTokens: 4120,
      withAceTokens: 1650,
      withoutAceCostUsd: 0.0206,
      withAceCostUsd: 0.0083,
      relevanceWithoutAceScore: 2.8,
      relevanceWithAceScore: 4.2,
      withoutAceSuccessRate: 0.62,
      withAceSuccessRate: 0.74,
      notes: "example measured row"
    }
  ];

  await fs.writeFile(samplePath(rootDir), toJsonl(sampleRows), "utf8");

  console.log(`Prepared measured run template: ${path.relative(rootDir, templateFile).replace(/\\/g, "/")}`);
  console.log(`Sample row file: ${path.relative(rootDir, samplePath(rootDir)).replace(/\\/g, "/")}`);
  console.log("Next: fill measured-runs.template.jsonl with real runs, then apply.");
}

function parseJsonl(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

function average(values) {
  if (values.length === 0) return undefined;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function aggregateByScenario(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!row.scenarioId || typeof row.scenarioId !== "string") continue;
    const list = grouped.get(row.scenarioId) ?? [];
    list.push(row);
    grouped.set(row.scenarioId, list);
  }
  return grouped;
}

function pickNumber(row, key) {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isRate(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isScore(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5;
}

async function commandValidate(rootDir, inputFile, strictCoverage) {
  if (!inputFile) {
    throw new Error("Missing --input path to measured JSONL file.");
  }

  const manifest = await ensureManifest(rootDir);
  const scenarioIds = new Set((manifest.scenarios ?? []).map((scenario) => scenario.id));

  const absoluteInput = path.isAbsolute(inputFile) ? inputFile : path.join(rootDir, inputFile);
  const rows = parseJsonl(await fs.readFile(absoluteInput, "utf8"));
  const grouped = aggregateByScenario(rows);

  const errors = [];
  const warnings = [];

  for (const [index, row] of rows.entries()) {
    const lineNumber = index + 1;
    if (!row.scenarioId || typeof row.scenarioId !== "string") {
      errors.push(`line ${lineNumber}: missing or invalid scenarioId`);
      continue;
    }
    if (!scenarioIds.has(row.scenarioId)) {
      errors.push(`line ${lineNumber}: unknown scenarioId '${row.scenarioId}'`);
    }
    if (!row.model || typeof row.model !== "string") {
      errors.push(`line ${lineNumber}: missing or invalid model`);
    }
    if (!row.assistant || typeof row.assistant !== "string") {
      errors.push(`line ${lineNumber}: missing or invalid assistant`);
    }
    if (!row.runId || typeof row.runId !== "string") {
      errors.push(`line ${lineNumber}: missing or invalid runId`);
    }

    if (!isPositiveNumber(row.withoutAceTokens)) {
      errors.push(`line ${lineNumber}: withoutAceTokens must be > 0`);
    }
    if (!isPositiveNumber(row.withAceTokens)) {
      errors.push(`line ${lineNumber}: withAceTokens must be > 0`);
    }

    if (row.withoutAceCostUsd !== undefined && !isPositiveNumber(row.withoutAceCostUsd)) {
      errors.push(`line ${lineNumber}: withoutAceCostUsd must be > 0 when provided`);
    }
    if (row.withAceCostUsd !== undefined && !isPositiveNumber(row.withAceCostUsd)) {
      errors.push(`line ${lineNumber}: withAceCostUsd must be > 0 when provided`);
    }

    if (row.relevanceWithoutAceScore !== undefined && !isScore(row.relevanceWithoutAceScore)) {
      errors.push(`line ${lineNumber}: relevanceWithoutAceScore must be between 1 and 5`);
    }
    if (row.relevanceWithAceScore !== undefined && !isScore(row.relevanceWithAceScore)) {
      errors.push(`line ${lineNumber}: relevanceWithAceScore must be between 1 and 5`);
    }

    if (row.withoutAceSuccessRate !== undefined && !isRate(row.withoutAceSuccessRate)) {
      errors.push(`line ${lineNumber}: withoutAceSuccessRate must be between 0 and 1`);
    }
    if (row.withAceSuccessRate !== undefined && !isRate(row.withAceSuccessRate)) {
      errors.push(`line ${lineNumber}: withAceSuccessRate must be between 0 and 1`);
    }
  }

  for (const scenario of manifest.scenarios ?? []) {
    const scenarioRows = grouped.get(scenario.id) ?? [];
    if (scenarioRows.length === 0) {
      warnings.push(`scenario '${scenario.id}' has no measured rows`);
      continue;
    }

    const models = scenarioRows
      .map((row) => (typeof row.model === "string" ? row.model.toLowerCase() : ""))
      .filter(Boolean);

    const hasClaude = models.some((model) => model.includes("claude"));
    const hasGpt = models.some((model) => model.includes("gpt"));

    if (!hasClaude || !hasGpt) {
      const missing = [!hasClaude ? "Claude" : "", !hasGpt ? "GPT" : ""].filter(Boolean).join(" + ");
      warnings.push(`scenario '${scenario.id}' missing model coverage: ${missing}`);
    }
  }

  console.log(`Validated ${rows.length} row(s) from ${path.relative(rootDir, absoluteInput).replace(/\\/g, "/")}`);
  if (warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }

  if (errors.length > 0) {
    console.error("Errors:");
    for (const item of errors) {
      console.error(`- ${item}`);
    }
    process.exit(1);
  }

  if (strictCoverage && warnings.length > 0) {
    console.error("Coverage warnings treated as errors due to --strict-coverage.");
    process.exit(1);
  }

  console.log("Validation passed.");
}

async function commandApply(rootDir, inputFile) {
  if (!inputFile) {
    throw new Error("Missing --input path to measured JSONL file.");
  }

  const manifest = await ensureManifest(rootDir);
  const absoluteInput = path.isAbsolute(inputFile) ? inputFile : path.join(rootDir, inputFile);
  const rows = parseJsonl(await fs.readFile(absoluteInput, "utf8"));
  const grouped = aggregateByScenario(rows);

  let applied = 0;

  for (const scenario of manifest.scenarios ?? []) {
    const scenarioRows = grouped.get(scenario.id) ?? [];
    if (scenarioRows.length === 0) continue;

    const withoutAceTokens = average(scenarioRows.map((row) => pickNumber(row, "withoutAceTokens")).filter((v) => typeof v === "number"));
    const withAceTokens = average(scenarioRows.map((row) => pickNumber(row, "withAceTokens")).filter((v) => typeof v === "number"));
    const withoutAceCostUsd = average(scenarioRows.map((row) => pickNumber(row, "withoutAceCostUsd")).filter((v) => typeof v === "number"));
    const withAceCostUsd = average(scenarioRows.map((row) => pickNumber(row, "withAceCostUsd")).filter((v) => typeof v === "number"));
    const relevanceWithoutAceScore = average(scenarioRows.map((row) => pickNumber(row, "relevanceWithoutAceScore")).filter((v) => typeof v === "number"));
    const relevanceWithAceScore = average(scenarioRows.map((row) => pickNumber(row, "relevanceWithAceScore")).filter((v) => typeof v === "number"));
    const withoutAceSuccessRate = average(scenarioRows.map((row) => pickNumber(row, "withoutAceSuccessRate")).filter((v) => typeof v === "number"));
    const withAceSuccessRate = average(scenarioRows.map((row) => pickNumber(row, "withAceSuccessRate")).filter((v) => typeof v === "number"));

    scenario.measured = {
      ...(typeof withoutAceTokens === "number" ? { withoutAceTokens: Number(withoutAceTokens.toFixed(2)) } : {}),
      ...(typeof withAceTokens === "number" ? { withAceTokens: Number(withAceTokens.toFixed(2)) } : {}),
      ...(typeof withoutAceCostUsd === "number" ? { withoutAceCostUsd: Number(withoutAceCostUsd.toFixed(4)) } : {}),
      ...(typeof withAceCostUsd === "number" ? { withAceCostUsd: Number(withAceCostUsd.toFixed(4)) } : {}),
      ...(typeof relevanceWithoutAceScore === "number" ? { relevanceWithoutAceScore: Number(relevanceWithoutAceScore.toFixed(2)) } : {}),
      ...(typeof relevanceWithAceScore === "number" ? { relevanceWithAceScore: Number(relevanceWithAceScore.toFixed(2)) } : {}),
      ...(typeof withoutAceSuccessRate === "number" ? { withoutAceSuccessRate: Number(withoutAceSuccessRate.toFixed(4)) } : {}),
      ...(typeof withAceSuccessRate === "number" ? { withAceSuccessRate: Number(withAceSuccessRate.toFixed(4)) } : {})
    };

    scenario.notes = [
      ...(scenario.notes ?? []).filter((note) => typeof note === "string"),
      `Measured rows applied from ${path.basename(absoluteInput)} (${scenarioRows.length} run(s)).`
    ];

    applied += 1;
  }

  await writeJson(manifestPath(rootDir), manifest);

  console.log(`Applied measured data to ${applied} scenario(s).`);
  console.log(`Updated manifest: ${path.relative(rootDir, manifestPath(rootDir)).replace(/\\/g, "/")}`);

  const evalResult = runAceEval(rootDir);
  await writeJson(resultsPath(rootDir), evalResult);
  console.log(`Recomputed results: ${path.relative(rootDir, resultsPath(rootDir)).replace(/\\/g, "/")}`);
}

function printHelp() {
  console.log(`benchmark-eval-harness

Usage:
  node scripts/benchmark-eval-harness.mjs prepare
  node scripts/benchmark-eval-harness.mjs validate --input .awesome-context/benchmark/measured-runs.template.jsonl [--strict-coverage]
  node scripts/benchmark-eval-harness.mjs apply --input .awesome-context/benchmark/measured-runs.template.jsonl
  node scripts/benchmark-eval-harness.mjs run

Commands:
  prepare   Ensure eval manifest exists and generate JSONL templates for measured runs
  validate  Validate JSONL schema and warn on missing Claude/GPT coverage per scenario
  apply     Ingest measured JSONL rows, aggregate by scenarioId, update manifest measured fields, rerun eval
  run       Run benchmark:eval and write latest eval results
`);
}

async function commandRun(rootDir) {
  const evalResult = runAceEval(rootDir);
  await writeJson(resultsPath(rootDir), evalResult);
  console.log(`Wrote eval results: ${path.relative(rootDir, resultsPath(rootDir)).replace(/\\/g, "/")}`);
}

async function main() {
  const { command, kv } = parseArgs(process.argv);
  const rootDir = repoRoot();

  if (command === "prepare") {
    await commandPrepare(rootDir);
    return;
  }

  if (command === "apply") {
    await commandApply(rootDir, kv.input);
    return;
  }

  if (command === "validate") {
    await commandValidate(rootDir, kv.input, kv["strict-coverage"] === "true");
    return;
  }

  if (command === "run") {
    await commandRun(rootDir);
    return;
  }

  printHelp();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
