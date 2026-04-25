#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { runTokenBenchmark } from "./benchmark.js";
import { generateCommitMessageSuggestion } from "./commit-message.js";
import { runDoctor } from "./doctor.js";
import { initProject, type InitResult } from "./init.js";
import { indexProject } from "./indexer.js";
import { syncContext } from "./sync.js";
import { getExitCodeForError } from "./strict-mode.js";
import { getContextPaths } from "./templates.js";
import { confirmPrompt, error, heading, info, secondary, success, warning } from "./ui.js";
import { ensureVscodeAutoTask } from "./vscodeTask.js";
import { startAutoMode } from "./watcher.js";

type Command = "init" | "index" | "sync" | "auto" | "doctor" | "benchmark" | "commit-msg" | "help";

type CliOptions = {
  yes: boolean;
  noVscodeTask: boolean;
  verbose: boolean;
  json: boolean;
  compact: boolean;
  strict: boolean;
  breaking: boolean;
};

type ParsedCli = {
  command: Command | null;
  options: CliOptions;
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
    noVscodeTask: false,
    verbose: false,
    json: false,
    compact: false,
    strict: false,
    breaking: false
  };

  let command: Command | null = null;
  const args = argv.slice(2);

  for (const rawArg of args) {
    const arg = rawArg.trim();
    if (!arg) {
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      options.yes = true;
      continue;
    }
    if (arg === "--no-vscode-task") {
      options.noVscodeTask = true;
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
    if (arg === "--breaking") {
      options.breaking = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      command = "help";
      continue;
    }

    if (arg.startsWith("-")) {
      command = "help";
      continue;
    }

    if (!command) {
      if (["init", "index", "sync", "auto", "doctor", "benchmark", "commit-msg", "help"].includes(arg)) {
        command = arg as Command;
      } else {
        command = "help";
      }
    }
  }

  return { command, options };
}

function printHelp(): void {
  heading("awesome-context-engine");
  console.log(`
Portable repo memory for AI coding agents.

Usage:
  awesome-context-engine            First-run setup or quick sync
  awesome-context-engine init       Initialize core context files
  awesome-context-engine index      Update project-map.md only
  awesome-context-engine sync       Regenerate ai-context.md only
  awesome-context-engine auto       Watch mode: index + sync on changes
  awesome-context-engine doctor     Check setup health
  awesome-context-engine benchmark  Estimate token savings (raw vs ai-context)
  awesome-context-engine commit-msg Suggest Clean Commit title/body from git changes

Flags:
  --yes, -y           Skip prompts and use defaults
  --no-vscode-task    Do not create VS Code auto task
  --verbose           Show detailed logs
  --json              Output doctor results as JSON
  --compact           Output compact JSON (use with --json)
  --strict            Fail sync when secret-like content is detected before redaction
  --breaking          Add Clean Commit breaking marker (!) for commit-msg when valid
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

async function maybeEnableVscodeTask(rootDir: string, options: CliOptions, promptMessage: string): Promise<boolean> {
  if (options.noVscodeTask) {
    return false;
  }

  const enableTask = await confirmPrompt(promptMessage, true, options.yes);
  if (!enableTask) {
    return false;
  }

  await ensureVscodeAutoTask(rootDir);
  return true;
}

async function runInitCommand(rootDir: string, options: CliOptions): Promise<void> {
  const shouldInstallTask = options.noVscodeTask
    ? false
    : await confirmPrompt(
        "Enable automatic syncing when this workspace opens in VS Code?",
        true,
        options.yes
      );

  const initResult = await initProject(rootDir, { installVscodeTask: shouldInstallTask });
  if (options.verbose) {
    printInitVerbose(initResult);
  }

  success("AI integration files created");
  success("Context files initialized");
  if (shouldInstallTask) {
    success("VS Code auto task installed");
  } else {
    warning("VS Code auto task skipped");
  }
  info("Initialization complete. Run 'awesome-context-engine auto' or reopen VS Code to start automatic syncing.");
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
    const initResult = await initProject(rootDir, { installVscodeTask: false });
    if (options.verbose) {
      printInitVerbose(initResult);
    }
    success("Context files created");
  } catch (stepError) {
    printStepError("init", stepError);
    return;
  }

  try {
    await indexProject(rootDir);
    success("Project indexed");
  } catch (stepError) {
    printStepError("index", stepError);
    return;
  }

  try {
    await syncContext(rootDir, { strict: options.strict });
    success("AI context synced");
  } catch (stepError) {
    printStepError("sync", stepError);
    process.exit(getExitCodeForError(stepError));
    return;
  }

  try {
    const enabledTask = await maybeEnableVscodeTask(
      rootDir,
      options,
      "Enable automatic syncing when this workspace opens in VS Code?"
    );
    if (enabledTask) {
      success("VS Code auto task installed");
    } else {
      warning("VS Code auto task skipped");
    }
  } catch (stepError) {
    printStepError("vscode-task", stepError);
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

async function runCommitMessageCommand(rootDir: string, options: CliOptions): Promise<void> {
  const result = await generateCommitMessageSuggestion(rootDir, { breaking: options.breaking });

  if (options.json) {
    const indent = options.compact ? undefined : 2;
    console.log(
      JSON.stringify(
        {
          command: "commit-msg",
          rootDir,
          ...result
        },
        null,
        indent
      )
    );
    return;
  }

  heading("Commit Message Suggestion");
  info(`Title: ${result.title}`);
  console.log();
  secondary("Description:");
  for (const line of result.description) {
    secondary(`- ${line}`);
  }

  if (options.verbose) {
    console.log();
    secondary(`Source: ${result.source}`);
    secondary(`Based on: ${result.basedOn.subject}`);
    secondary(`Changed files: ${result.changedFiles.join(", ")}`);
  }
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const parsed = parseCli(process.argv);
  const command = parsed.command;
  const options = parsed.options;

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
      case "sync": {
        const result = await syncContext(rootDir, { strict: options.strict });
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
      case "commit-msg": {
        await runCommitMessageCommand(rootDir, options);
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
