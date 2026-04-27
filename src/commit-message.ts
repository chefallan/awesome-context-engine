import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { generateWithGitHubCopilot } from "./github-copilot.js";

const execFileAsync = promisify(execFile);

type GitChangeSource = "workspace" | "initial-workspace" | "last-commit";

const IGNORED_CHANGE_PREFIXES = [".awesome-context/", "dist/"];

type CleanCommitType = "new" | "update" | "remove" | "security" | "setup" | "chore" | "test" | "docs" | "release";

type GitChangeStatus = "A" | "M" | "D" | "R" | "C" | "U" | "?";

type GitChange = {
  path: string;
  status: GitChangeStatus;
};

type GitHistoryInfo = {
  hasCommits: boolean;
  basedOn: LastCommitInfo;
  diffBase: string | null;
};

type DiffMetrics = {
  additions: number;
  deletions: number;
  addedFiles: number;
  modifiedFiles: number;
  deletedFiles: number;
  renamedFiles: number;
};

type RiskLevel = "low" | "medium" | "high";

const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const CLEAN_COMMIT_EMOJI: Record<CleanCommitType, string> = {
  new: "📦",
  update: "🔧",
  remove: "🗑️",
  security: "🔒",
  setup: "⚙️",
  chore: "☕",
  test: "🧪",
  docs: "📖",
  release: "🚀"
};

type LastCommitInfo = {
  hash: string;
  subject: string;
  prefix: string;
};

export type CommitMessageOptions = {
  breaking?: boolean;
  githubToken?: string;
};

export type CommitMessageSuggestion = {
  standard: "clean-commit";
  title: string;
  description: string[];
  changedFiles: string[];
  source: GitChangeSource;
  type: CleanCommitType;
  scope?: string;
  breakingRequested: boolean;
  breakingSupported: boolean;
  breaking: boolean;
  basedOn: LastCommitInfo;
  aiProvider: "anthropic" | "github-copilot" | "heuristic";
  copilotFailureReason?: "no-subscription" | "api-error" | "parse-error";
};

function normalizePath(input: string): string {
  return input.replace(/\\/g, "/");
}

async function runGit(rootDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: rootDir });
  return String(stdout ?? "").trim();
}

function isNoCommitHistoryError(error: unknown): boolean {
  const message = (error as Error)?.message ?? "";
  const stderr = typeof (error as { stderr?: unknown })?.stderr === "string" ? (error as { stderr: string }).stderr : "";
  const combined = `${message}\n${stderr}`.toLowerCase();

  return [
    "does not have any commits yet",
    "bad revision 'head'",
    "ambiguous argument 'head'",
    "needed a single revision"
  ].some((needle) => combined.includes(needle));
}

function parsePrefixFromSubject(subject: string): string {
  const cleanCommitMatch = subject.match(/^[^\s]+\s+([a-z]+)(?:\s*\([^)]+\))?!?:\s+/i);
  if (cleanCommitMatch) {
    return cleanCommitMatch[1].toLowerCase();
  }

  const conventionalMatch = subject.match(/^([a-z]+(?:\([^\)]+\))?!?):\s+/i);
  if (conventionalMatch) {
    return conventionalMatch[1].toLowerCase();
  }

  return "chore";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function filterIgnoredChanges(files: string[]): string[] {
  return files.filter((file) => {
    const normalized = normalizePath(file);
    return !IGNORED_CHANGE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  });
}

function filterIgnoredGitChanges(changes: GitChange[]): GitChange[] {
  return changes.filter((change) => {
    const normalized = normalizePath(change.path);
    return !IGNORED_CHANGE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  });
}

function isVersionOnlySubject(subject: string): boolean {
  const trimmed = subject.trim();
  return /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(trimmed);
}

async function getLastCommitInfo(rootDir: string): Promise<LastCommitInfo> {
  const history = await runGit(rootDir, ["log", "-20", "--pretty=%H%x09%s"]);
  const entries = history
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, ...subjectParts] = line.split("\t");
      return {
        hash: (hash ?? "").trim(),
        subject: subjectParts.join("\t").trim()
      };
    })
    .filter((entry) => entry.hash && entry.subject);

  const selected = entries.find((entry) => !isVersionOnlySubject(entry.subject)) ?? entries[0] ?? {
    hash: "HEAD",
    subject: "chore: repository update"
  };

  return {
    hash: selected.hash,
    subject: selected.subject,
    prefix: parsePrefixFromSubject(selected.subject)
  };
}

