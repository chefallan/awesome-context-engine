import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type GitChangeSource = "staged" | "working-tree" | "status" | "last-commit";

const IGNORED_CHANGE_PREFIXES = [".awesome-context/", "dist/"];

type CleanCommitType = "new" | "update" | "remove" | "security" | "setup" | "chore" | "test" | "docs" | "release";

type GitChangeStatus = "A" | "M" | "D" | "R" | "C" | "U" | "?";

type GitChange = {
  path: string;
  status: GitChangeStatus;
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

async function getChangePatchText(
  rootDir: string,
  source: GitChangeSource,
  files: string[],
  lastCommitHash: string
): Promise<string> {
  if (files.length === 0) {
    return "";
  }

  const gitFiles = files.map((file) => normalizePath(file));

  if (source === "staged") {
    return runGit(rootDir, ["diff", "--cached", "--unified=0", "--", ...gitFiles]);
  }
  if (source === "working-tree") {
    return runGit(rootDir, ["diff", "--unified=0", "--", ...gitFiles]);
  }
  if (source === "last-commit") {
    return runGit(rootDir, ["show", "--format=", "--unified=0", lastCommitHash, "--", ...gitFiles]);
  }

  return "";
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

function inferAction(files: string[]): string {
  const concreteSummary = inferConcreteChangeSummary(files);
  if (concreteSummary) {
    return concreteSummary.action;
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

async function getDiffMetrics(rootDir: string, source: GitChangeSource, changes: GitChange[]): Promise<DiffMetrics> {
  let additions = 0;
  let deletions = 0;

  if (source === "staged") {
    const raw = await runGit(rootDir, ["diff", "--numstat", "--cached"]);
    ({ additions, deletions } = parseNumStat(raw));
  } else if (source === "working-tree") {
    const raw = await runGit(rootDir, ["diff", "--numstat"]);
    ({ additions, deletions } = parseNumStat(raw));
  } else if (source === "last-commit") {
    const lastCommit = await getLastCommitInfo(rootDir);
    const raw = await runGit(rootDir, ["show", "--numstat", "--format=", lastCommit.hash]);
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

function inferDeliverySummary(files: string[]): string {
  const normalized = files.map((file) => normalizePath(file).toLowerCase());
  const themes: string[] = [];

  if (normalized.some((file) => file.startsWith("src/"))) {
    themes.push("core CLI logic");
  }
  if (normalized.includes("readme.md") || normalized.some((file) => file.startsWith("docs/"))) {
    themes.push("developer documentation");
  }
  if (normalized.some((file) => file.startsWith(".github/workflows/"))) {
    themes.push("automation workflow");
  }
  if (normalized.some((file) => file === "package.json" || file.endsWith("-lock.json"))) {
    themes.push("package configuration");
  }
  if (normalized.some((file) => file.startsWith("tests/") || file.includes(".test.") || file.includes(".spec."))) {
    themes.push("test coverage");
  }

  if (themes.length === 0) {
    return "repository-level updates";
  }

  return toHumanList(themes.slice(0, 3));
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

async function getChangedFiles(rootDir: string): Promise<{ source: GitChangeSource; files: string[]; changes: GitChange[] }> {
  const stagedRaw = await runGit(rootDir, ["diff", "--name-status", "--cached"]);
  const stagedChanges = parseNameStatusOutput(stagedRaw);
  if (stagedChanges.length > 0) {
    const filteredChanges = filterIgnoredGitChanges(stagedChanges);
    if (filteredChanges.length > 0) {
      return {
        source: "staged",
        files: filterIgnoredChanges(unique(filteredChanges.map((change) => normalizePath(change.path)))),
        changes: filteredChanges
      };
    }
  }

  const workingTreeRaw = await runGit(rootDir, ["diff", "--name-status"]);
  const workingTreeChanges = parseNameStatusOutput(workingTreeRaw);
  if (workingTreeChanges.length > 0) {
    const filteredChanges = filterIgnoredGitChanges(workingTreeChanges);
    if (filteredChanges.length > 0) {
      return {
        source: "working-tree",
        files: filterIgnoredChanges(unique(filteredChanges.map((change) => normalizePath(change.path)))),
        changes: filteredChanges
      };
    }
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
  if (filteredStatusChanges.length === 0) {
    const lastCommit = await getLastCommitInfo(rootDir);
    const lastCommitRaw = await runGit(rootDir, ["show", "--name-status", "--format=", lastCommit.hash]);
    const lastCommitChanges = parseNameStatusOutput(lastCommitRaw);
    const filteredLastCommitChanges = filterIgnoredGitChanges(lastCommitChanges);

    if (filteredLastCommitChanges.length === 0) {
      return {
        source: "status",
        files: [],
        changes: []
      };
    }

    return {
      source: "last-commit",
      files: filterIgnoredChanges(unique(filteredLastCommitChanges.map((change) => normalizePath(change.path)))),
      changes: filteredLastCommitChanges
    };
  }

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
  const lastCommitInfo = await getLastCommitInfo(rootDir);
  const lastCommitSubject = lastCommitInfo.subject;
  const prefix = lastCommitInfo.prefix;

  const changeSet = await getChangedFiles(rootDir);
  if (changeSet.files.length === 0) {
    throw new Error(
      "No commit-worthy changes detected (only generated files like .awesome-context/ or dist/ changed)."
    );
  }

  const patchText = await getChangePatchText(rootDir, changeSet.source, changeSet.files, lastCommitInfo.hash);
  const concreteSummary = inferConcreteChangeSummary(changeSet.files, patchText);
  const action = concreteSummary?.action ?? inferAction(changeSet.files);
  const diffMetrics = await getDiffMetrics(rootDir, changeSet.source, changeSet.changes);
  const commitType = inferCleanCommitType(changeSet.changes);
  const scope = inferScope(changeSet.changes, commitType);
  const breakingRequested = Boolean(options.breaking);
  const breakingSupported = canUseBreakingMarker(commitType);
  const breaking = breakingRequested && breakingSupported;
  const deliverySummary = inferDeliverySummary(changeSet.files);

  const title = toCleanCommitTitle(commitType, action, scope, breaking);
  const description = concreteSummary?.highlights.length
    ? [...concreteSummary.highlights]
    : [
        inferIntent(commitType, action),
        `Delivery summary: ${deliverySummary}.`
      ];

  if (!concreteSummary) {
    description.push(`Change scope: ${changeSet.files.length} file(s), +${diffMetrics.additions} / -${diffMetrics.deletions} lines.`);
  }

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
    basedOn: {
      hash: lastCommitInfo.hash,
      subject: lastCommitSubject,
      prefix
    }
  };
}
