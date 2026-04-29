#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runBenchmarkEval, runTokenBenchmark } from "./benchmark.js";
import {
  buildContextPack,
  checkContextMarks,
  explainContextFile,
  impactContextMarks,
  markContextFiles,
  refreshContextMarks
} from "./context-marks.js";
import { clearAceCache, generateGraphContext, getAceCacheStatus } from "./graph.js";
import {
  buildCaptureFromExport,
  canUseGenesis,
  learnCapture,
  learnForget,
  learnProfile,
  learnRecall,
  learnReflect,
  learnSkill,
  learnSuggest
} from "./genesis.js";
import {
  addMemory,
  forgetMemory,
  listMemory,
  pruneMemory,
  searchMemory,
  summarizeMemory,
  type MemoryType
} from "./memory.js";
import { runDoctor } from "./doctor.js";
import { initProject, type InitResult } from "./init.js";
import { indexProject } from "./indexer.js";
import { scanRepositoryContext } from "./scan.js";
import { syncContext } from "./sync.js";
import { generateSvgVisualization } from "./visualize.js";
import { getExitCodeForError } from "./strict-mode.js";
import { getContextPaths } from "./templates.js";
import { confirmPrompt, error, heading, info, secondary, success, warning } from "./ui.js";
import { startAutoMode } from "./watcher.js";

const execFileAsync = promisify(execFile);

type Command =
  | "init"
  | "index"
  | "scan"
  | "sync"
  | "auto"
  | "doctor"
  | "benchmark"
  | "benchmark:eval"
  | "graph"
  | "cache:status"
  | "cache:clear"
  | "learn:capture"
  | "learn:recall"
  | "learn:suggest"
  | "learn:skill"
  | "learn:reflect"
  | "learn:profile"
  | "learn:forget"
  | "memory"
  | "context:mark"
  | "context:check"
  | "context:refresh"
  | "context:impact"
  | "context:pack"
  | "context:explain"
  | "visualize"
  | "version"
  | "help";

type CliOptions = {
  yes: boolean;
  verbose: boolean;
  json: boolean;
  compact: boolean;
  strict: boolean;
  dryRun: boolean;
};

type ParsedCli = {
  command: Command | null;
  options: CliOptions;
  commandArgs: string[];
  kvArgs: Record<string, string>;
};

const CREATE_LIST = [
  ".awesome-context/",
  ".github/copilot-instructions.md",
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  "AIDER.md",
  "OPENCODE.md",
  "OPENCLAW.md",
  "FACTORY_DROID.md",
  "TRAE.md",
  "HERMES.md",
  "KIRO.md",
  "GOOGLE-ANTIGRAVITY.md",
  ".clinerules",
  ".continue/context.md"
];

function parseCli(argv: string[]): ParsedCli {
  const options: CliOptions = {
    yes: false,
    verbose: false,
    json: false,
    compact: false,
    strict: false,
    dryRun: false
  };

  let command: Command | null = null;
  const commandArgs: string[] = [];
  const kvArgs: Record<string, string> = {};
  const args = argv.slice(2);

  for (let i = 0; i < args.length; i += 1) {
    const rawArg = args[i];
    const arg = rawArg.trim();
    if (!arg) {
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      options.yes = true;
      continue;
    }
    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--compact") {
      options.compact = true;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      command = "help";
      continue;
    }

    if (arg.startsWith("--")) {
      const [key, inlineValue] = arg.slice(2).split("=", 2);
      if (inlineValue !== undefined) {
        kvArgs[key] = inlineValue;
        continue;
      }

      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        kvArgs[key] = nextArg;
        i += 1;
      } else {
        kvArgs[key] = "true";
      }
      continue;
    }

    if (arg.startsWith("-")) {
      command = "help";
      continue;
    }

    if (!command) {
      if (
        [
          "init",
          "index",
          "scan",
          "sync",
          "auto",
          "doctor",
          "benchmark",
          "benchmark:eval",
          "graph",
          "cache:status",
          "cache:clear",
          "learn:capture",
          "learn:recall",
          "learn:suggest",
          "learn:skill",
          "learn:reflect",
          "learn:profile",
          "learn:forget",
          "memory",
          "context:mark",
          "context:check",
          "context:refresh",
          "context:impact",
          "context:pack",
          "context:explain",
          "visualize",
          "version",
          "help"
        ].includes(arg)
      ) {
        command = arg as Command;
      } else {
        command = "help";
      }
      continue;
    }

    commandArgs.push(arg);
  }

  return { command, options, commandArgs, kvArgs };
}