async function getGitHistoryInfo(rootDir: string): Promise<GitHistoryInfo> {
  try {
    await runGit(rootDir, ["rev-parse", "--verify", "HEAD"]);
    const basedOn = await getLastCommitInfo(rootDir);
    return {
      hasCommits: true,
      basedOn,
      diffBase: "HEAD"
    };
  } catch (error) {
    if (!isNoCommitHistoryError(error)) {
      throw error;
    }

    return {
      hasCommits: false,
      basedOn: {
        hash: EMPTY_TREE_HASH,
        subject: "initial workspace snapshot (no commits yet)",
        prefix: "setup"
      },
      diffBase: EMPTY_TREE_HASH
    };
  }
}

function getTopAreas(files: string[]): string[] {
  const counts = new Map<string, number>();

  for (const file of files) {
    const normalized = normalizePath(file);
    const area = normalized.includes("/") ? normalized.split("/")[0] : "root";
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([area]) => area)
    .slice(0, 3);
}

type ConcreteChangeSummary = {
  action: string;
  highlights: string[];
};

type FocusKind = "command" | "script" | "config" | "function" | "class" | "type" | "interface";

type FocusCandidate = {
  kind: FocusKind;
  label: string;
  score: number;
};

const KNOWN_COMMANDS = new Set([
  "init",
  "index",
  "scan",
  "sync",
  "auto",
  "doctor",
  "benchmark",
  "commit-msg",
  "eod-report",
  "version",
  "help"
]);

const KNOWN_SCRIPT_KEYS = new Set(["build", "dev", "start", "test", "lint", "release", "prepare", "prepublishOnly"]);

const GENERIC_CONFIG_KEYS = new Set([
  "name",
  "version",
  "description",
  "author",
  "license",
  "files",
  "keywords",
  "main",
  "type",
  "bin",
  "scripts",
  "dependencies",
  "devDependencies",
  "engines",
  "compilerOptions",
  "include",
  "exclude"
]);

const GENERIC_SYMBOL_NAMES = new Set([
  "data",
  "result",
  "results",
  "item",
  "items",
  "value",
  "values",
  "options",
  "option",
  "config",
  "default",
  "rootDir",
  "file",
  "files",
  "line",
  "lines",
  "message",
  "messages"
]);

async function getChangePatchText(
  rootDir: string,
  source: GitChangeSource,
  files: string[],
  diffBase: string | null
): Promise<string> {
  if (files.length === 0) {
    return "";
  }

  const gitFiles = files.map((file) => normalizePath(file));

  if (source === "workspace" && diffBase) {
    return runGit(rootDir, ["diff", "--unified=0", diffBase, "--", ...gitFiles]);
  }
  if (source === "last-commit" && diffBase) {
    return runGit(rootDir, ["show", "--format=", "--unified=0", diffBase, "--", ...gitFiles]);
  }

  return "";
}

function parsePorcelainPath(line: string): string {
  const candidate = line.length > 3 ? line.slice(3) : "";
  const renamed = candidate.includes(" -> ") ? candidate.split(" -> ").at(-1) ?? candidate : candidate;
  return normalizePath(renamed.trim());
}

function parseUntrackedStatusChanges(raw: string): GitChange[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("?? "))
    .map((line) => ({
      path: parsePorcelainPath(line),
      status: "?" as GitChangeStatus
    }))
    .filter((change) => Boolean(change.path));
}

async function fileExists(rootDir: string, relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, normalizePath(relativePath)));
    return true;
  } catch {
    return false;
  }
}

async function getInitialWorkspaceChanges(rootDir: string, statusRaw: string): Promise<GitChange[]> {
  const candidates = statusRaw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(parsePorcelainPath)
    .filter(Boolean);

  const existing = await Promise.all(
    candidates.map(async (candidate) => ({
      path: candidate,
      exists: await fileExists(rootDir, candidate)
    }))
  );

  return existing.filter((entry) => entry.exists).map((entry) => ({ path: entry.path, status: "A" as GitChangeStatus }));
}

function mergeChanges(primary: GitChange[], additional: GitChange[]): GitChange[] {
  const seen = new Set(primary.map((change) => normalizePath(change.path)));
  const merged = [...primary];

  for (const change of additional) {
    const normalized = normalizePath(change.path);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    merged.push(change);
  }

  return merged;
}

