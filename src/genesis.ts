import { promises as fs } from "node:fs";
import path from "node:path";
import { detectSensitiveMatches, redactSensitive } from "./redact.js";
import { getContextPaths } from "./templates.js";

type TaskType = "feature-design" | "bugfix" | "docs" | "release" | "refactor" | "research";

export type GenesisConfig = {
  enabled: boolean;
  captureByDefault: boolean;
  requireApprovalForProfile: boolean;
  autoApproveSafeProfile: boolean;
  maxExperienceFiles: number;
  skillSuggestionThreshold: number;
  recallLimit: number;
};

export type ExperienceRecord = {
  version: 1;
  id: string;
  createdAt: string;
  project: string;
  task: {
    type: TaskType;
    summary: string;
    inputs: string[];
    outputs: string[];
  };
  signals: {
    repeatedWorkflow: boolean;
    skillCandidate: boolean;
    memoryCandidate: boolean;
  };
  patterns: string[];
  decisions: string[];
  failures: string[];
  followups: string[];
  privacy: {
    containsSensitiveData: boolean;
    approvedForLongTermMemory: boolean;
  };
};

export type SkillSuggestionRecord = {
  version: 1;
  id: string;
  name: string;
  reason: string;
  evidence: string[];
  status: "suggested" | "accepted" | "rejected" | "drafted";
};

export type ProfileData = {
  version: 1;
  preferences: {
    naming: string[];
    coding: string[];
    docs: string[];
  };
  projects: Record<string, { packageManager: string; features: string[] }>;
  sources: Record<string, string[]>;
};

export type GenesisRecallItem = {
  score: number;
  sourceType: "experience" | "profile" | "suggestion";
  sourceId: string;
  text: string;
  project?: string;
  filePath?: string;
  taskType?: TaskType;
  createdAt?: string;
};

export type LearnCaptureInput = {
  text: string;
  summary?: string;
  taskType?: TaskType;
  inputs?: string[];
  outputs?: string[];
  approvedForLongTermMemory?: boolean;
  approveProfile?: boolean;
};

export type LearnCaptureResult = {
  experience: ExperienceRecord;
  profileUpdated: boolean;
  warning?: string;
};

export type LearnSuggestResult = {
  suggestions: SkillSuggestionRecord[];
  memoryNudges: string[];
};

export type LearnSkillResult = {
  suggestion: SkillSuggestionRecord;
  draftDir: string;
};

export type LearnReflectResult = {
  updates: Array<{ skill: string; notes: string[] }>;
};

export type LearnForgetInput = {
  experienceId?: string;
  suggestionId?: string;
  profileKey?: string;
};

type GenesisPaths = {
  contextDir: string;
  experiencesDir: string;
  memoryIndexPath: string;
  profilePath: string;
  suggestionsPath: string;
  draftsDir: string;
  configPath: string;
};

export interface GenesisStorage {
  listExperiences(): Promise<ExperienceRecord[]>;
  saveExperience(record: ExperienceRecord): Promise<void>;
  removeExperience(id: string): Promise<boolean>;
  readProfile(): Promise<ProfileData>;
  writeProfile(profile: ProfileData): Promise<void>;
  readSuggestions(): Promise<SkillSuggestionRecord[]>;
  writeSuggestions(items: SkillSuggestionRecord[]): Promise<void>;
  updateMemoryIndex(index: Record<string, string[]>): Promise<void>;
  readMemoryIndex(): Promise<Record<string, string[]>>;
}

