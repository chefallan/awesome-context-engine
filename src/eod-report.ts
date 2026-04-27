import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { callGitHubModels } from "./github-copilot.js";

const execFileAsync = promisify(execFile);

type EodCommit = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  body: string;
};

type CommitDiffSummary = {
  filesChanged: number;
  additions: number;
  deletions: number;
  keyFiles: string[];
};

type EodDeliveryStats = {
  totalFilesChanged: number;
  totalAdditions: number;
  totalDeletions: number;
  commitCountByAuthor: Record<string, number>;
};

type ParsedCleanCommit = {
  type: string;
  scope?: string;
  breaking: boolean;
  description: string;
};

export type EodReportResult = {
  date: string;
  totalCommits: number;
  cleanCommitCoveragePercent: number;
  executiveSummary: string[];
  deliveryStats: EodDeliveryStats;
  commitTypeBreakdown: Record<string, number>;
  summaryBullets: string[];
  commits: Array<{
    hash: string;
    shortHash: string;
    author: string;
    date: string;
    subject: string;
    summaryDescription: string;
    cleanCommit?: ParsedCleanCommit;
    diff: CommitDiffSummary;
  }>;
  markdown: string;
};

function isValidDateInput(input: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(input);
}

function parseCleanCommitSubject(subject: string): ParsedCleanCommit | undefined {
  const match = subject.match(/^[^\s]+\s+([a-z]+)(?:\s*\(([^)]+)\))?(!)?:\s+(.+)$/i);
  if (!match) {
    return undefined;
  }

  const [, type, scopeRaw, bang, description] = match;
  return {
    type: type.toLowerCase(),
    scope: scopeRaw?.trim() || undefined,
    breaking: bang === "!",
    description: description.trim()
  };
}

function toIsoRange(date: string): { since: string; until: string } {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return {
    since: start.toISOString(),
    until: end.toISOString()
  };
}

async function runGit(rootDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: rootDir });
  return String(stdout ?? "").trim();
}

async function getCommitDiffSummary(rootDir: string, hash: string): Promise<CommitDiffSummary> {
  const raw = await runGit(rootDir, ["show", "--numstat", "--format=", hash]);
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let additions = 0;
  let deletions = 0;
  const files: string[] = [];

  for (const line of lines) {
    const parts = line.split(/\t+/);
    if (parts.length < 3) {
      continue;
    }

    const [addRaw, delRaw, filePath] = parts;
    const add = Number.parseInt(addRaw, 10);
    const del = Number.parseInt(delRaw, 10);

    if (Number.isFinite(add)) {
      additions += add;
    }
    if (Number.isFinite(del)) {
      deletions += del;
    }

    files.push(filePath);
  }

  return {
    filesChanged: files.length,
    additions,
    deletions,
    keyFiles: files.slice(0, 4)
  };
}

function parseGitLogOutput(raw: string): EodCommit[] {
  if (!raw.trim()) {
    return [];
  }

  const records = raw
    .split("\u001e")
    .map((record) => record.trim())
    .filter(Boolean);

  return records
    .map((record) => {
      const fields = record.split("\u001f");
      if (fields.length < 6) {
        return null;
      }

      const [hash, shortHash, author, date, subject, body] = fields;
      return {
        hash,
        shortHash,
        author,
        date,
        subject: subject.trim(),
        body: body.trim()
      } satisfies EodCommit;
    })
    .filter((commit): commit is EodCommit => Boolean(commit));
}

function getFirstMeaningfulBodyLine(body: string): string | undefined {
  if (!body.trim()) {
    return undefined;
  }

  const line = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => Boolean(line) && !/^co-authored-by:/i.test(line));

  if (!line) {
    return undefined;
  }

  return line.replace(/^[-*]\s+/, "").trim();
}

function getCommitSummaryDescription(commit: EodCommit): string {
  const parsed = parseCleanCommitSubject(commit.subject);
  if (parsed?.description) {
    return parsed.description;
  }

  const bodyLine = getFirstMeaningfulBodyLine(commit.body);
  if (bodyLine) {
    return bodyLine;
  }

  return commit.subject;
}

function formatDetailedBullet(
  commit: { shortHash: string },
  description: string,
  parsed: ParsedCleanCommit | undefined,
  diff: CommitDiffSummary
): string {
  const normalizedDescription = description.charAt(0).toUpperCase() + description.slice(1);

  const classification = parsed
    ? `Classified as '${parsed.type}'${parsed.scope ? ` in ${parsed.scope}` : ""}${parsed.breaking ? " with a breaking change" : ""}.`
    : "Not tagged with Clean Commit format.";

  const changeStats = `Changed ${diff.filesChanged} file(s) with +${diff.additions} and -${diff.deletions} lines.`;
  const keyFiles = diff.keyFiles.length > 0 ? ` Focus files: ${diff.keyFiles.join(", ")}.` : "";

  return `${commit.shortHash}: ${normalizedDescription}. ${classification} ${changeStats}${keyFiles}`;
}