function inferConcreteChangeSummary(files: string[], diffText = ""): ConcreteChangeSummary | null {
  const normalized = files.map((file) => normalizePath(file).toLowerCase());
  const hasScanModule = normalized.includes("src/scan.ts");
  const hasCommitMessageModule = normalized.includes("src/commit-message.ts");
  const hasCli = normalized.includes("src/cli.ts");
  const hasIndexer = normalized.includes("src/indexer.ts");
  const hasReadme = normalized.includes("readme.md");
  const hasDocsSite = normalized.some((file) => file.startsWith("docs/"));
  const hasPackageConfig = normalized.includes("package.json") || normalized.includes("package-lock.json");
  const lowerDiff = diffText.toLowerCase();

  if (
    hasCommitMessageModule &&
    (lowerDiff.includes("latest meaningful commit") ||
      lowerDiff.includes("last-commit") ||
      lowerDiff.includes("getlastcommitinfo") ||
      lowerDiff.includes("commit-msg") ||
      lowerDiff.includes("concretechangesummary"))
  ) {
    const highlights = [
      "Makes `commit-msg` fall back to the latest meaningful commit when the working tree is clean.",
      "Uses latest-commit metadata and diff parsing so generated summaries describe the actual change instead of generic file-area labels."
    ];

    if (hasReadme || hasDocsSite) {
      highlights.push("Updates README and docs to explain the automatic latest-commit fallback for `commit-msg`.");
    }

    return {
      action: "make commit-msg auto-summarize latest commits",
      highlights
    };
  }

  if (hasScanModule) {
    const highlights = [
      "Adds a new `scan` command to baseline repository context for existing codebases."
    ];

    if (hasCli) {
      highlights.push("Updates CLI onboarding so `init` runs the baseline scan automatically.");
      highlights.push("Adds `scan --dry-run` preview mode for no-write repository analysis.");
    }

    if (hasIndexer) {
      highlights.push("Extends indexing so scan previews can analyze the repository without writing output files.");
    }

    if (hasReadme || hasDocsSite) {
      highlights.push("Refreshes README and docs so scan onboarding and preview behavior are documented.");
    }

    if (hasPackageConfig) {
      highlights.push("Updates package metadata to ship the new scan capability.");
    }

    return {
      action: "add repository scan and dry-run preview",
      highlights
    };
  }

  return null;
}