function printHelp(): void {
  heading("awesome-context-engine");
  console.log(`
Portable repo memory for AI coding agents.

Preferred shorthand:
  ace <command>

Usage:
  ace                               First run setup or quick sync
  ace init                          Bootstrap .awesome-context and baseline repo artifacts
  ace scan                          Baseline context from an existing repository
  ace index                         Refresh project-map.md only (fast structure refresh)
  ace sync                          Rebuild ai-context.md after changes
  ace doctor                        Validate setup and report actionable issues
  ace benchmark                     Compare estimated raw vs optimized context tokens
  ace benchmark:eval                Run SWE-bench-inspired eval framework and write benchmark artifacts
  ace graph                         Build graph.json (incremental by default)
  ace cache:status                  Inspect ACE Cache coverage and hit rate
  ace cache:clear                   Delete cache.json and force cold rebuild next run
  ace context:pack <file>           Build focused context for one task/file
  ace context:impact <file>         Show direct/transitive dependency impact
  ace context:refresh               Refresh context metadata and impact maps
  ace context:mark                  Apply compact @ace-dna headers
  ace context:check                 Validate missing/stale/duplicate headers
  ace context:explain <file>        Human-readable file explanation
  ace memory <subcommand>           Add/search/prune/summarize persistent memory
  ace learn:<subcommand>            Capture, recall, and refine ACE Genesis learning
  ace auto                          Optional watch mode (continuous updates)
  ace visualize                     Generate project-map.svg visualization
  ace version                       Show running/project/global/latest versions

Legacy alias:
  awesome-context-engine <command>

Memory subcommands:
  ace memory add --type <type> --text <text> [--tags docs,api] [--source manual] [--importance 1-5]
  ace memory list [--type <type>] [--tag <tag>] [--query <query>] [--limit <n>]
  ace memory search --query <query> [--max-items <n>] [--max-tokens <n>]
  ace memory prune
  ace memory summarize
  ace memory forget --id <mem_id> | --query <query>

Context Marks:
  ace context:mark [--dry-run] [--include src,docs] [--exclude test,dist] [--limit 50] [--max-related 6]
  ace context:check [--include src,docs] [--exclude test,dist] [--ci]
  ace context:refresh [--dry-run] [--include src,docs] [--exclude test,dist] [--max-related 6]
  ace context:impact <file> [--include src,docs] [--exclude test,dist]
  ace context:pack <file> [--include src,docs] [--exclude test,dist] [--json] [--copy] [--tokens 4000] [--max-files 8] [--include-source]
  ace context:explain <file> [--include src,docs] [--exclude test,dist]

ACE Genesis:
  ace learn:capture [--stdin] [--from path/to/export.txt] [--file path/to/export.txt] [--text "..."] [--summary "..."] [--type docs|bugfix|...] [--approve-profile] [--approve-memory]
    default behavior: non-sensitive captures auto-enable long-term/profile persistence unless explicit approval flags are provided
  ace learn:recall <query> [--limit 8]
  ace learn:suggest
  ace learn:skill [--suggestion-id skill_suggestion_...] [--name ace-workflow]
  ace learn:reflect
  ace learn:profile
  ace learn:forget [--experience-id exp_...] [--suggestion-id skill_suggestion_...] [--profile-key coding:Some preference]

Skills:
  Repo-derived skill generation is disabled by default.
  Set .awesome-context/config.json -> skills.enabled=true to enable generation during ace sync.

Common examples:
  ace init
  ace scan --dry-run --verbose
  ace index
  ace sync
  ace doctor --json
  ace benchmark --json --compact
  ace benchmark:eval --json --compact
  ace memory add --type preference --text "Prefer concise API examples"
  ace memory search --query "api examples"
  ace learn:capture --file exports/session.txt --summary "fixed flaky tests"
  ace learn:recall "flaky tests"

Safety notes:
  - Use --strict to block sync when secret-like content is detected before redaction.
  - ace auto is optional and continuous; prefer pack + sync on lower-spec machines.
  - benchmark values are estimates for comparison, not exact billing guarantees.

Flags:
  --yes, -y           Skip prompts and use defaults
  --verbose           Show detailed logs
  --json              Output doctor results as JSON
  --compact           Output compact JSON (use with --json)
  --strict            Fail sync when secret-like content is detected before redaction
  --dry-run           Preview scan output without writing files
  --incremental       Force incremental graph mode (default)
  --full              Force full graph rebuild and cache refresh
`);
}

