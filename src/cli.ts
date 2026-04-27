#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runTokenBenchmark } from "./benchmark.js";
import { generateCommitMessageSuggestion } from "./commit-message.js";
import { checkGhCopilotReadiness, loginWithGh } from "./github-copilot.js";
import { runDoctor } from "./doctor.js";
import { generateEodReport } from "./eod-report.js";
import { initProject, type InitResult } from "./init.js";
import { indexProject } from "./indexer.js";
import { scanRepositoryContext } from "./scan.js";
import { syncContext } from "./sync.js";
import { getExitCodeForError } from "./strict-mode.js";
import { getContextPaths } from "./templates.js";
import { confirmPrompt, error, heading, info, secondary, success, warning } from "./ui.js";
import { ensureVscodeAutoTask } from "./vscodeTask.js";
import { startAutoMode } from "./watcher.js";

const execFileAsync = promisify(execFile);

type Command = "init" | "index" | "scan" | "sync" | "auto" | "doctor" | "benchmark" | "commit-msg" | "eod-report" | "version" | "help";

type CliOptions = {
  yes: boolean;
  noVscodeTask: boolean;
  verbose: boolean;
  json: boolean;
  compact: boolean;
  strict: boolean;
  breaking: boolean;
  dryRun: boolean;
};

type ParsedCli = {
  command: Command | null;
  options: CliOptions;
  commandArgs: string[];
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
    breaking: false,
    dryRun: false
  };

  let command: Command | null = null;
  const commandArgs: string[] = [];
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
    if (arg === "--dry-run") {
      options.dryRun = true;
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
      if (["init", "index", "scan", "sync", "auto", "doctor", "benchmark", "commit-msg", "eod-report", "version", "help"].includes(arg)) {
        command = arg as Command;
      } else {
        command = "help";
      }
      continue;
    }

    commandArgs.push(arg);
  }

  return { command, options, commandArgs };
}

function printHelp(): void {
  heading("awesome-context-engine");
  console.log(`
Portable repo memory for AI coding agents.

Usage:
  awesome-context-engine            First-run setup or quick sync
  awesome-context-engine init       Initialize core context files
  awesome-context-engine index      Update project-map.md only
  awesome-context-engine scan       Scan repository and baseline context files
  awesome-context-engine sync       Regenerate ai-context.md only
  awesome-context-engine auto       Watch mode: index + sync on changes
  awesome-context-engine doctor     Check setup health
  awesome-context-engine benchmark  Estimate token savings (raw vs ai-context)
  awesome-context-engine commit-msg Suggest Clean Commit title/body for EOD reporting
  awesome-context-engine eod-report <date>  Generate EOD report from commits (YYYY-MM-DD)
  awesome-context-engine version    Show running/project/global/latest versions

Flags:
  --yes, -y           Skip prompts and use defaults
  --no-vscode-task    Do not create VS Code auto task
  --verbose           Show detailed logs
  --json              Output doctor results as JSON
  --compact           Output compact JSON (use with --json)
  --strict            Fail sync when secret-like content is detected before redaction
  --breaking          Add Clean Commit breaking marker (!) for commit-msg when valid
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

async function resolveGitHubToken(): Promise<string | undefined> {
  if (process.env.ANTHROPIC_API_KEY) {
    return undefined;
  }

  const readiness = await checkGhCopilotReadiness();

  if (readiness.state === "ready") {
    return readiness.token;
  }

  if (readiness.state === "needs-login") {
    const want = await confirmPrompt(
      "Login with GitHub to use Copilot AI for commit messages?",
      true
    );
    if (!want) return undefined;
    const token = await loginWithGh();
    return token ?? undefined;
  }

  return undefined;
}

async function runCommitMessageCommand(rootDir: string, options: CliOptions): Promise<void> {
  const githubToken = await resolveGitHubToken();
  const result = await generateCommitMessageSuggestion(rootDir, { breaking: options.breaking, githubToken });

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

async function runEodReportCommand(rootDir: string, options: CliOptions, commandArgs: string[]): Promise<void> {
  const dateArg = commandArgs[0];
  const result = await generateEodReport(rootDir, dateArg);

  if (options.json) {
    const indent = options.compact ? undefined : 2;
    console.log(
      JSON.stringify(
        {
          command: "eod-report",
          rootDir,
          ...result
        },
        null,
        indent
      )
    );
    return;
  }

  heading(`EOD Summary (${result.date})`);
  for (const line of result.executiveSummary) {
    console.log(`- ${line}`);
  }

  const types = Object.entries(result.commitTypeBreakdown).sort((a, b) => b[1] - a[1]);
  if (types.length > 0) {
    console.log("- Commit type mix:");
    for (const [type, count] of types) {
      console.log(`  - ${type}: ${count}`);
    }
  }

  console.log("- Detailed commit outcomes:");
  if (result.summaryBullets.length === 0) {
    console.log("  - No commits found for this date.");
    return;
  }

  for (const bullet of result.summaryBullets) {
    console.log(`  - ${bullet}`);
  }
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
      case "eod-report": {
        await runEodReportCommand(rootDir, options, commandArgs);
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