function toMarkdown(
  date: string,
  commits: Array<{
    shortHash: string;
    author: string;
    summaryDescription: string;
    cleanCommit?: ParsedCleanCommit;
    diff: CommitDiffSummary;
  }>,
  breakdown: Record<string, number>,
  coveragePercent: number,
  executiveSummary: string[],
  deliveryStats: EodDeliveryStats
): string {
  const lines: string[] = [];
  lines.push(`# EOD Report - ${date}`);
  lines.push("");
  lines.push(`- Total commits: ${commits.length}`);
  lines.push(`- Clean Commit coverage: ${coveragePercent}%`);

  if (executiveSummary.length > 0) {
    lines.push("");
    lines.push("## Executive Summary");
    for (const summary of executiveSummary) {
      lines.push(`- ${summary}`);
    }
  }

  lines.push("");
  lines.push("## Delivery Stats");
  lines.push(`- Total file-level changes: ${deliveryStats.totalFilesChanged}`);
  lines.push(`- Net line movement: +${deliveryStats.totalAdditions} / -${deliveryStats.totalDeletions}`);

  const contributorEntries = Object.entries(deliveryStats.commitCountByAuthor).sort((a, b) => b[1] - a[1]);
  if (contributorEntries.length > 0) {
    lines.push("- Contributor commit counts:");
    for (const [author, count] of contributorEntries) {
      lines.push(`  - ${author}: ${count}`);
    }
  }

  const breakdownKeys = Object.keys(breakdown).sort((a, b) => breakdown[b] - breakdown[a]);
  if (breakdownKeys.length > 0) {
    lines.push("");
    lines.push("## Commit Type Breakdown");
    for (const key of breakdownKeys) {
      lines.push(`- ${key}: ${breakdown[key]}`);
    }
  }

  lines.push("");
  lines.push("## Commits");
  if (commits.length === 0) {
    lines.push("- No commits found for this date.");
    return lines.join("\n");
  }

  for (const commit of commits) {
    lines.push(`- ${formatDetailedBullet(commit, commit.summaryDescription, commit.cleanCommit, commit.diff)}`);
    lines.push(`  - Author: ${commit.author}`);
  }

  return lines.join("\n");
}

function inferWorkstreams(commits: Array<{ cleanCommit?: ParsedCleanCommit; diff: CommitDiffSummary; subject: string }>): string[] {
  const streams = new Set<string>();

  for (const commit of commits) {
    const type = commit.cleanCommit?.type;
    const scope = commit.cleanCommit?.scope;

    if (type === "docs") {
      streams.add("documentation clarity and onboarding guidance");
    } else if (type === "security") {
      streams.add("security hardening and risk reduction");
    } else if (type === "setup" || type === "chore") {
      streams.add("tooling and configuration stability");
    } else if (type === "test") {
      streams.add("test confidence and quality validation");
    } else if (type === "new") {
      streams.add("new feature delivery");
    } else if (type === "update") {
      streams.add("behavioral and UX improvements");
    }

    if (scope === "cli") {
      streams.add("CLI usability and developer workflow improvements");
    }

    if (!type && /workflow|actions|ci/i.test(commit.subject)) {
      streams.add("automation and CI reliability");
    }
  }

  if (streams.size === 0) {
    streams.add("general repository improvements");
  }

  return [...streams].slice(0, 3);
}

function buildExecutiveSummary(
  date: string,
  commits: Array<{ author: string; cleanCommit?: ParsedCleanCommit; diff: CommitDiffSummary; subject: string }>,
  cleanCommitCoveragePercent: number
): { lines: string[]; stats: EodDeliveryStats } {
  const totalFilesChanged = commits.reduce((sum, commit) => sum + commit.diff.filesChanged, 0);
  const totalAdditions = commits.reduce((sum, commit) => sum + commit.diff.additions, 0);
  const totalDeletions = commits.reduce((sum, commit) => sum + commit.diff.deletions, 0);

  const commitCountByAuthor: Record<string, number> = {};
  for (const commit of commits) {
    commitCountByAuthor[commit.author] = (commitCountByAuthor[commit.author] ?? 0) + 1;
  }

  const leadAuthorEntry = Object.entries(commitCountByAuthor).sort((a, b) => b[1] - a[1])[0];
  const leadAuthor = leadAuthorEntry ? `${leadAuthorEntry[0]} (${leadAuthorEntry[1]} commit${leadAuthorEntry[1] > 1 ? "s" : ""})` : "n/a";
  const streams = inferWorkstreams(commits);

  const lines: string[] = [
    `On ${date}, the team delivered ${commits.length} commit(s) touching ${totalFilesChanged} file-level changes.`,
    `Net code movement was +${totalAdditions} additions and -${totalDeletions} deletions.`,
    `Primary workstreams: ${streams.join("; ")}.`,
    `Clean Commit adoption for the day: ${cleanCommitCoveragePercent}% (lead contributor: ${leadAuthor}).`
  ];

  return {
    lines,
    stats: {
      totalFilesChanged,
      totalAdditions,
      totalDeletions,
      commitCountByAuthor
    }
  };
}