async function hasContextFolder(rootDir: string): Promise<boolean> {
  const contextDir = getContextPaths(rootDir).contextDir;
  try {
    const stats = await fs.stat(contextDir);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

function printStepError(step: string, stepError: unknown): void {
  error(`Step failed: ${step}`);
  error((stepError as Error).message || String(stepError));
}

function printInitVerbose(result: InitResult): void {
  info(`- init created: ${result.created.length}, skipped: ${result.skipped.length}`);
}

function pickSuggestedPackFile(files: Array<{ path: string }>): string {
  const candidates = files
    .map((item) => item.path.replace(/\\/g, "/"))
    .filter((filePath) => /\.(ts|tsx|js|jsx|py|go|rs|java|kt|cs|php|rb)$/i.test(filePath))
    .filter((filePath) => !/^(test|tests|docs)\//i.test(filePath))
    .sort((a, b) => a.localeCompare(b));

  return candidates[0] ?? "src/index.ts";
}

function printInitRepoSummary(totalFiles: number, totalDirectories: number, byExtension: Record<string, number>): void {
  const topExt = Object.entries(byExtension)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([ext, count]) => `${ext}:${count}`)
    .join(", ");

  heading("Repository Summary");
  info(`files: ${totalFiles}`);
  info(`directories: ${totalDirectories}`);
  info(`top extensions: ${topExt || "none"}`);
}

async function runInitCommand(rootDir: string, options: CliOptions): Promise<void> {
  const initResult = await initProject(rootDir);
  if (options.verbose) {
    printInitVerbose(initResult);
  }

  success("AI integration files created");
  success("Context files initialized");

  try {
    const scanResult = await scanRepositoryContext(rootDir, { strict: options.strict });
    const graphResult = await generateGraphContext(rootDir, { strict: options.strict });
    await refreshContextMarks(rootDir, { dryRun: false });
    success("Repository scanned and context baselined");
    success("Graph, cache, and context metadata prepared");
    if (options.verbose) {
      info(`- scan files indexed: ${scanResult.index.data.totalFiles}`);
      if (scanResult.sync) {
        info(`- ai-context: ${path.relative(rootDir, scanResult.sync.contextPath)} (${scanResult.sync.bytes} bytes)`);
      }
      info(`- graph nodes: ${graphResult.graph.nodes.length}, edges: ${graphResult.graph.edges.length}`);
      info(`- cache path: ${path.relative(rootDir, graphResult.cachePath)}`);
    }

    printInitRepoSummary(
      scanResult.index.data.totalFiles,
      scanResult.index.data.totalDirectories,
      scanResult.index.data.byExtension
    );

    const suggestedFile = pickSuggestedPackFile(scanResult.index.data.files);
    secondary(`Next: ace context:pack ${suggestedFile}`);
  } catch (scanError) {
    printStepError("scan", scanError);
    process.exit(getExitCodeForError(scanError));
    return;
  }

  info("Initialization complete. Run ace context:pack <file> whenever you need a fresh context drop.");
}

async function runFirstTimeExperience(rootDir: string, options: CliOptions): Promise<void> {
  heading("✨ awesome-context-engine");
  console.log();
  info("Portable repo memory for AI coding agents.");
  console.log();
  info("This will create:");
  for (const item of CREATE_LIST) {
    info(`  ${item}`);
  }
  console.log();

  const shouldInitialize = await confirmPrompt("Initialize awesome-context-engine in this repo?", true, options.yes);
  if (!shouldInitialize) {
    warning("No changes made.");
    return;
  }

  try {
    const initResult = await initProject(rootDir);
    if (options.verbose) {
      printInitVerbose(initResult);
    }
    success("Context files created");
  } catch (stepError) {
    printStepError("init", stepError);
    return;
  }

  try {
    const scanResult = await scanRepositoryContext(rootDir, { strict: options.strict });
    const graphResult = await generateGraphContext(rootDir, { strict: options.strict });
    await refreshContextMarks(rootDir, { dryRun: false });
    success("Repository scanned");
    success("AI context synced");
    success("Graph, cache, and context metadata prepared");
    if (options.verbose) {
      info(`- scan files indexed: ${scanResult.index.data.totalFiles}`);
      if (scanResult.sync) {
        info(`- ai-context: ${path.relative(rootDir, scanResult.sync.contextPath)} (${scanResult.sync.bytes} bytes)`);
      }
      info(`- graph nodes: ${graphResult.graph.nodes.length}, edges: ${graphResult.graph.edges.length}`);
      info(`- cache path: ${path.relative(rootDir, graphResult.cachePath)}`);
    }

    printInitRepoSummary(
      scanResult.index.data.totalFiles,
      scanResult.index.data.totalDirectories,
      scanResult.index.data.byExtension
    );

    const suggestedFile = pickSuggestedPackFile(scanResult.index.data.files);
    secondary(`Next: ace context:pack ${suggestedFile}`);
  } catch (stepError) {
    printStepError("scan", stepError);
    process.exit(getExitCodeForError(stepError));
    return;
  }

  console.log();
  secondary("Next:");
  secondary("  Open Claude Code, Codex, OpenCode, Cursor, Gemini CLI, Copilot Chat/CLI, Aider, OpenClaw, Factory Droid, Trae, Hermes, Kiro, or Google Antigravity.");
  secondary("  They will read .awesome-context/ai-context.md first.");
}

async function runDefault(rootDir: string, options: CliOptions): Promise<void> {
  const hasContext = await hasContextFolder(rootDir);
  if (!hasContext) {
    await runFirstTimeExperience(rootDir, options);
    return;
  }

  try {
    const indexResult = await indexProject(rootDir);
    const syncResult = await syncContext(rootDir, { strict: options.strict });

    success("Project indexed and AI context synced");
    if (options.verbose) {
      info(`- files indexed: ${indexResult.data.totalFiles}`);
      info(`- context file: ${path.relative(rootDir, syncResult.contextPath)} (${syncResult.bytes} bytes)`);
    }
  } catch (runError) {
    error("Default sync failed.");
    error((runError as Error).message || String(runError));
    process.exit(getExitCodeForError(runError));
  }
}

async function runDoctorCommand(rootDir: string, options: CliOptions): Promise<void> {
  const result = await runDoctor(rootDir);
  if (options.json) {
    const indent = options.compact ? undefined : 2;
    console.log(
      JSON.stringify(
        {
          command: "doctor",
          rootDir,
          ...result
        },
        null,
        indent
      )
    );

    if (!result.healthy) {
      process.exit(1);
    }
    return;
  }

  heading("Doctor Report");
  for (const check of result.checks) {
    if (check.ok) {
      success(`${check.label}${check.detail ? ` (${check.detail})` : ""}`);
    } else {
      warning(`${check.label}${check.detail ? ` (${check.detail})` : ""}`);
    }
  }

  if (result.healthy) {
    success("Setup looks healthy.");
    return;
  }

  error("Setup has issues. Run 'awesome-context-engine init' then 'awesome-context-engine sync'.");
  process.exit(1);
}

async function runBenchmarkCommand(rootDir: string, options: CliOptions): Promise<void> {
  const result = await runTokenBenchmark(rootDir);

  if (options.json) {
    const indent = options.compact ? undefined : 2;
    console.log(
      JSON.stringify(
        {
          command: "benchmark",
          rootDir,
          ...result
        },
        null,
        indent
      )
    );
    return;
  }

  heading("Token Benchmark");
  info(`Baseline estimated tokens: ${result.baseline.estimatedTokens}`);
  info(`Optimized estimated tokens: ${result.optimized.estimatedTokens}`);
  info(`Estimated tokens saved: ${result.delta.tokensSaved}`);
  info(`Estimated savings percent: ${result.delta.percentSaved}%`);

  if (options.verbose) {
    console.log();
    secondary("Baseline files:");
    for (const file of result.baseline.files) {
      const status = file.exists ? "found" : "missing";
      secondary(`  ${file.file}: ${file.estimatedTokens} tokens (${status})`);
    }
    secondary(`Optimized file: ${result.optimized.file} (${result.optimized.estimatedTokens} tokens)`);
  }

  console.log();
  secondary("Why Context Optimization Matters (SWE-bench-inspired, estimated examples):");
  for (const scenario of result.sweBenchInspired.scenarios.slice(0, 5)) {
    secondary(
      `- ${scenario.model} / ${scenario.assistant} / ${scenario.repoTaskType}`
    );
    secondary(
      `  tokens: ${scenario.comparison.withoutAce.estimatedTokens} -> ${scenario.comparison.withAce.estimatedTokens}`
      + ` | saved ${scenario.comparison.delta.estimatedTokensSaved}`
      + ` (${scenario.comparison.delta.estimatedPercentSaved}%)`
      + ` | est. cost saved $${scenario.comparison.delta.estimatedCostSavedUsd.toFixed(4)}`
      + ` | relevance ${scenario.comparison.delta.relevanceImprovement}`
      + ` | completion delta ${scenario.comparison.delta.estimatedTaskCompletionDeltaPercentRange}`
    );
  }

  console.log();
  for (const note of result.notes) {
    secondary(`- ${note}`);
  }
}

async function runBenchmarkEvalCommand(rootDir: string, options: CliOptions): Promise<void> {
  const result = await runBenchmarkEval(rootDir);

  if (options.json) {
    const indent = options.compact ? undefined : 2;
    console.log(
      JSON.stringify(
        {
          command: "benchmark:eval",
          rootDir,
          ...result
        },
        null,
        indent
      )
    );
    return;
  }

  heading("Benchmark Eval (SWE-bench-inspired)");
  info(`scenarios: ${result.summary.totalScenarios}`);
  info(`measured scenarios: ${result.summary.measuredScenarios}`);
  info(`estimated scenarios: ${result.summary.estimatedScenarios}`);
  info(`average estimated token reduction: ${result.summary.averageEstimatedTokenReductionPercent}%`);
  info(`average estimated cost saved per scenario: $${result.summary.averageEstimatedCostSavedUsd.toFixed(4)}`);
  info(`manifest: ${result.manifestPath}`);
  info(`results: ${result.outputPath}`);

  if (options.verbose) {
    console.log();
    secondary("Scenario summary:");
    for (const scenario of result.scenarios) {
      const delta = scenario.comparison.delta;
      const completion = delta.taskCompletion.measurable
        ? `${delta.taskCompletion.measuredDeltaPercent}% (measured)`
        : `${delta.taskCompletion.estimatedDeltaRange}`;
      secondary(
        `- ${scenario.model} / ${scenario.assistant} / ${scenario.repoTaskType}`
      );
      secondary(
        `  source=${scenario.source}`
        + ` tokens=${scenario.comparison.withoutAce.estimatedTokens}->${scenario.comparison.withAce.estimatedTokens}`
        + ` saved=${delta.estimatedTokensSaved} (${delta.estimatedPercentSaved}%)`
        + ` costSaved=$${delta.estimatedCostSavedUsd.toFixed(4)}`
        + ` relevance=${delta.relevanceImprovement}`
        + ` completion=${completion}`
      );
    }
  }

  console.log();
  for (const note of result.notes) {
    secondary(`- ${note}`);
  }
}

function parseMemoryType(type: string): MemoryType {
  const value = type.trim();
  const allowed: MemoryType[] = ["rule", "preference", "decision", "project_state", "fact", "warning", "style", "note"];
  if ((allowed as string[]).includes(value)) {
    return value as MemoryType;
  }
  throw new Error(`Invalid memory type: ${type}`);
}

function parsePathFilterList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/\\/g, "/"));
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