function addFocusCandidate(candidates: Map<string, FocusCandidate>, kind: FocusKind, rawLabel: string, score: number): void {
  const label = rawLabel.trim().replace(/^['"`]+|['"`]+$/g, "");
  if (!label || label.length < 2) {
    return;
  }

  const normalizedKey = `${kind}:${label.toLowerCase()}`;
  if (["function", "class", "type", "interface"].includes(kind) && GENERIC_SYMBOL_NAMES.has(label)) {
    return;
  }

  const existing = candidates.get(normalizedKey);
  if (existing) {
    existing.score += score;
    return;
  }

  candidates.set(normalizedKey, { kind, label, score });
}

function extractFocusFromDiff(files: string[], diffText: string): FocusCandidate | null {
  if (!diffText.trim()) {
    return null;
  }

  const candidates = new Map<string, FocusCandidate>();
  const addedScriptKeys = new Set<string>();
  const removedScriptKeys = new Set<string>();
  const normalizedFiles = files.map((file) => normalizePath(file).toLowerCase());
  const touchesPackageJson = normalizedFiles.includes("package.json");
  const touchesConfig = normalizedFiles.some((file) => file === "package.json" || file === "tsconfig.json" || file.startsWith(".github/"));

  for (const line of diffText.split(/\r?\n/)) {
    if (!/^[+-]/.test(line) || /^(\+\+\+|---|@@)/.test(line)) {
      continue;
    }

    const weight = line.startsWith("+") ? 3 : 1;
    const code = line.slice(1).trim();
    if (!code) {
      continue;
    }

    const commandMatch = code.match(/\b(?:case|command(?:Id)?)\s*[: ]\s*["'`]([a-z0-9-]+)["'`]/i);
    if (commandMatch && KNOWN_COMMANDS.has(commandMatch[1])) {
      addFocusCandidate(candidates, "command", commandMatch[1], weight + 4);
    }

    const cliCommandMatch = code.match(/awesome-context-engine\s+([a-z0-9-]+)/i);
    if (cliCommandMatch && KNOWN_COMMANDS.has(cliCommandMatch[1])) {
      addFocusCandidate(candidates, "command", cliCommandMatch[1], weight + 3);
    }

    const functionPatterns = [
      /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/,
      /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)\s*=>/
    ];
    for (const pattern of functionPatterns) {
      const match = code.match(pattern);
      if (match) {
        addFocusCandidate(candidates, "function", match[1], weight + 2);
      }
    }

    const classMatch = code.match(/(?:export\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (classMatch) {
      addFocusCandidate(candidates, "class", classMatch[1], weight + 2);
    }

    const interfaceMatch = code.match(/interface\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (interfaceMatch) {
      addFocusCandidate(candidates, "interface", interfaceMatch[1], weight + 1);
    }

    const typeMatch = code.match(/type\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (typeMatch) {
      addFocusCandidate(candidates, "type", typeMatch[1], weight + 1);
    }

    const jsonKeyMatch = code.match(/^"([A-Za-z0-9:_-]+)"\s*:/);
    if (jsonKeyMatch) {
      const key = jsonKeyMatch[1];
      if (touchesPackageJson && KNOWN_SCRIPT_KEYS.has(key)) {
        if (line.startsWith("+")) {
          addedScriptKeys.add(key);
        }
        if (line.startsWith("-")) {
          removedScriptKeys.add(key);
        }
        addFocusCandidate(candidates, "script", key, weight + 4);
      } else if (touchesConfig && !GENERIC_CONFIG_KEYS.has(key)) {
        addFocusCandidate(candidates, "config", key, weight + 1);
      }
    }
  }

  const addedOnlyScripts = [...candidates.values()].filter(
    (candidate) => candidate.kind === "script" && addedScriptKeys.has(candidate.label) && !removedScriptKeys.has(candidate.label)
  );
  if (addedOnlyScripts.length > 0) {
    return addedOnlyScripts.sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))[0] ?? null;
  }

  return [...candidates.values()].sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))[0] ?? null;
}

function inferFocusedAction(type: CleanCommitType, focus: FocusCandidate): string {
  const verb = (() => {
    switch (type) {
      case "new":
        return "add";
      case "remove":
        return "remove";
      case "docs":
        return "document";
      case "security":
        return focus.kind === "config" ? "harden" : "secure";
      case "setup":
      case "chore":
        return focus.kind === "script" || focus.kind === "config" || focus.kind === "command" ? "update" : "improve";
      default:
        return focus.kind === "script" || focus.kind === "config" || focus.kind === "command" ? "update" : "improve";
    }
  })();

  if (focus.kind === "command") {
    return `${verb} ${focus.label} command`;
  }
  if (focus.kind === "script") {
    return `${verb} ${focus.label} script`;
  }
  if (focus.kind === "config") {
    return `${verb} ${focus.label.replace(/[-_]/g, " ")} config`;
  }

  return `${verb} ${focus.label}`;
}

function inferAction(files: string[], diffText: string, type: CleanCommitType): string {
  const concreteSummary = inferConcreteChangeSummary(files);
  if (concreteSummary) {
    return concreteSummary.action;
  }

  const focus = extractFocusFromDiff(files, diffText);
  if (focus) {
    return inferFocusedAction(type, focus);
  }

  const normalized = files.map((file) => normalizePath(file).toLowerCase());
  const hasSrc = normalized.some((file) => file.startsWith("src/"));
  const hasReadme = normalized.includes("readme.md");
  const hasDocs = normalized.some((file) => file.startsWith("docs/"));
  const hasWorkflow = normalized.some((file) => file.startsWith(".github/workflows/"));
  const hasPackageJson = normalized.includes("package.json") || normalized.includes("package-lock.json");

  if (hasWorkflow && !hasSrc) {
    return "improve automation workflows";
  }
  if ((hasReadme || hasDocs) && !hasSrc) {
    return "refresh documentation and guidance";
  }
  if (hasPackageJson && !hasSrc) {
    return "update package configuration";
  }
  if (hasSrc) {
    return "improve cli behavior";
  }

  return "apply repository updates";
}

function inferInitialAction(files: string[]): string {
  const normalized = files.map((file) => normalizePath(file).toLowerCase());
  const hasSrc = normalized.some((file) => file.startsWith("src/"));
  const hasReadme = normalized.includes("readme.md");
  const hasDocs = normalized.some((file) => file.startsWith("docs/"));
  const hasPackageJson = normalized.includes("package.json") || normalized.includes("package-lock.json");
  const hasConfig = normalized.some((file) =>
    ["package.json", "package-lock.json", "tsconfig.json", ".gitignore", ".npmignore"].includes(file)
  );

  if (hasSrc && hasPackageJson) {
    return "bootstrap initial project structure";
  }
  if (hasSrc && (hasReadme || hasDocs)) {
    return "create initial source and documentation";
  }
  if (hasSrc) {
    return "add initial source files";
  }
  if (hasConfig) {
    return "bootstrap repository configuration";
  }

  return "create initial repository files";
}

function parseNameStatusOutput(raw: string): GitChange[] {
  const changes: GitChange[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    const rawStatus = parts[0]?.toUpperCase() ?? "M";
    const baseStatus = rawStatus.charAt(0) as GitChangeStatus;

    if (rawStatus.startsWith("R") && parts.length >= 3) {
      changes.push({
        status: "R",
        path: normalizePath(parts[2])
      });
      continue;
    }

    if (parts.length >= 2) {
      const normalizedStatus: GitChangeStatus = ["A", "M", "D", "R", "C", "U", "?"].includes(baseStatus)
        ? baseStatus
        : "M";

      changes.push({
        status: normalizedStatus,
        path: normalizePath(parts[1])
      });
    }
  }

  return changes;
}

function parseNumStat(raw: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const parts = trimmed.split(/\t+/);
    if (parts.length < 3) {
      continue;
    }

    const add = Number.parseInt(parts[0], 10);
    const del = Number.parseInt(parts[1], 10);

    if (Number.isFinite(add)) {
      additions += add;
    }
    if (Number.isFinite(del)) {
      deletions += del;
    }
  }

  return { additions, deletions };
}

function countLines(content: string): number {
  if (!content) {
    return 0;
  }

  const normalized = content.replace(/\r\n/g, "\n");
  if (normalized.includes("\u0000")) {
    return 0;
  }

  return normalized.split("\n").length;
}

async function countCurrentFileLines(rootDir: string, files: string[]): Promise<number> {
  const counts = await Promise.all(
    files.map(async (file) => {
      try {
        const content = await fs.readFile(path.join(rootDir, normalizePath(file)), "utf8");
        return countLines(content);
      } catch {
        return 0;
      }
    })
  );

  return counts.reduce((sum, count) => sum + count, 0);
}

async function getDiffMetrics(
  rootDir: string,
  source: GitChangeSource,
  changes: GitChange[],
  diffBase: string | null
): Promise<DiffMetrics> {
  let additions = 0;
  let deletions = 0;

  if (source === "workspace" && diffBase) {
    const raw = await runGit(rootDir, ["diff", "--numstat", diffBase]);
    ({ additions, deletions } = parseNumStat(raw));
    additions += await countCurrentFileLines(
      rootDir,
      changes.filter((change) => change.status === "?").map((change) => change.path)
    );
  } else if (source === "initial-workspace") {
    additions = await countCurrentFileLines(rootDir, changes.map((change) => change.path));
  } else if (source === "last-commit" && diffBase) {
    const raw = await runGit(rootDir, ["show", "--numstat", "--format=", diffBase]);
    ({ additions, deletions } = parseNumStat(raw));
  }

  return {
    additions,
    deletions,
    addedFiles: changes.filter((change) => change.status === "A" || change.status === "?").length,
    modifiedFiles: changes.filter((change) => change.status === "M").length,
    deletedFiles: changes.filter((change) => change.status === "D").length,
    renamedFiles: changes.filter((change) => change.status === "R").length
  };
}

function formatOperationBreakdown(metrics: DiffMetrics): string {
  const chunks: string[] = [];
  if (metrics.addedFiles > 0) {
    chunks.push(`${metrics.addedFiles} added`);
  }
  if (metrics.modifiedFiles > 0) {
    chunks.push(`${metrics.modifiedFiles} modified`);
  }
  if (metrics.deletedFiles > 0) {
    chunks.push(`${metrics.deletedFiles} deleted`);
  }
  if (metrics.renamedFiles > 0) {
    chunks.push(`${metrics.renamedFiles} renamed`);
  }

  return chunks.length > 0 ? chunks.join(", ") : "file operations not classified";
}

function toHumanList(items: string[]): string {
  if (items.length === 0) {
    return "none";
  }
  if (items.length === 1) {
    return items[0];
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}


function inferIntent(type: CleanCommitType, action: string): string {
  switch (type) {
    case "new":
      return `This work introduces new capability to ${action}.`;
    case "update":
      return `This work improves existing behavior to ${action}.`;
    case "remove":
      return `This work removes obsolete or conflicting pieces to ${action}.`;
    case "security":
      return `This work hardens security-sensitive areas while ${action}.`;
    case "setup":
      return `This work updates tooling and project setup to ${action}.`;
    case "chore":
      return `This work performs maintenance-oriented changes to ${action}.`;
    case "test":
      return `This work strengthens confidence with test-focused changes to ${action}.`;
    case "docs":
      return `This work clarifies documentation and guidance to ${action}.`;
    case "release":
      return `This work prepares a release package to ${action}.`;
    default:
      return `This work updates the repository to ${action}.`;
  }
}

function inferRiskLevel(metrics: DiffMetrics, breaking: boolean, type: CleanCommitType): RiskLevel {
  if (breaking || type === "security") {
    return "high";
  }

  const totalLineDelta = metrics.additions + metrics.deletions;
  if (metrics.deletedFiles >= 2 || totalLineDelta > 500) {
    return "high";
  }
  if (metrics.deletedFiles >= 1 || totalLineDelta > 150 || metrics.renamedFiles > 0) {
    return "medium";
  }

  return "low";
}

function recommendedValidation(topAreas: string[], files: string[], type: CleanCommitType): string {
  const normalized = files.map((file) => normalizePath(file).toLowerCase());
  const checks: string[] = [];

  if (normalized.some((file) => file.startsWith("src/"))) {
    checks.push("run the build and smoke-test affected CLI commands");
  }
  if (normalized.some((file) => file.startsWith("docs/") || file === "readme.md")) {
    checks.push("verify docs examples still match actual command behavior");
  }
  if (normalized.some((file) => file.startsWith(".github/workflows/"))) {
    checks.push("validate workflow syntax and expected trigger behavior");
  }
  if (normalized.some((file) => file === "package.json" || file.endsWith("-lock.json"))) {
    checks.push("confirm install/build scripts still run on a clean environment");
  }
  if (type === "security") {
    checks.push("perform a focused security regression check on changed paths");
  }

  if (checks.length === 0) {
    checks.push("run the standard project sanity checks before merging");
  }

  return `Suggested validation: ${toHumanList(checks.slice(0, 3))}.`;
}

function inferCleanCommitType(changes: GitChange[]): CleanCommitType {
  const files = changes.map((change) => normalizePath(change.path).toLowerCase());
  const concreteSummary = inferConcreteChangeSummary(files);

  if (files.length === 0) {
    return "chore";
  }

  const allDocs = files.every((file) => file === "readme.md" || file.startsWith("docs/") || file.endsWith(".md"));
  if (allDocs) {
    return "docs";
  }

  const allTests = files.every((file) => /(^|\/)(__tests__|test|tests)\//.test(file) || /(\.test\.|\.spec\.)/.test(file));
  if (allTests) {
    return "test";
  }

  const hasSecuritySignals = files.some((file) =>
    ["security", "vuln", "cve", "auth", "token", "secret", "redact", "strict-mode"].some((needle) => file.includes(needle))
  );
  if (hasSecuritySignals) {
    return "security";
  }

  const allRemoved = changes.every((change) => change.status === "D");
  if (allRemoved) {
    return "remove";
  }

  const hasSetupSignals = files.some((file) =>
    file.startsWith(".github/") ||
    file.startsWith(".vscode/") ||
    file === "package.json" ||
    file === "package-lock.json" ||
    file === "tsconfig.json" ||
    file === ".npmrc" ||
    file === ".gitignore"
  );

  const hasSourceFiles = files.some((file) => file.startsWith("src/"));

  if (hasSetupSignals && !hasSourceFiles) {
    const hasDependencySignals = files.some((file) => file === "package.json" || file.endsWith("-lock.json"));
    return hasDependencySignals ? "chore" : "setup";
  }

  if (concreteSummary && concreteSummary.action.startsWith("add ")) {
    return "new";
  }

  const mostlyAdded = changes.filter((change) => change.status === "A").length >= Math.ceil(changes.length * 0.6);
  if (mostlyAdded) {
    return "new";
  }

  return "update";
}

function inferScope(changes: GitChange[], type: CleanCommitType): string | undefined {
  const files = changes.map((change) => normalizePath(change.path).toLowerCase());

  if (type === "docs") {
    return "docs";
  }
  if (type === "test") {
    return "test";
  }
  if (files.some((file) => file.startsWith(".github/workflows/"))) {
    return "ci";
  }
  if (files.some((file) => file.startsWith("src/commit-message"))) {
    return "commit-msg";
  }
  if (files.some((file) => file.startsWith("src/cli"))) {
    return "cli";
  }
  if (type === "chore" && files.some((file) => file === "package.json" || file.endsWith("-lock.json"))) {
    return "deps";
  }

  const topArea = getTopAreas(files).find((area) => area !== "root" && area !== ".github" && area !== "src");
  if (!topArea) {
    return undefined;
  }

  return topArea.replace(/[^a-z0-9_-]/g, "").toLowerCase() || undefined;
}

function canUseBreakingMarker(type: CleanCommitType): boolean {
  return type === "new" || type === "update" || type === "remove" || type === "security";
}

function getBreakingNote(requested: boolean, supported: boolean, type: CleanCommitType): string {
  if (requested && supported) {
    return "Breaking marker: enabled.";
  }

  if (requested && !supported) {
    return `Breaking marker requested but skipped: type '${type}' does not support '!'.`;
  }

  return "Breaking marker: disabled.";
}

function toCleanCommitTitle(type: CleanCommitType, description: string, scope?: string, breaking = false): string {
  const emoji = CLEAN_COMMIT_EMOJI[type];
  const breakingPart = breaking && canUseBreakingMarker(type) ? "!" : "";
  const scopePart = scope ? ` (${scope})` : "";
  const title = `${emoji} ${type}${scopePart}${breakingPart}: ${description}`;
  return clipTitle(title, 72);
}

function clipTitle(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }

  return `${input.slice(0, maxLength - 3).trimEnd()}...`;
}

async function getChangedFiles(
  rootDir: string,
  history: GitHistoryInfo
): Promise<{ source: GitChangeSource; files: string[]; changes: GitChange[]; diffBase: string | null }> {
  const statusRaw = await runGit(rootDir, ["status", "--porcelain", "--untracked-files=all"]);

  if (!history.hasCommits) {
    const initialChanges = await getInitialWorkspaceChanges(rootDir, statusRaw);
    const filteredInitialChanges = filterIgnoredGitChanges(initialChanges);

    return {
      source: "initial-workspace",
      files: filterIgnoredChanges(unique(filteredInitialChanges.map((change) => normalizePath(change.path)))),
      changes: filteredInitialChanges,
      diffBase: history.diffBase
    };
  }

  const trackedWorkspaceRaw = await runGit(rootDir, ["diff", "--name-status", "HEAD"]);
  const trackedWorkspaceChanges = parseNameStatusOutput(trackedWorkspaceRaw);
  const untrackedChanges = parseUntrackedStatusChanges(statusRaw);
  const workspaceChanges = mergeChanges(trackedWorkspaceChanges, untrackedChanges);
  const filteredWorkspaceChanges = filterIgnoredGitChanges(workspaceChanges);

  if (filteredWorkspaceChanges.length > 0) {
    return {
      source: "workspace",
      files: filterIgnoredChanges(unique(filteredWorkspaceChanges.map((change) => normalizePath(change.path)))),
      changes: filteredWorkspaceChanges,
      diffBase: history.diffBase
    };
  }

  const lastCommitRaw = await runGit(rootDir, ["show", "--name-status", "--format=", history.basedOn.hash]);
  const lastCommitChanges = parseNameStatusOutput(lastCommitRaw);
  const filteredLastCommitChanges = filterIgnoredGitChanges(lastCommitChanges);

  if (filteredLastCommitChanges.length === 0) {
    return {
      source: "last-commit",
      files: [],
      changes: [],
      diffBase: history.basedOn.hash
    };
  }

  return {
    source: "last-commit",
    files: filterIgnoredChanges(unique(filteredLastCommitChanges.map((change) => normalizePath(change.path)))),
    changes: filteredLastCommitChanges,
    diffBase: history.basedOn.hash
  };
}

type AICommitSummary = {
  action: string;
  highlights: string[];
};

type AIResult = {
  summary: AICommitSummary;
  provider: "anthropic" | "github-copilot";
  copilotFailureReason?: never;
} | {
  summary: null;
  provider: "heuristic";
  copilotFailureReason?: "no-subscription" | "api-error" | "parse-error";
};

async function generateWithAI(files: string[], diffText: string, githubToken?: string): Promise<AIResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (apiKey) {
    const summary = await tryAnthropic(apiKey, files, diffText);
    if (summary) return { summary, provider: "anthropic" };
  }

  if (githubToken) {
    const result = await generateWithGitHubCopilot(files, diffText, githubToken);
    if (result.ok) return { summary: { action: result.action, highlights: result.highlights }, provider: "github-copilot" };
    return { summary: null, provider: "heuristic", copilotFailureReason: result.reason };
  }

  return { summary: null, provider: "heuristic" };
}

async function tryAnthropic(apiKey: string, files: string[], diffText: string): Promise<AICommitSummary | null> {
  const truncatedDiff = diffText.length > 8000 ? `${diffText.slice(0, 8000)}\n...[diff truncated]` : diffText;
  const fileList = files.slice(0, 40).join("\n");

  const prompt = `You are writing a git commit message for a change set.

Changed files:
${fileList}

Diff:
${truncatedDiff}

Respond with JSON only — no markdown, no explanation:
{
  "action": "<4-8 word verb phrase, e.g. 'add awesome-context metadata and UI tweaks'>",
  "highlights": [
    "<specific bullet: what was added/changed/removed>",
    "<specific bullet: another key change>"
  ]
}

Rules:
- action starts with a verb (add, fix, update, refactor, remove, etc.)
- highlights name actual files, components, or features — be specific
- 2-4 highlights maximum
- do NOT use phrases like "this work", "repository-level updates", or "delivery summary"`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }]
    });

    const raw = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as { action?: unknown; highlights?: unknown };
    if (
      typeof parsed.action === "string" &&
      Array.isArray(parsed.highlights) &&
      parsed.highlights.every((h) => typeof h === "string")
    ) {
      return { action: parsed.action, highlights: parsed.highlights as string[] };
    }
    return null;
  } catch {
    return null;
  }
}

