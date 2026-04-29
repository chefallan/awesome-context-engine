#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runTokenBenchmark } from "./benchmark.js";
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
  | "memory"
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
      if (["init", "index", "scan", "sync", "auto", "doctor", "benchmark", "memory", "visualize", "version", "help"].includes(arg)) {
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
  ace                               First-run setup or quick sync
  ace init                          Initialize core context files
  ace index                         Update project-map.md only
  ace scan                          Scan repository and baseline context files
  ace sync                          Regenerate ai-context.md only
  ace auto                          Watch mode: index + sync on changes
  ace doctor                        Check setup health
  ace benchmark                     Estimate token savings (raw vs ai-context)
  ace memory <subcommand>           Manage persistent memory
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

Flags:
  --yes, -y           Skip prompts and use defaults
  --verbose           Show detailed logs
  --json              Output doctor results as JSON
  --compact           Output compact JSON (use with --json)
  --strict            Fail sync when secret-like content is detected before redaction
  --dry-run           Preview scan output without writing files
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

async function runInitCommand(rootDir: string, options: CliOptions): Promise<void> {
  const initResult = await initProject(rootDir);
  if (options.verbose) {
    printInitVerbose(initResult);
  }

  success("AI integration files created");
  success("Context files initialized");

  try {
    const scanResult = await scanRepositoryContext(rootDir, { strict: options.strict });
    success("Repository scanned and context baselined");
    if (options.verbose) {
      info(`- scan files indexed: ${scanResult.index.data.totalFiles}`);
      if (scanResult.sync) {
        info(`- ai-context: ${path.relative(rootDir, scanResult.sync.contextPath)} (${scanResult.sync.bytes} bytes)`);
      }
    }
  } catch (scanError) {
    printStepError("scan", scanError);
    process.exit(getExitCodeForError(scanError));
    return;
  }

  info("Initialization complete. Run 'awesome-context-engine auto' to start optional watcher syncing.");
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
    success("Repository scanned");
    success("AI context synced");
    if (options.verbose) {
      info(`- scan files indexed: ${scanResult.index.data.totalFiles}`);
      if (scanResult.sync) {
        info(`- ai-context: ${path.relative(rootDir, scanResult.sync.contextPath)} (${scanResult.sync.bytes} bytes)`);
      }
    }
  } catch (stepError) {
    printStepError("scan", stepError);
    process.exit(getExitCodeForError(stepError));
    return;
  }

  console.log();
  secondary("Next:");
  secondary("  Open Copilot, Claude, Cline, Continue, or Codex chat and start coding.");
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
      case "memory": {
        await runMemoryCommand(rootDir, options, commandArgs, kvArgs);
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