const DEFAULT_CONFIG: GenesisConfig = {
  enabled: true,
  captureByDefault: false,
  requireApprovalForProfile: true,
  autoApproveSafeProfile: true,
  maxExperienceFiles: 500,
  skillSuggestionThreshold: 3,
  recallLimit: 8
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function uniqueSorted(items: string[], limit?: number): string[] {
  const out = [...new Set(items.map((item) => item.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return typeof limit === "number" ? out.slice(0, Math.max(0, limit)) : out;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function defaultProfile(): ProfileData {
  return {
    version: 1,
    preferences: {
      naming: [],
      coding: [],
      docs: []
    },
    projects: {},
    sources: {}
  };
}

function getGenesisPaths(rootDir: string): GenesisPaths {
  const paths = getContextPaths(rootDir);
  return {
    contextDir: paths.contextDir,
    experiencesDir: path.join(paths.contextDir, "experiences"),
    memoryIndexPath: path.join(paths.contextDir, "memory-index.json"),
    profilePath: path.join(paths.contextDir, "profile.json"),
    suggestionsPath: path.join(paths.contextDir, "skill-suggestions.json"),
    draftsDir: path.join(paths.contextDir, "skills", "drafts"),
    configPath: paths.configPath
  };
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

function parseTaskType(text: string): TaskType {
  const normalized = normalizeText(text);
  if (normalized.includes("bug") || normalized.includes("fix")) return "bugfix";
  if (normalized.includes("doc") || normalized.includes("readme")) return "docs";
  if (normalized.includes("release") || normalized.includes("publish")) return "release";
  if (normalized.includes("refactor")) return "refactor";
  if (normalized.includes("research") || normalized.includes("investigate")) return "research";
  return "feature-design";
}

function extractLinesByHint(text: string, hints: string[]): string[] {
  const out: string[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const normalized = normalizeText(line);
    if (hints.some((hint) => normalized.includes(hint))) {
      out.push(line.replace(/^[-*]\s+/, ""));
    }
  }
  return uniqueSorted(out, 12);
}

function extractFilesMentioned(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9_./-]+\.(ts|tsx|js|jsx|mjs|cjs|py|md|json|yml|yaml|go|rs|java|kt|cs|php|rb)/g) ?? [];
  return uniqueSorted(matches, 12);
}

function scoreRecall(text: string, query: string, recencyIso?: string, projectBoost = 0): number {
  const normalizedText = normalizeText(text);
  const tokens = normalizeText(query).split(" ").filter(Boolean);
  let tokenScore = 0;
  for (const token of tokens) {
    if (normalizedText.includes(token)) tokenScore += 12;
  }
  const recencyDays = recencyIso ? Math.max(0, (Date.now() - Date.parse(recencyIso)) / (1000 * 60 * 60 * 24)) : 365;
  const recencyScore = Math.max(0, 20 - Math.min(20, recencyDays));
  return tokenScore + recencyScore + projectBoost;
}

export async function getGenesisConfig(rootDir: string): Promise<GenesisConfig> {
  const configPath = getGenesisPaths(rootDir).configPath;
  const raw = await readJsonFile<{ learning?: Partial<GenesisConfig> } | Record<string, never>>(configPath, {});
  const learning = typeof raw === "object" && raw && "learning" in raw ? (raw as { learning?: Partial<GenesisConfig> }).learning : undefined;
  return {
    ...DEFAULT_CONFIG,
    ...(learning ?? {})
  };
}

class LocalGenesisStorage implements GenesisStorage {
  constructor(private paths: GenesisPaths) {}

  async listExperiences(): Promise<ExperienceRecord[]> {
    await fs.mkdir(this.paths.experiencesDir, { recursive: true });
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.paths.experiencesDir);
    } catch {
      return [];
    }

    const files = entries.filter((name) => name.endsWith(".json")).sort((a, b) => a.localeCompare(b));
    const out: ExperienceRecord[] = [];
    for (const file of files) {
      const fullPath = path.join(this.paths.experiencesDir, file);
      const record = await readJsonFile<ExperienceRecord | null>(fullPath, null);
      if (record && record.version === 1) out.push(record);
    }
    out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return out;
  }

  async saveExperience(record: ExperienceRecord): Promise<void> {
    await fs.mkdir(this.paths.experiencesDir, { recursive: true });
    const safeDate = record.createdAt.slice(0, 10);
    const safeSummary = toSlug(record.task.summary) || "experience";
    const fileName = `${safeDate}-${safeSummary}-${record.id}.json`;
    await writeJsonAtomic(path.join(this.paths.experiencesDir, fileName), record);
  }

  async removeExperience(id: string): Promise<boolean> {
    await fs.mkdir(this.paths.experiencesDir, { recursive: true });
    const entries = await fs.readdir(this.paths.experiencesDir);
    for (const file of entries.filter((name) => name.endsWith(".json")).sort((a, b) => a.localeCompare(b))) {
      const fullPath = path.join(this.paths.experiencesDir, file);
      const record = await readJsonFile<ExperienceRecord | null>(fullPath, null);
      if (record?.id === id) {
        await fs.rm(fullPath, { force: true });
        return true;
      }
    }
    return false;
  }

  async readProfile(): Promise<ProfileData> {
    return readJsonFile<ProfileData>(this.paths.profilePath, defaultProfile());
  }

  async writeProfile(profile: ProfileData): Promise<void> {
    await writeJsonAtomic(this.paths.profilePath, profile);
  }

  async readSuggestions(): Promise<SkillSuggestionRecord[]> {
    const items = await readJsonFile<SkillSuggestionRecord[]>(this.paths.suggestionsPath, []);
    return items.filter((item) => item.version === 1).sort((a, b) => a.id.localeCompare(b.id));
  }

  async writeSuggestions(items: SkillSuggestionRecord[]): Promise<void> {
    const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
    await writeJsonAtomic(this.paths.suggestionsPath, sorted);
  }

  async updateMemoryIndex(index: Record<string, string[]>): Promise<void> {
    const normalized = Object.fromEntries(Object.entries(index).sort((a, b) => a[0].localeCompare(b[0])));
    await writeJsonAtomic(this.paths.memoryIndexPath, normalized);
  }

  async readMemoryIndex(): Promise<Record<string, string[]>> {
    return readJsonFile<Record<string, string[]>>(this.paths.memoryIndexPath, {});
  }
}

function buildDefaultProjectModel(rootDir: string): { projectName: string; packageManager: string } {
  const projectName = path.basename(rootDir);
  const packageManager = "npm";
  return { projectName, packageManager };
}

async function createStorage(rootDir: string): Promise<{ storage: GenesisStorage; paths: GenesisPaths; config: GenesisConfig }> {
  const paths = getGenesisPaths(rootDir);
  const config = await getGenesisConfig(rootDir);
  await fs.mkdir(paths.contextDir, { recursive: true });
  await fs.mkdir(paths.experiencesDir, { recursive: true });
  await fs.mkdir(paths.draftsDir, { recursive: true });
  const storage = new LocalGenesisStorage(paths);
  return { storage, paths, config };
}

function redactInput(text: string): { text: string; containsSensitiveData: boolean; warning?: string } {
  const findings = detectSensitiveMatches(text);
  if (findings.length === 0) return { text, containsSensitiveData: false };
  const count = findings.reduce((sum, item) => sum + item.count, 0);
  return {
    text: redactSensitive(text),
    containsSensitiveData: true,
    warning: `Sensitive-like content detected and redacted (${count} match${count === 1 ? "" : "es"}).`
  };
}

export async function learnCapture(rootDir: string, input: LearnCaptureInput): Promise<LearnCaptureResult> {
  const { storage, config } = await createStorage(rootDir);
  if (!config.enabled) {
    throw new Error("ACE Genesis learning is disabled by config.");
  }

  const redacted = redactInput(input.text);
  const { projectName, packageManager } = buildDefaultProjectModel(rootDir);
  const taskType = input.taskType ?? parseTaskType(redacted.text);
  const summary = (input.summary ?? redacted.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "Captured task").slice(0, 180);

  const patterns = extractLinesByHint(redacted.text, ["prefer", "pattern", "workflow", "repeat", "convention"]);
  const decisions = extractLinesByHint(redacted.text, ["decide", "decision", "use", "adopt", "choose", "must"]);
  const failures = extractLinesByHint(redacted.text, ["fail", "error", "issue", "regression", "broke"]);
  const followups = extractLinesByHint(redacted.text, ["follow", "next", "todo", "later", "add"]);
  const filesMentioned = extractFilesMentioned(redacted.text);
  const hasExplicitLongTermApproval = typeof input.approvedForLongTermMemory === "boolean";
  const hasExplicitProfileApproval = typeof input.approveProfile === "boolean";
  const canAutoApproveSafeProfile =
    config.autoApproveSafeProfile && !redacted.containsSensitiveData && !hasExplicitLongTermApproval && !hasExplicitProfileApproval;
  const approvedForLongTermMemory = hasExplicitLongTermApproval
    ? Boolean(input.approvedForLongTermMemory)
    : canAutoApproveSafeProfile;

  const experience: ExperienceRecord = {
    version: 1,
    id: makeId("exp"),
    createdAt: nowIso(),
    project: projectName,
    task: {
      type: taskType,
      summary,
      inputs: uniqueSorted([...(input.inputs ?? []), ...filesMentioned]).slice(0, 12),
      outputs: uniqueSorted(input.outputs ?? []).slice(0, 12)
    },
    signals: {
      repeatedWorkflow: patterns.length >= 2,
      skillCandidate: patterns.length >= 2 || decisions.length >= 2,
      memoryCandidate: patterns.length > 0 || decisions.length > 0
    },
    patterns,
    decisions,
    failures,
    followups,
    privacy: {
      containsSensitiveData: redacted.containsSensitiveData,
      approvedForLongTermMemory
    }
  };

  await storage.saveExperience(experience);

  let profileUpdated = false;
  const allowProfile = hasExplicitProfileApproval
    ? Boolean(input.approveProfile)
    : canAutoApproveSafeProfile || !config.requireApprovalForProfile;
  if (allowProfile && experience.privacy.approvedForLongTermMemory) {
    const profile = await storage.readProfile();
    const sourceId = experience.id;

    if (patterns.length > 0) {
      profile.preferences.coding = uniqueSorted([...profile.preferences.coding, ...patterns.map((item) => item.slice(0, 120))], 20);
      profile.sources.coding = uniqueSorted([...(profile.sources.coding ?? []), sourceId], 40);
      profileUpdated = true;
    }

    if (decisions.length > 0) {
      profile.preferences.naming = uniqueSorted([...profile.preferences.naming, ...decisions.map((item) => item.slice(0, 120))], 20);
      profile.sources.naming = uniqueSorted([...(profile.sources.naming ?? []), sourceId], 40);
      profileUpdated = true;
    }

    const project = profile.projects[projectName] ?? { packageManager, features: [] };
    project.packageManager = project.packageManager || packageManager;
    project.features = uniqueSorted([...project.features, "ACE Genesis"], 20);
    profile.projects[projectName] = project;

    if (profileUpdated) {
      await storage.writeProfile(profile);
    }
  }

  const memoryIndex = await storage.readMemoryIndex();
  const keywords = uniqueSorted(
    normalizeText(`${summary} ${patterns.join(" ")} ${decisions.join(" ")}`)
      .split(" ")
      .filter((token) => token.length >= 4),
    24
  );
  for (const keyword of keywords) {
    memoryIndex[keyword] = uniqueSorted([...(memoryIndex[keyword] ?? []), experience.id], 60);
  }
  await storage.updateMemoryIndex(memoryIndex);

  const experiences = await storage.listExperiences();
  if (experiences.length > config.maxExperienceFiles) {
    const toRemove = experiences.slice(config.maxExperienceFiles);
    for (const item of toRemove) {
      await storage.removeExperience(item.id);
    }
  }

  return {
    experience,
    profileUpdated,
    warning: redacted.warning
  };
}

export async function learnRecall(rootDir: string, query: string, options: { limit?: number; project?: string } = {}): Promise<GenesisRecallItem[]> {
  const { storage, config } = await createStorage(rootDir);
  const limit = options.limit ?? config.recallLimit;
  const experiences = await storage.listExperiences();
  const profile = await storage.readProfile();
  const suggestions = await storage.readSuggestions();

  const rows: GenesisRecallItem[] = [];
  const projectName = options.project ?? path.basename(rootDir);

  for (const exp of experiences) {
    const projectBoost = exp.project === projectName ? 8 : 0;
    const text = `${exp.task.summary} ${exp.patterns.join(" ")} ${exp.decisions.join(" ")} ${exp.failures.join(" ")}`;
    rows.push({
      score: scoreRecall(text, query, exp.createdAt, projectBoost),
      sourceType: "experience",
      sourceId: exp.id,
      text: exp.task.summary,
      project: exp.project,
      filePath: exp.task.inputs[0],
      taskType: exp.task.type,
      createdAt: exp.createdAt
    });
  }

  for (const [category, items] of Object.entries(profile.preferences)) {
    for (const item of items) {
      rows.push({
        score: scoreRecall(item, query, undefined, 6),
        sourceType: "profile",
        sourceId: category,
        text: `${category}: ${item}`
      });
    }
  }

  for (const suggestion of suggestions) {
    const text = `${suggestion.name} ${suggestion.reason}`;
    rows.push({
      score: scoreRecall(text, query, undefined, 4),
      sourceType: "suggestion",
      sourceId: suggestion.id,
      text: `${suggestion.name}: ${suggestion.reason}`
    });
  }

  return rows
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId))
    .slice(0, limit);
}