async function readCaptureInput(rootDir: string, kvArgs: Record<string, string>): Promise<string> {
  if (kvArgs.text) {
    return kvArgs.text;
  }

  const fileArg = kvArgs.file ?? kvArgs.from;
  if (fileArg) {
    const filePath = path.isAbsolute(fileArg) ? fileArg : path.join(rootDir, fileArg);
    return fs.readFile(filePath, "utf8");
  }

  if (kvArgs.stdin === "true" && process.stdin.isTTY) {
    throw new Error("learn:capture --stdin requires piped input.");
  }

  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  throw new Error("learn:capture requires --text, --from/--file, --stdin with pipe, or piped stdin input.");
}

async function runMemoryCommand(rootDir: string, options: CliOptions, commandArgs: string[], kvArgs: Record<string, string>): Promise<void> {
  const sub = commandArgs[0];

  if (!sub) {
    throw new Error("Missing memory subcommand.");
  }

  if (sub === "add") {
    const type = kvArgs.type;
    const text = kvArgs.text;
    if (!type || !text) {
      throw new Error("memory add requires --type and --text.");
    }

    const tags = kvArgs.tags ? kvArgs.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [];
    const importance = kvArgs.importance ? Number(kvArgs.importance) : undefined;

    const result = await addMemory(rootDir, {
      type: parseMemoryType(type),
      text,
      source: (kvArgs.source as "manual" | "scan" | "chat" | "doc" | "command" | "import" | undefined) ?? "manual",
      tags,
      importance,
      expiresAt: kvArgs.expiresAt ?? null
    });

    success(`Memory added: ${result.item.id}`);
    if (result.warning) {
      warning(result.warning);
    }
    if (options.verbose) {
      info(`[memory] type=${result.item.type} tags=${result.item.tags.join(",") || "none"}`);
    }
    return;
  }

  if (sub === "list") {
    const items = await listMemory(rootDir, {
      type: kvArgs.type ? parseMemoryType(kvArgs.type) : undefined,
      tag: kvArgs.tag,
      query: kvArgs.query,
      includeExpired: kvArgs["include-expired"] === "true",
      limit: kvArgs.limit ? Number(kvArgs.limit) : undefined
    });

    if (options.json) {
      const indent = options.compact ? undefined : 2;
      console.log(JSON.stringify({ command: "memory", subcommand: "list", count: items.length, items }, null, indent));
      return;
    }

    if (items.length === 0) {
      info("No memory items found.");
      return;
    }

    for (const item of items) {
      info(`${item.id} [${item.type}] (${item.source}) ${item.text}`);
    }
    return;
  }

  if (sub === "search") {
    const query = kvArgs.query;
    if (!query) {
      throw new Error("memory search requires --query.");
    }

    const items = await searchMemory(rootDir, {
      query,
      maxItems: kvArgs["max-items"] ? Number(kvArgs["max-items"]) : undefined,
      maxTokens: kvArgs["max-tokens"] ? Number(kvArgs["max-tokens"]) : undefined
    });

    if (items.length === 0) {
      info("No relevant memory found.");
      return;
    }

    for (const item of items) {
      info(`${item.id} [${item.type}] score-use=${item.useCount} ${item.text}`);
    }
    return;
  }

  if (sub === "prune") {
    const result = await pruneMemory(rootDir);
    success(
      `Pruned memory (duplicates=${result.removedDuplicate}, expired=${result.removedExpired}, low-value=${result.removedLowValue}, remaining=${result.remaining})`
    );
    return;
  }

  if (sub === "summarize") {
    const result = await summarizeMemory(rootDir);
    success(`Created ${result.createdSummaries} summaries and removed ${result.removedItems} old items.`);
    return;
  }

  if (sub === "forget") {
    const id = kvArgs.id;
    const query = kvArgs.query;
    if (!id && !query) {
      throw new Error("memory forget requires --id or --query.");
    }

    const result = await forgetMemory(rootDir, { id, query });
    success(`Removed ${result.removed} memory item(s).`);
    return;
  }

  throw new Error(`Unknown memory subcommand: ${sub}`);
}

