import { promises as fs } from "node:fs";
import { generateGraphContext } from "./graph.js";
import { indexProject } from "./indexer.js";
import { detectSensitiveMatches, redactSensitive } from "./redact.js";
import { syncSkills } from "./skills.js";
import { StrictModeViolationError } from "./strict-mode.js";
import { getContextPaths } from "./templates.js";

export type SyncResult = {
  contextPath: string;
  bytes: number;
};

export type SyncOptions = {
  strict?: boolean;
  githubToken?: string;
  onSkillPlan?: (plan: { skill: string; action: string }[]) => void;
};

const MAX_CONTEXT_CHARS = 5500;
const PRIORITY_LINE_LIMIT = 10;

const SECTION_LIMITS: Record<string, number> = {
  preferences: 10,
  memory: 10,
  decisions: 8,
  workflows: 8,
  projectMap: 8,
  minimalContext: 10
};

const PRIORITY_KEYWORDS = [
  "must",
  "should",
  "never",
  "always",
  "required",
  "critical",
  "priority",
  "security",
  "test",
  "build",
  "deploy",
  "architecture",
  "constraint"
];

const NOISE_LINES = new Set([
  "memory",
  "preferences",
  "decisions",
  "workflows",
  "project map",
  "project map highlights",
  "top priorities",
  "notes",
  "detected languages",
  "detected frameworks",
  "package scripts",
  "important config files",
  "test commands",
  "build commands",
  "entrypoints",
  "folder tree (max depth 3)",
  "repository snapshot",
  "none",
  "none detected"
]);

async function readOptionalFile(filePath: string): Promise<string> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw;
  } catch {
    return "";
  }
}

function normalizeForDedupe(line: string): string {
  return line.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function stripMarkdownPrefix(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .trim();
}

function extractCandidateLines(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const result: string[] = [];
  let inCodeBlock = false;

  for (const raw of lines) {
    const trimmed = raw.trim();

    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      continue;
    }
    if (!trimmed) {
      continue;
    }

    const cleaned = stripMarkdownPrefix(trimmed);
    if (!cleaned || cleaned.length < 3) {
      continue;
    }

    const normalized = cleaned.toLowerCase().replace(/\s+/g, " ").trim();
    if (NOISE_LINES.has(normalized)) {
      continue;
    }
    if (/^generated at:/i.test(cleaned)) {
      continue;
    }
    if (/^total (files|directories):/i.test(cleaned)) {
      continue;
    }
    if (/^truncated scan:/i.test(cleaned)) {
      continue;
    }

    result.push(cleaned);
  }

  return result;
}

function scoreLine(line: string): number {
  const lower = line.toLowerCase();
  let score = 0;

  for (const keyword of PRIORITY_KEYWORDS) {
    if (lower.includes(keyword)) {
      score += 2;
    }
  }

  if (line.length >= 20 && line.length <= 120) {
    score += 2;
  }

  if (line.includes(":")) {
    score += 1;
  }

  return score;
}

function compressLines(lines: string[], limit: number, globalSeen?: Set<string>): string[] {
  const localSeen = new Set<string>();
  const unique: string[] = [];

  for (const line of lines) {
    const key = normalizeForDedupe(line);
    if (!key) {
      continue;
    }
    if (localSeen.has(key)) {
      continue;
    }
    if (globalSeen && globalSeen.has(key)) {
      continue;
    }

    localSeen.add(key);
    unique.push(line);
  }

  unique.sort((a, b) => {
    const scoreDiff = scoreLine(b) - scoreLine(a);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return a.length - b.length;
  });

  const selected = unique.slice(0, limit);
  if (globalSeen) {
    for (const line of selected) {
      globalSeen.add(normalizeForDedupe(line));
    }
  }

  return selected;
}

function trimToMaxChars(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, maxChars)}\n\n...[truncated for context budget]`;
}

function renderContext(
  memoryRaw: string,
  preferencesRaw: string,
  projectMapRaw: string,
  workflowsRaw: string,
  decisionsRaw: string,
  minimalContextRaw: string
): string {
  const globalSeen = new Set<string>();

  const preferences = compressLines(extractCandidateLines(preferencesRaw), SECTION_LIMITS.preferences, globalSeen);
  const memory = compressLines(extractCandidateLines(memoryRaw), SECTION_LIMITS.memory, globalSeen);
  const decisions = compressLines(extractCandidateLines(decisionsRaw), SECTION_LIMITS.decisions, globalSeen);
  const workflows = compressLines(extractCandidateLines(workflowsRaw), SECTION_LIMITS.workflows, globalSeen);
  const projectMap = compressLines(extractCandidateLines(projectMapRaw), SECTION_LIMITS.projectMap, globalSeen);
  const minimalContext = compressLines(extractCandidateLines(minimalContextRaw), SECTION_LIMITS.minimalContext, globalSeen);

  const priorityPool = [
    ...preferences,
    ...memory,
    ...decisions,
    ...workflows,
    ...projectMap,
    ...minimalContext
  ];

  const topPriorities = compressLines(priorityPool, PRIORITY_LINE_LIMIT);

  const renderList = (items: string[]) => (items.length ? items.map((line) => `- ${line}`).join("\n") : "- none");

  const rendered = `# AI Context

Generated at: ${new Date().toISOString()}

## Top Priorities
${renderList(topPriorities)}

## Preferences
${renderList(preferences)}

## Memory
${renderList(memory)}

## Decisions
${renderList(decisions)}

## Workflows
${renderList(workflows)}

## Project Map Highlights
${renderList(projectMap)}

## Minimal Context Highlights
${renderList(minimalContext)}

## Notes
- Use this file first for quick AI context.
- Regenerate after meaningful repository or process changes.
`;

  return trimToMaxChars(rendered, MAX_CONTEXT_CHARS);
}

function assertNoSensitiveInStrictMode(label: string, input: string, strict: boolean): void {
  if (!strict) {
    return;
  }

  const findings = detectSensitiveMatches(input);
  if (findings.length === 0) {
    return;
  }

  const total = findings.reduce((sum, finding) => sum + finding.count, 0);
  const labels = findings.map((finding) => finding.name).join(", ");
  throw new StrictModeViolationError(
    `Strict mode blocked ${label}: ${total} secret-like matches detected (${labels}).`,
    findings
  );
}

export async function syncContext(rootDir: string, options: SyncOptions = {}): Promise<SyncResult> {
  const paths = getContextPaths(rootDir);
  await fs.mkdir(paths.contextDir, { recursive: true });

  await generateGraphContext(rootDir, { strict: options.strict });

  const indexData = await indexProject(rootDir, { writeMarkdown: false, writeJson: false });
  const skillResult = await syncSkills(paths.skillsDir, indexData.data, {
    githubToken: options.githubToken,
    onPlan: options.onSkillPlan
  });

  const memory = await readOptionalFile(paths.memoryPath);
  const preferences = await readOptionalFile(paths.preferencesPath);
  const projectMap = await readOptionalFile(paths.projectMapPath);
  const workflows = await readOptionalFile(paths.workflowsPath);
  const decisions = await readOptionalFile(paths.decisionsPath);
  const minimalContext = await readOptionalFile(paths.minimalContextPath);

  const rendered = renderContext(memory, preferences, projectMap, workflows, decisions, minimalContext);
  assertNoSensitiveInStrictMode("ai-context generation", rendered, Boolean(options.strict));
  const redacted = redactSensitive(rendered);

  await fs.writeFile(paths.aiContextPath, redacted, "utf8");
  const stat = await fs.stat(paths.aiContextPath);

  return {
    contextPath: paths.aiContextPath,
    bytes: stat.size
  };
}