export async function learnSuggest(rootDir: string): Promise<LearnSuggestResult> {
  const { storage, config } = await createStorage(rootDir);
  const experiences = await storage.listExperiences();
  const grouped = new Map<string, ExperienceRecord[]>();

  for (const exp of experiences) {
    const key = `${exp.task.type}:${normalizeText(exp.task.summary).slice(0, 80)}`;
    const items = grouped.get(key) ?? [];
    items.push(exp);
    grouped.set(key, items);
  }

  const existing = await storage.readSuggestions();
  const existingKey = new Set(existing.map((item) => item.name));
  const suggestions: SkillSuggestionRecord[] = [...existing];

  for (const [key, items] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (items.length < config.skillSuggestionThreshold) continue;
    const first = items[0];
    const name = toSlug(first.task.summary) || toSlug(key) || "ace-workflow-skill";
    if (existingKey.has(name)) continue;
    suggestions.push({
      version: 1,
      id: makeId("skill_suggestion"),
      name,
      reason: `Detected repeated ${first.task.type} workflow across ${items.length} experiences.`,
      evidence: uniqueSorted(items.map((item) => item.id)).slice(0, 12),
      status: "suggested"
    });
  }

  await storage.writeSuggestions(suggestions);

  const memoryNudges = experiences
    .flatMap((exp) => [...exp.patterns, ...exp.decisions])
    .filter((line) => line.length >= 16)
    .slice(0, 8)
    .map((line) => `Consider saving durable preference: ${line}`);

  return {
    suggestions: suggestions.sort((a, b) => a.name.localeCompare(b.name)),
    memoryNudges
  };
}