type PackageJsonLike = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function npmCommand(): { command: string; argsPrefix: string[] } {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      argsPrefix: ["/d", "/s", "/c", "npm.cmd"]
    };
  }

  return {
    command: "npm",
    argsPrefix: []
  };
}

async function runNpm(args: string[], cwd: string): Promise<string> {
  const npm = npmCommand();
  const { stdout } = await execFileAsync(npm.command, [...npm.argsPrefix, ...args], { cwd });
  return String(stdout ?? "").trim();
}

async function readPackageJson(filePath: string): Promise<PackageJsonLike | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as PackageJsonLike;
  } catch {
    return null;
  }
}

async function getOwnVersion(rootDir: string): Promise<string> {
  const currentFile = fileURLToPath(import.meta.url);
  const ownPackagePath = path.resolve(path.dirname(currentFile), "..", "package.json");
  const ownPkg = await readPackageJson(ownPackagePath);

  if (ownPkg?.version) {
    return ownPkg.version;
  }

  const rootPkg = await readPackageJson(path.join(rootDir, "package.json"));
  return rootPkg?.version ?? "unknown";
}

async function getProjectInstalledVersion(rootDir: string, packageName: string): Promise<string> {
  const rootPkg = await readPackageJson(path.join(rootDir, "package.json"));
  if (rootPkg?.name === packageName && rootPkg.version) {
    return rootPkg.version;
  }

  const depVersion = rootPkg?.dependencies?.[packageName] ?? rootPkg?.devDependencies?.[packageName];
  if (depVersion) {
    return depVersion;
  }

  try {
    const raw = await runNpm(["list", packageName, "--depth=0", "--json"], rootDir);
    const parsed = JSON.parse(raw) as { dependencies?: Record<string, { version?: string }> };
    return parsed.dependencies?.[packageName]?.version ?? "not installed in project";
  } catch {
    return "not installed in project";
  }
}

async function getGlobalInstalledVersion(rootDir: string, packageName: string): Promise<string> {
  try {
    const raw = await runNpm(["list", "-g", packageName, "--depth=0", "--json"], rootDir);
    const parsed = JSON.parse(raw) as { dependencies?: Record<string, { version?: string }> };
    return parsed.dependencies?.[packageName]?.version ?? "not installed globally";
  } catch {
    return "not installed globally";
  }
}

async function getLatestNpmVersion(rootDir: string, packageName: string): Promise<string> {
  try {
    const latest = await runNpm(["view", packageName, "version"], rootDir);
    return latest || "unknown";
  } catch {
    return "unknown";
  }
}

function compareVersions(v1: string, v2: string): number {
  if (v1 === "unknown" || v2 === "unknown" || v1 === "not installed in project" || v2 === "not installed in project" || v1 === "not installed globally" || v2 === "not installed globally") {
    return 0;
  }

  const parse = (v: string) => v.split(".").map(x => parseInt(x, 10) || 0);
  const parts1 = parse(v1);
  const parts2 = parse(v2);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }

  return 0;
}

