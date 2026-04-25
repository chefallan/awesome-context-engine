import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type GitChangeSource = "staged" | "working-tree" | "status";

const IGNORED_CHANGE_PREFIXES = [".awesome-context/", "dist/"];

type CleanCommitType = "new" | "update" | "remove" | "security" | "setup" | "chore" | "test" | "docs" | "release";

type GitChangeStatus = "A" | "M" | "D" | "R" | "C" | "U" | "?";

type GitChange = {
  path: string;
  status: GitChangeStatus;
};

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
  subject: string;
  prefix: string;
};

export type CommitMessageOptions = {
  breaking?: boolean;
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
};

function normalizePath(input: string): string {
  return input.replace(/\\/g, "/");
}

async function runGit(rootDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: rootDir });
  return String(stdout ?? "").trim();
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
  const filtered = files.filter((file) => {
    const normalized = normalizePath(file);
    return !IGNORED_CHANGE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  });

  return filtered.length > 0 ? filtered : files;
}

function filterIgnoredGitChanges(changes: GitChange[]): GitChange[] {
  const filtered = changes.filter((change) => {
    const normalized = normalizePath(change.path);
    return !IGNORED_CHANGE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  });

  return filtered.length > 0 ? filtered : changes;
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

function inferAction(files: string[]): string {
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

function inferCleanCommitType(changes: GitChange[]): CleanCommitType {
  const files = changes.map((change) => normalizePath(change.path).toLowerCase());

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

async function getChangedFiles(rootDir: string): Promise<{ source: GitChangeSource; files: string[]; changes: GitChange[] }> {
  const stagedRaw = await runGit(rootDir, ["diff", "--name-status", "--cached"]);
  const stagedChanges = parseNameStatusOutput(stagedRaw);
  if (stagedChanges.length > 0) {
    const filteredChanges = filterIgnoredGitChanges(stagedChanges);
    return {
      source: "staged",
      files: filterIgnoredChanges(unique(filteredChanges.map((change) => normalizePath(change.path)))),
      changes: filteredChanges
    };
  }

  const workingTreeRaw = await runGit(rootDir, ["diff", "--name-status"]);
  const workingTreeChanges = parseNameStatusOutput(workingTreeRaw);
  if (workingTreeChanges.length > 0) {
    const filteredChanges = filterIgnoredGitChanges(workingTreeChanges);
    return {
      source: "working-tree",
      files: filterIgnoredChanges(unique(filteredChanges.map((change) => normalizePath(change.path)))),
      changes: filteredChanges
    };
  }

  const statusRaw = await runGit(rootDir, ["status", "--porcelain"]);
  const statusFiles = statusRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const candidate = line.length > 3 ? line.slice(3) : "";
      const renamed = candidate.includes(" -> ") ? candidate.split(" -> ").at(-1) ?? candidate : candidate;
      return normalizePath(renamed.trim());
    })
    .filter(Boolean);

  const statusChanges = statusFiles.map((file) => ({ path: file, status: "?" as GitChangeStatus }));
  const filteredStatusChanges = filterIgnoredGitChanges(statusChanges);
  return {
    source: "status",
    files: filterIgnoredChanges(unique(filteredStatusChanges.map((change) => normalizePath(change.path)))),
    changes: filteredStatusChanges
  };
}

export async function generateCommitMessageSuggestion(
  rootDir: string,
  options: CommitMessageOptions = {}
): Promise<CommitMessageSuggestion> {
  const subject = await runGit(rootDir, ["log", "-1", "--pretty=%s"]);
  const lastCommitSubject = subject || "chore: repository update";
  const prefix = parsePrefixFromSubject(lastCommitSubject);

  const changeSet = await getChangedFiles(rootDir);
  if (changeSet.files.length === 0) {
    throw new Error("No changed files detected. Make changes or stage files before generating a commit message.");
  }

  const action = inferAction(changeSet.files);
  const topAreas = getTopAreas(changeSet.files);
  const topFilesPreview = changeSet.files.slice(0, 6).join(", ");
  const extraCount = Math.max(0, changeSet.files.length - 6);
  const commitType = inferCleanCommitType(changeSet.changes);
  const scope = inferScope(changeSet.changes, commitType);
  const breakingRequested = Boolean(options.breaking);
  const breakingSupported = canUseBreakingMarker(commitType);
  const breaking = breakingRequested && breakingSupported;

  const title = toCleanCommitTitle(commitType, action, scope, breaking);
  const description = [
    `Use Clean Commit format: <emoji> <type>${scope ? " (<scope>)" : ""}${breaking ? "!" : ""}: <description>.`,
    `Detected type: ${commitType}.`,
    getBreakingNote(breakingRequested, breakingSupported, commitType),
    `Update ${changeSet.files.length} file(s) from ${changeSet.source} changes.`,
    `Touch areas: ${topAreas.join(", ")}.`,
    `Changed files: ${topFilesPreview}${extraCount > 0 ? ` (+${extraCount} more)` : ""}.`,
    `Reference previous commit: \"${lastCommitSubject}\".`
  ];

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
    basedOn: {
      subject: lastCommitSubject,
      prefix
    }
  };
}