export async function learnSkill(rootDir: string, input: { suggestionId?: string; name?: string }): Promise<LearnSkillResult> {
  const { storage, paths } = await createStorage(rootDir);
  const suggestions = await storage.readSuggestions();
  const inputName = input.name ?? "";
  const target = input.suggestionId
    ? suggestions.find((item) => item.id === input.suggestionId)
    : inputName
      ? suggestions.find((item) => item.name === toSlug(inputName) || item.name === inputName)
      : suggestions.find((item) => item.status === "suggested");

  if (!target) {
    throw new Error("No matching skill suggestion found.");
  }

  const experiences = await storage.listExperiences();
  const evidence = experiences.filter((item) => target.evidence.includes(item.id));
  const draftName = toSlug(target.name) || "ace-skill";
  const draftDir = path.join(paths.draftsDir, draftName);
  const referencesDir = path.join(draftDir, "references");
  const scriptsDir = path.join(draftDir, "scripts");

  await fs.mkdir(referencesDir, { recursive: true });
  await fs.mkdir(scriptsDir, { recursive: true });

  const checklist = uniqueSorted(evidence.flatMap((item) => item.patterns), 12);
  const decisions = uniqueSorted(evidence.flatMap((item) => item.decisions), 12);
  const failures = uniqueSorted(evidence.flatMap((item) => item.failures), 12);

  const skillContent = [
    `# ${draftName}`,
    "",
    "## Purpose",
    `- ${target.reason}`,
    "",
    "## Checklist",
    ...(checklist.length > 0 ? checklist.map((item) => `- ${item}`) : ["- Keep workflow deterministic and reviewable."]),
    "",
    "## Decisions",
    ...(decisions.length > 0 ? decisions.map((item) => `- ${item}`) : ["- No explicit decisions captured yet."]),
    "",
    "## Known Friction",
    ...(failures.length > 0 ? failures.map((item) => `- ${item}`) : ["- No repeated friction captured yet."]),
    "",
    "## Evidence",
    ...target.evidence.map((id) => `- ${id}`),
    ""
  ].join("\n");

  const changelogPath = path.join(draftDir, "CHANGELOG.md");
  let previousChangelog = "# Changelog\n";
  try {
    previousChangelog = await fs.readFile(changelogPath, "utf8");
  } catch {
    previousChangelog = "# Changelog\n";
  }
  const changelogContent = [
    previousChangelog.trimEnd(),
    "",
    `## ${nowIso()}`,
    "- Draft generated from ACE Genesis skill suggestion evidence.",
    ""
  ].join("\n");

  await writeTextAtomic(path.join(draftDir, "SKILL.md"), skillContent);
  await writeTextAtomic(changelogPath, changelogContent);

  target.status = "drafted";
  await storage.writeSuggestions(suggestions);

  return {
    suggestion: target,
    draftDir
  };
}