export type EodReportOptions = {
  githubToken?: string;
};

type AIEodSummary = {
  executiveSummary: string[];
  provider: "anthropic" | "github-copilot" | "heuristic";
};

function buildEodPrompt(
  date: string,
  commits: Array<{ subject: string; cleanCommit?: ParsedCleanCommit; diff: CommitDiffSummary }>
): string {
  const commitLines = commits
    .map((c, i) => {
      const label = c.cleanCommit
        ? `${c.cleanCommit.type}${c.cleanCommit.scope ? `(${c.cleanCommit.scope})` : ""}: ${c.cleanCommit.description}`
        : c.subject;
      return `${i + 1}. ${label} — ${c.diff.filesChanged} file(s), +${c.diff.additions}/-${c.diff.deletions} lines`;
    })
    .join("\n");

  return `Git commits for ${date}:

${commitLines}

Write a concise EOD/standup executive summary for these commits. Return JSON using EXACTLY these keys:
{
  "executiveSummary": ["<bullet 1>", "<bullet 2>", "<bullet 3>"]
}

Rules: 3-5 bullets. Each bullet is a complete sentence. Synthesize themes, don't just list commits. Mention actual work done (features, fixes, refactors). No filler phrases like "the team worked on".`;
}

async function generateEodSummaryWithAI(
  date: string,
  commits: Array<{ subject: string; cleanCommit?: ParsedCleanCommit; diff: CommitDiffSummary }>,
  githubToken?: string
): Promise<AIEodSummary> {
  if (commits.length === 0) {
    return { executiveSummary: [], provider: "heuristic" };
  }

  const prompt = buildEodPrompt(date, commits);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }]
      });
      const raw = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
      const parsed = parseEodAIResponse(raw);
      if (parsed) return { executiveSummary: parsed, provider: "anthropic" };
    } catch {
      // fall through
    }
  }

  if (githubToken) {
    const raw = await callGitHubModels(githubToken, prompt);
    if (raw) {
      const parsed = parseEodAIResponse(raw);
      if (parsed) return { executiveSummary: parsed, provider: "github-copilot" };
    }
  }

  return { executiveSummary: [], provider: "heuristic" };
}

function parseEodAIResponse(raw: string): string[] | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { executiveSummary?: unknown };
    if (Array.isArray(parsed.executiveSummary) && parsed.executiveSummary.every((s) => typeof s === "string")) {
      return parsed.executiveSummary as string[];
    }
  } catch {
    // fall through
  }
  return null;
}

export async function generateEodReport(rootDir: string, dateInput?: string, options: EodReportOptions = {}): Promise<EodReportResult> {
  const date = dateInput || new Date().toISOString().slice(0, 10);
  if (!isValidDateInput(date)) {
    throw new Error("Invalid date. Use YYYY-MM-DD (example: 2026-04-24).");
  }

  const range = toIsoRange(date);
  const raw = await runGit(rootDir, [
    "log",
    "--since",
    range.since,
    "--until",
    range.until,
    "--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%b%x1e"
  ]);

  const commits = parseGitLogOutput(raw);
  const diffSummaries = await Promise.all(commits.map((commit) => getCommitDiffSummary(rootDir, commit.hash)));

  const detailedCommits = commits.map((commit, index) => {
    const cleanCommit = parseCleanCommitSubject(commit.subject);
    const summaryDescription = getCommitSummaryDescription(commit);
    const diff = diffSummaries[index];

    return {
      hash: commit.hash,
      shortHash: commit.shortHash,
      author: commit.author,
      date: commit.date,
      subject: commit.subject,
      summaryDescription,
      cleanCommit,
      diff
    };
  });

  const breakdown: Record<string, number> = {};
  let cleanCommitCount = 0;

  for (const commit of detailedCommits) {
    const parsed = commit.cleanCommit;
    if (!parsed) {
      continue;
    }

    cleanCommitCount += 1;
    breakdown[parsed.type] = (breakdown[parsed.type] ?? 0) + 1;
  }

  const coveragePercent = commits.length > 0 ? Number(((cleanCommitCount / commits.length) * 100).toFixed(2)) : 0;
  const [executive, aiSummary] = await Promise.all([
    Promise.resolve(buildExecutiveSummary(date, detailedCommits, coveragePercent)),
    generateEodSummaryWithAI(date, detailedCommits, options.githubToken)
  ]);

  const executiveSummary = aiSummary.executiveSummary.length > 0
    ? aiSummary.executiveSummary
    : executive.lines;

  return {
    date,
    totalCommits: commits.length,
    cleanCommitCoveragePercent: coveragePercent,
    executiveSummary,
    deliveryStats: executive.stats,
    commitTypeBreakdown: breakdown,
    summaryBullets: detailedCommits.map((commit) =>
      formatDetailedBullet(commit, commit.summaryDescription, commit.cleanCommit, commit.diff)
    ),
    commits: detailedCommits,
    markdown: toMarkdown(date, detailedCommits, breakdown, coveragePercent, executiveSummary, executive.stats)
  };
}