export async function generateCommitMessageSuggestion(
  rootDir: string,
  options: CommitMessageOptions = {}
): Promise<CommitMessageSuggestion> {
  const history = await getGitHistoryInfo(rootDir);
  const changeSet = await getChangedFiles(rootDir, history);
  if (changeSet.files.length === 0) {
    throw new Error(
      "No commit-worthy changes detected (only generated files like .awesome-context/ or dist/ changed)."
    );
  }

  const patchText = await getChangePatchText(rootDir, changeSet.source, changeSet.files, changeSet.diffBase);
  const [aiResult, diffMetrics] = await Promise.all([
    generateWithAI(changeSet.files, patchText, options.githubToken),
    getDiffMetrics(rootDir, changeSet.source, changeSet.changes, changeSet.diffBase)
  ]);
  const concreteSummary = aiResult.summary ?? inferConcreteChangeSummary(changeSet.files, patchText);
  const commitType = inferCleanCommitType(changeSet.changes);
  const action = concreteSummary?.action ?? (changeSet.source === "initial-workspace" ? inferInitialAction(changeSet.files) : inferAction(changeSet.files, patchText, commitType));
  const scope = inferScope(changeSet.changes, commitType);
  const breakingRequested = Boolean(options.breaking);
  const breakingSupported = canUseBreakingMarker(commitType);
  const breaking = breakingRequested && breakingSupported;

  const title = toCleanCommitTitle(commitType, action, scope, breaking);
  const description = concreteSummary?.highlights.length
    ? [...concreteSummary.highlights]
    : [
        changeSet.source === "initial-workspace"
          ? `This work captures the first commit from the current workspace to ${action}.`
          : inferIntent(commitType, action),
        `Change scope: ${changeSet.files.length} file(s), +${diffMetrics.additions} / -${diffMetrics.deletions} lines.`
      ];

  if (breakingRequested) {
    description.push(getBreakingNote(breakingRequested, breakingSupported, commitType));
  }

  return {
    standard: "clean-commit",
    title,
    description,
    changedFiles: changeSet.files,
    source: changeSet.source,
    type: commitType,
    scope,
    breakingRequested,
    breakingSupported,
    breaking,
    aiProvider: aiResult.provider,
    copilotFailureReason: aiResult.copilotFailureReason,
    basedOn: {
      hash: history.basedOn.hash,
      subject: history.basedOn.subject,
      prefix: history.basedOn.prefix
    }
  };
}