export async function learnReflect(rootDir: string): Promise<LearnReflectResult> {
  const { storage, paths } = await createStorage(rootDir);
  const experiences = await storage.listExperiences();
  const recent = experiences.slice(0, 40);
  const failures = uniqueSorted(recent.flatMap((item) => item.failures), 20);
  const repeatedCorrections = uniqueSorted(
    recent
      .flatMap((item) => item.followups)
      .filter((line) => normalizeText(line).includes("update") || normalizeText(line).includes("fix")),
    20
  );

  let draftNames: string[] = [];
  try {
    draftNames = (await fs.readdir(paths.draftsDir)).sort((a, b) => a.localeCompare(b));
  } catch {
    draftNames = [];
  }

  const updates: Array<{ skill: string; notes: string[] }> = [];
  for (const draft of draftNames) {
    const notes = uniqueSorted([...failures.slice(0, 4), ...repeatedCorrections.slice(0, 4)], 8);
    updates.push({ skill: draft, notes });

    const changelogPath = path.join(paths.draftsDir, draft, "CHANGELOG.md");
    let existing = "# Changelog\n";
    try {
      existing = await fs.readFile(changelogPath, "utf8");
    } catch {
      existing = "# Changelog\n";
    }
    const entry = [
      existing.trimEnd(),
      "",
      `## ${nowIso()}`,
      ...(notes.length > 0 ? notes.map((note) => `- Reflection hint: ${note}`) : ["- Reflection hint: no new friction signals detected."]),
      ""
    ].join("\n");
    await writeTextAtomic(changelogPath, entry);
  }

  return { updates };
}