async function runVersionCommand(rootDir: string): Promise<void> {
  const packageName = "awesome-context-engine";

  const [runningVersion, projectVersion, globalVersion, latestVersion] = await Promise.all([
    getOwnVersion(rootDir),
    getProjectInstalledVersion(rootDir, packageName),
    getGlobalInstalledVersion(rootDir, packageName),
    getLatestNpmVersion(rootDir, packageName)
  ]);

  heading("Version Info");
  info(`Running CLI: ${runningVersion}`);
  info(`Project: ${projectVersion}`);
  info(`Global (PC): ${globalVersion}`);
  info(`npm latest: ${latestVersion}`);

  const updates: string[] = [];

  if (compareVersions(runningVersion, latestVersion) < 0 && runningVersion !== "unknown") {
    updates.push(`npm install -g ${packageName}@latest`);
  }

  if (compareVersions(projectVersion, latestVersion) < 0 && !projectVersion.includes("not installed")) {
    updates.push(`npm update ${packageName}`);
  }

  if (compareVersions(globalVersion, latestVersion) < 0 && !globalVersion.includes("not installed")) {
    updates.push(`npm install -g ${packageName}@latest`);
  }

  if (updates.length > 0) {
    console.log("");
    heading("Updates available:");
    for (const cmd of updates) {
      info(`  ${cmd}`);
    }
  }
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const parsed = parseCli(process.argv);
  const command = parsed.command;
  const options = parsed.options;
  const commandArgs = parsed.commandArgs;
  const kvArgs = parsed.kvArgs;

  try {
    switch (command) {
      case null:
        await runDefault(rootDir, options);
        break;
      case "init": {
        await runInitCommand(rootDir, options);
        break;
      }
      case "index": {
        const result = await indexProject(rootDir, { writeJson: false });
        success("Project map updated");
        if (options.verbose) {
          info(`[index] files: ${result.data.totalFiles}, dirs: ${result.data.totalDirectories}`);
          info(`[index] output: ${path.relative(rootDir, result.indexMarkdownPath)}`);
        }
        break;
      }
      case "scan": {
        const result = await scanRepositoryContext(rootDir, {
          strict: options.strict,
          dryRun: options.dryRun
        });
        if (result.dryRun) {
          success("Scan preview complete (no files written)");
        } else {
          success("Repository scanned and context baselined");
        }
        if (options.verbose) {
          info(`[scan] files: ${result.index.data.totalFiles}, dirs: ${result.index.data.totalDirectories}`);
          if (result.dryRun) {
            info("[scan] would update:");
            for (const filePath of result.updatedFiles) {
              info(`  - ${path.relative(rootDir, filePath)}`);
            }
            info(`[scan] preview memory points: ${result.preview.memory.length}`);
            info(`[scan] preview workflow points: ${result.preview.workflows.length}`);
            info(`[scan] preview preference points: ${result.preview.preferences.length}`);
            info(`[scan] preview decision points: ${result.preview.decisions.length}`);
          } else {
            info(`[scan] project map: ${path.relative(rootDir, result.index.indexMarkdownPath)}`);
            if (result.sync) {
              info(`[scan] ai-context: ${path.relative(rootDir, result.sync.contextPath)} (${result.sync.bytes} bytes)`);
            }
          }
        }
        break;
      }
      case "sync": {
        if (process.env.ANTHROPIC_API_KEY) {
          secondary("Generating skills with Claude...");
        }
        const result = await syncContext(rootDir, {
          strict: options.strict,
          onSkillPlan: (plan) => {
            if (!options.verbose) return;
            for (const { skill, action } of plan) {
              if (action === "create") info(`[skills] create ${skill}`);
              else if (action === "update") info(`[skills] update ${skill} (fingerprint changed)`);
              else if (action === "skip-locked") info(`[skills] skip ${skill} (locked)`);
            }
          }
        });
        success("AI context synced");
        if (options.verbose) {
          info(`[sync] wrote ${path.relative(rootDir, result.contextPath)} (${result.bytes} bytes)`);
        }
        break;
      }
      case "auto": {
        heading("Auto Mode");
        info("Watching for changes...");
        await startAutoMode(rootDir, { strict: options.strict });
        break;
      }
      case "doctor": {
        await runDoctorCommand(rootDir, options);
        break;
      }
      case "benchmark": {
        await runBenchmarkCommand(rootDir, options);
        break;
      }
      case "benchmark:eval": {
        await runBenchmarkEvalCommand(rootDir, options);
        break;
      }
      case "graph": {
        const result = await generateGraphContext(rootDir, {
          strict: options.strict,
          incremental: kvArgs.incremental !== "false",
          full: kvArgs.full === "true"
        });
        success("Graph generated");
        if (options.verbose) {
          info(`[graph] output: ${path.relative(rootDir, result.graphPath)}`);
          info(`[graph] minimal context: ${path.relative(rootDir, result.minimalContextPath)}`);
          info(`[graph] cache: ${path.relative(rootDir, result.cachePath)}`);
          info(`[graph] nodes: ${result.graph.nodes.length}, edges: ${result.graph.edges.length}`);
          info(`[graph] cache hit rate: ${(result.stats.cache.hitRate * 100).toFixed(2)}%`);
          info(`[graph] extracted files: ${result.stats.extractedFiles}`);
          if (result.stats.cache.reasons.length > 0) {
            info(`[graph] invalidation: ${result.stats.cache.reasons.join(", ")}`);
          }
        }
        break;
      }
      case "cache:status": {
        const status = await getAceCacheStatus(rootDir, { full: kvArgs.full === "true" });
        heading("ACE Cache Status");
        info(`tracked files: ${status.trackedFiles}`);
        info(`unchanged: ${status.unchanged}`);
        info(`changed: ${status.changed}`);
        info(`added: ${status.added}`);
        info(`deleted: ${status.deleted}`);
        info(`cache hit rate: ${(status.hitRate * 100).toFixed(2)}%`);
        if (status.invalidated && status.reasons.length > 0) {
          warning(`cache invalidated: ${status.reasons.join(", ")}`);
        }
        break;
      }
      case "cache:clear": {
        const result = await clearAceCache(rootDir);
        if (result.removed) {
          success(`ACE Cache cleared (${path.relative(rootDir, result.cachePath)})`);
        } else {
          warning("ACE Cache already clear");
        }
        break;
      }
      case "learn:capture": {
        if (!(await canUseGenesis(rootDir))) {
          warning("ACE Genesis is disabled by config.");
          break;
        }

        const rawInput = await readCaptureInput(rootDir, kvArgs);
        const parsed = buildCaptureFromExport(rawInput);
        const approveMemoryArg = kvArgs["approve-memory"];
        const approveMemory = approveMemoryArg === "true";
        const approveProfileArg = kvArgs["approve-profile"];
        let approveProfile: boolean | undefined =
          approveProfileArg === "true" ? true : approveProfileArg === "false" ? false : undefined;
        if (approveMemory && approveProfile === undefined) {
          approveProfile = await confirmPrompt(
            "Persist durable profile facts from this capture?",
            false,
            options.yes
          );
        }
        const result = await learnCapture(rootDir, {
          ...parsed,
          summary: kvArgs.summary ?? parsed.summary,
          taskType: (kvArgs.type as
            | "feature-design"
            | "bugfix"
            | "docs"
            | "release"
            | "refactor"
            | "research"
            | undefined) ?? parsed.taskType,
          approvedForLongTermMemory: approveMemoryArg === undefined ? undefined : approveMemory,
          approveProfile
        });

        success(`ACE Genesis captured experience: ${result.experience.id}`);
        if (result.warning) warning(result.warning);
        if (!result.profileUpdated && kvArgs["approve-memory"] === "true") {
          info("tip: add --approve-profile to persist profile facts from this experience.");
        }
        break;
      }
      case "learn:recall": {
        if (!(await canUseGenesis(rootDir))) {
          warning("ACE Genesis is disabled by config.");
          break;
        }

        const query = commandArgs.join(" ") || kvArgs.query;
        if (!query) throw new Error("learn:recall requires a query.");
        const limit = parsePositiveInt(kvArgs.limit) ?? 8;
        const recalled = await learnRecall(rootDir, query, { limit });
        if (recalled.length === 0) {
          info("No ACE Genesis memories matched the query.");
          break;
        }
        heading("ACE Genesis Recall");
        for (const item of recalled) {
          info(`- [${item.sourceType}] ${item.sourceId}: ${item.text}`);
        }
        break;
      }
      case "learn:suggest": {
        if (!(await canUseGenesis(rootDir))) {
          warning("ACE Genesis is disabled by config.");
          break;
        }
        const result = await learnSuggest(rootDir);
        heading("ACE Genesis Suggestions");
        info(`skill suggestions: ${result.suggestions.length}`);
        for (const item of result.suggestions.slice(0, 20)) {
          info(`- ${item.name} (${item.status}): ${item.reason}`);
        }
        if (result.memoryNudges.length > 0) {
          info("memory nudges:");
          for (const nudge of result.memoryNudges.slice(0, 10)) {
            info(`- ${nudge}`);
          }
        }
        break;
      }
      case "learn:skill": {
        if (!(await canUseGenesis(rootDir))) {
          warning("ACE Genesis is disabled by config.");
          break;
        }
        const result = await learnSkill(rootDir, {
          suggestionId: kvArgs["suggestion-id"],
          name: kvArgs.name
        });
        success(`ACE Genesis drafted skill: ${result.suggestion.name}`);
        info(`draft: ${path.relative(rootDir, result.draftDir)}`);
        break;
      }
      case "learn:reflect": {
        if (!(await canUseGenesis(rootDir))) {
          warning("ACE Genesis is disabled by config.");
          break;
        }
        const result = await learnReflect(rootDir);
        heading("ACE Genesis Reflection");
        if (result.updates.length === 0) {
          info("No skill drafts available for reflection.");
          break;
        }
        for (const update of result.updates) {
          info(`- ${update.skill}`);
          for (const note of update.notes) {
            info(`  - ${note}`);
          }
        }
        break;
      }
      case "learn:profile": {
        if (!(await canUseGenesis(rootDir))) {
          warning("ACE Genesis is disabled by config.");
          break;
        }
        const profile = await learnProfile(rootDir);
        const indent = options.compact ? undefined : 2;
        console.log(JSON.stringify(profile, null, indent));
        break;
      }
      case "learn:forget": {
        if (!(await canUseGenesis(rootDir))) {
          warning("ACE Genesis is disabled by config.");
          break;
        }
        const result = await learnForget(rootDir, {
          experienceId: kvArgs["experience-id"],
          suggestionId: kvArgs["suggestion-id"],
          profileKey: kvArgs["profile-key"]
        });
        if (result.removed.length === 0) {
          warning("No ACE Genesis entries matched forget filters.");
        } else {
          success(`ACE Genesis forgot ${result.removed.length} item(s)`);
          for (const item of result.removed) info(`- ${item}`);
        }
        break;
      }
      case "memory": {
        await runMemoryCommand(rootDir, options, commandArgs, kvArgs);
        break;
      }
      case "context:mark": {
        const include = parsePathFilterList(kvArgs.include);
        const exclude = parsePathFilterList(kvArgs.exclude);
        const limit = parsePositiveInt(kvArgs.limit);
        const maxRelated = parsePositiveInt(kvArgs["max-related"]);
        const result = await markContextFiles(rootDir, {
          dryRun: options.dryRun,
          include,
          exclude,
          limit,
          maxRelated
        });
        if (options.dryRun) {
          success("Context Marks preview complete (no files written)");
        } else {
          success("Context Marks applied");
        }
        if (options.verbose) {
          info(`[context:mark] metadata: ${path.relative(rootDir, result.metadataPath)}`);
          info(`[context:mark] files updated: ${result.filesUpdated.length}`);
          info(`[context:mark] files unchanged: ${result.filesUnchanged.length}`);
          if (include.length > 0) info(`[context:mark] include: ${include.join(", ")}`);
          if (exclude.length > 0) info(`[context:mark] exclude: ${exclude.join(", ")}`);
          if (limit) info(`[context:mark] limit: ${limit}`);
          if (maxRelated) info(`[context:mark] max-related: ${maxRelated}`);
          if (options.dryRun && result.filesUpdated.length > 0) {
            info("[context:mark] would update:");
            for (const filePath of result.filesUpdated.slice(0, 20)) {
              info(`  - ${filePath}`);
            }
          }
        }
        break;
      }
      case "context:check": {
        const include = parsePathFilterList(kvArgs.include);
        const exclude = parsePathFilterList(kvArgs.exclude);
        const ciMode = kvArgs.ci === "true" || process.env.CI === "true";
        const result = await checkContextMarks(rootDir, { include, exclude, ci: ciMode });
        if (result.issues.length === 0) {
          success("Context Marks are up to date");
        } else {
          warning(`Context Marks issues found: ${result.issues.length}`);
          for (const issue of result.issues.slice(0, 50)) {
            info(`- ${issue.status}: ${issue.file}${issue.detail ? ` (${issue.detail})` : ""}`);
          }
          const scopeArgs = [
            include.length > 0 ? `--include ${include.join(",")}` : "",
            exclude.length > 0 ? `--exclude ${exclude.join(",")}` : ""
          ]
            .filter(Boolean)
            .join(" ");
          const refreshCmd = scopeArgs ? `ace context:refresh ${scopeArgs}` : "ace context:refresh";
          info(`fix: run '${refreshCmd}' to regenerate ACE DNA metadata and headers.`);
          if (ciMode) {
            info("fix: after refresh, rerun 'ace context:check --ci' in CI.");
          }
          if (ciMode) {
            process.exitCode = 1;
          }
        }
        if (options.verbose) {
          info(`[context:check] checked files: ${result.checkedFiles}`);
          info(`[context:check] metadata: ${path.relative(rootDir, result.metadataPath)}`);
          if (include.length > 0) info(`[context:check] include: ${include.join(", ")}`);
          if (exclude.length > 0) info(`[context:check] exclude: ${exclude.join(", ")}`);
          info(`[context:check] ci mode: ${ciMode ? "on" : "off"}`);
        }
        break;
      }
      case "context:refresh": {
        const include = parsePathFilterList(kvArgs.include);
        const exclude = parsePathFilterList(kvArgs.exclude);
        const maxRelated = parsePositiveInt(kvArgs["max-related"]);
        const marked = await markContextFiles(rootDir, {
          dryRun: options.dryRun,
          include,
          exclude,
          maxRelated
        });
        const paths = getContextPaths(rootDir);
        if (options.dryRun) {
          success("Context refresh preview complete (no files written)");
        } else {
          success("Context metadata and headers refreshed");
        }
        if (options.verbose) {
          const trackedFiles = marked.filesUpdated.length + marked.filesUnchanged.length;
          info(`[context:refresh] tracked files: ${trackedFiles}`);
          info(`[context:refresh] graph: ${path.relative(rootDir, paths.graphJsonPath)}`);
          info(`[context:refresh] file-context: ${path.relative(rootDir, paths.fileContextPath)}`);
          info(`[context:refresh] impact-map: ${path.relative(rootDir, paths.impactMapPath)}`);
          info(`[context:refresh] headers updated: ${marked.filesUpdated.length}`);
          if (include.length > 0) info(`[context:refresh] include: ${include.join(", ")}`);
          if (exclude.length > 0) info(`[context:refresh] exclude: ${exclude.join(", ")}`);
          if (maxRelated) info(`[context:refresh] max-related: ${maxRelated}`);
        }
        break;
      }
      case "context:impact": {
        const targetFile = commandArgs[0] ?? kvArgs.file;
        if (!targetFile) {
          throw new Error("context:impact requires a file path argument.");
        }

        const include = parsePathFilterList(kvArgs.include);
        const exclude = parsePathFilterList(kvArgs.exclude);

        let result;
        try {
          result = await impactContextMarks(rootDir, targetFile, { include, exclude });
        } catch (impactError) {
          const message = (impactError as Error).message || String(impactError);
          const staleLike = /missing|stale/i.test(message);
          if (staleLike) {
            warning("Context artifacts are stale or missing. Auto-refreshing prerequisites...");
            await refreshContextMarks(rootDir, { dryRun: false, include, exclude });
            result = await impactContextMarks(rootDir, targetFile, { include, exclude });
          } else {
            warning(message);
            process.exitCode = 1;
            break;
          }
        }
        heading("Context Impact");
        info(`file: ${result.target}`);
        info(`provides: ${result.provides.join(", ") || "-"}`);
        info(`direct consumers: ${result.directConsumers.length}`);
        for (const consumer of result.directConsumers) {
          info(`  - ${consumer}`);
        }
        info(`transitive consumers: ${result.transitiveConsumers.length}`);
        if (options.verbose) {
          for (const consumer of result.transitiveConsumers) {
            info(`  - ${consumer}`);
          }
          info(`related: ${result.related.join(", ") || "-"}`);
          info(`tests: ${result.tests.join(", ") || "-"}`);
          info(`docs: ${result.docs.join(", ") || "-"}`);
          info(`routes: ${result.routes.join(", ") || "-"}`);
          info(`components: ${result.components.join(", ") || "-"}`);
          info(`configs: ${result.configs.join(", ") || "-"}`);
          if (include.length > 0) info(`[context:impact] include: ${include.join(", ")}`);
          if (exclude.length > 0) info(`[context:impact] exclude: ${exclude.join(", ")}`);
        }
        break;
      }
      case "context:pack": {
        const targetFile = commandArgs[0] ?? kvArgs.file;
        if (!targetFile) {
          throw new Error("context:pack requires a file path argument.");
        }

        const include = parsePathFilterList(kvArgs.include);
        const exclude = parsePathFilterList(kvArgs.exclude);
        const maxRelated = parsePositiveInt(kvArgs["max-related"]);
        const tokens = parsePositiveInt(kvArgs.tokens);
        const maxFiles = parsePositiveInt(kvArgs["max-files"]);
        const result = await buildContextPack(rootDir, targetFile, {
          include,
          exclude,
          maxRelated,
          copy: kvArgs.copy === "true",
          includeSource: kvArgs["include-source"] === "true",
          tokens,
          maxFiles
        });

        if (options.json) {
          const indent = options.compact ? undefined : 2;
          console.log(JSON.stringify({ command: "context:pack", ...result.pack, copied: result.copied }, null, indent));
        } else {
          console.log(result.markdown);
          if (kvArgs.copy === "true") {
            if (result.copied) success("Context pack copied to clipboard");
            else warning("Clipboard utility not found; pack not copied");
          }
        }
        break;
      }
      case "context:explain": {
        const targetFile = commandArgs[0] ?? kvArgs.file;
        if (!targetFile) {
          throw new Error("context:explain requires a file path argument.");
        }

        const include = parsePathFilterList(kvArgs.include);
        const exclude = parsePathFilterList(kvArgs.exclude);
        const maxRelated = parsePositiveInt(kvArgs["max-related"]);
        const output = await explainContextFile(rootDir, targetFile, { include, exclude, maxRelated });
        console.log(output);
        break;
      }
      case "visualize": {
        const result = await generateSvgVisualization(rootDir);
        success("Repository visualization generated");
        if (options.verbose) {
          info(`[visualize] wrote ${path.relative(rootDir, result.svgPath)} (${result.bytes} bytes)`);
        }
        break;
      }
      case "version": {
        await runVersionCommand(rootDir);
        break;
      }
      case "help":
      default:
        printHelp();
        break;
    }
  } catch (error) {
    console.error("awesome-context-engine failed", error);
    process.exit(getExitCodeForError(error));
  }
}

void main();