export async function learnProfile(rootDir: string): Promise<ProfileData> {
  const { storage } = await createStorage(rootDir);
  return storage.readProfile();
}

export async function learnForget(rootDir: string, input: LearnForgetInput): Promise<{ removed: string[] }> {
  const { storage } = await createStorage(rootDir);
  const removed: string[] = [];

  if (input.experienceId) {
    const didRemove = await storage.removeExperience(input.experienceId);
    if (didRemove) removed.push(`experience:${input.experienceId}`);
  }

  if (input.suggestionId) {
    const suggestions = await storage.readSuggestions();
    const next = suggestions.filter((item) => item.id !== input.suggestionId);
    if (next.length !== suggestions.length) {
      await storage.writeSuggestions(next);
      removed.push(`suggestion:${input.suggestionId}`);
    }
  }

  if (input.profileKey) {
    const profile = await storage.readProfile();
    const key = input.profileKey;
    let changed = false;
    if (key.startsWith("naming:")) {
      const value = key.slice("naming:".length);
      const next = profile.preferences.naming.filter((item) => item !== value);
      if (next.length !== profile.preferences.naming.length) {
        profile.preferences.naming = next;
        changed = true;
      }
    }
    if (key.startsWith("coding:")) {
      const value = key.slice("coding:".length);
      const next = profile.preferences.coding.filter((item) => item !== value);
      if (next.length !== profile.preferences.coding.length) {
        profile.preferences.coding = next;
        changed = true;
      }
    }
    if (key.startsWith("docs:")) {
      const value = key.slice("docs:".length);
      const next = profile.preferences.docs.filter((item) => item !== value);
      if (next.length !== profile.preferences.docs.length) {
        profile.preferences.docs = next;
        changed = true;
      }
    }
    if (changed) {
      await storage.writeProfile(profile);
      removed.push(`profile:${key}`);
    }
  }

  return { removed };
}

export async function getRelevantDecisions(rootDir: string, query: string, limit = 4): Promise<string[]> {
  const recalled = await learnRecall(rootDir, query, { limit: Math.max(limit * 2, 6) });
  const decisions = recalled
    .filter((item) => item.sourceType === "experience")
    .map((item) => item.text)
    .slice(0, limit);
  return uniqueSorted(decisions, limit);
}

export async function getRecallNotes(rootDir: string, query: string, limit = 4): Promise<string[]> {
  const recalled = await learnRecall(rootDir, query, { limit });
  return uniqueSorted(recalled.map((item) => item.text), limit);
}

export async function canUseGenesis(rootDir: string): Promise<boolean> {
  const config = await getGenesisConfig(rootDir);
  return config.enabled;
}

export function buildCaptureFromExport(text: string): LearnCaptureInput {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const summary = (lines.find((line) => line.length > 20) ?? "Imported conversation trace").slice(0, 180);
  const inputs = extractFilesMentioned(text).slice(0, 12);
  return {
    text,
    summary,
    taskType: parseTaskType(text),
    inputs,
    outputs: [],
    approvedForLongTermMemory: false,
    approveProfile: false
  };
}

export function scoreQueryComplexity(query: string): number {
  return estimateTokens(query);
}