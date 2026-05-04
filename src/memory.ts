import { promises as fs } from "node:fs";
import path from "node:path";
import { detectSensitiveMatches, redactSensitive } from "./redact.js";
import { getContextPaths } from "./templates.js";

export type MemoryType =
  | "rule"
  | "preference"
  | "decision"
  | "project_state"
  | "fact"
  | "warning"
  | "style"
  | "note";

export type MemorySource = "manual" | "scan" | "chat" | "doc" | "command" | "import";

export type MemoryItem = {
  id: string;
  type: MemoryType;
  text: string;
  source: MemorySource;
  tags: string[];
  importance: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  useCount: number;
  expiresAt: string | null;
};

export type MemorySummary = {
  id: string;
  text: string;
  sourceItemIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type MemoryConfig = {
  enabled: boolean;
  maxItems: number;
  maxTokens: number;
  includeTypes: MemoryType[];
  excludeTypes: MemoryType[];
  strictRedaction: boolean;
};

export type MemoryStore = {
  items: MemoryItem[];
  summaries: MemorySummary[];
  index: {
    byTag: Record<string, string[]>;
    byType: Record<string, string[]>;
    updatedAt: string;
  };
};

export type AddMemoryInput = {
  type: MemoryType;
  text: string;
  source?: MemorySource;
  tags?: string[];
  importance?: number;
  expiresAt?: string | null;
};

export type ListMemoryInput = {
  type?: MemoryType;
  tag?: string;
  query?: string;
  includeExpired?: boolean;
  limit?: number;
};

export type SearchMemoryInput = {
  query: string;
  includeTypes?: MemoryType[];
  excludeTypes?: MemoryType[];
  maxItems?: number;
  maxTokens?: number;
};

export type ForgetMemoryInput = {
  id?: string;
  query?: string;
};

export type PruneMemoryResult = {
  removedDuplicate: number;
  removedExpired: number;
  removedLowValue: number;
  remaining: number;
};

export type SummarizeMemoryResult = {
  createdSummaries: number;
  removedItems: number;
  summaries: MemorySummary[];
};

export type BuildMemoryContextInput = {
  query: string;
  config?: Partial<MemoryConfig>;
};

export type BuildMemoryContextResult = {
  includedItems: MemoryItem[];
  includedSummaries: MemorySummary[];
  excluded: Array<{ id: string; reason: string }>;
  sections: {
    persistentMemory: string[];
    memoryDecisions: string[];
    projectState: string[];
    excludedMemory: string[];
  };
  tokenEstimate: number;
};

const DEFAULT_CONFIG: MemoryConfig = {
  enabled: true,
  maxItems: 8,
  maxTokens: 1200,
  includeTypes: ["rule", "preference", "decision", "project_state", "fact", "warning", "style"],
  excludeTypes: [],
  strictRedaction: true
};

const TYPE_PRIORITY: Record<MemoryType, number> = {
  rule: 90,
  project_state: 85,
  decision: 80,
  warning: 75,
  preference: 70,
  style: 60,
  fact: 55,
  note: 40
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function normalizeForCompare(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureMemoryType(value: string): MemoryType {
  const allowed: MemoryType[] = ["rule", "preference", "decision", "project_state", "fact", "warning", "style", "note"];
  if ((allowed as string[]).includes(value)) {
    return value as MemoryType;
  }
  throw new Error(`Unsupported memory type: ${value}`);
}

function getMemoryPaths(rootDir: string): { dir: string; items: string; summaries: string; index: string; config: string } {
  const contextDir = getContextPaths(rootDir).contextDir;
  const dir = path.join(contextDir, "memory");
  return {
    dir,
    items: path.join(dir, "items.json"),
    summaries: path.join(dir, "summaries.json"),
    index: path.join(dir, "index.json"),
    config: path.join(contextDir, "config.json")
  };
}

async function readJsonIfExists<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

function scoreMemory(item: MemoryItem, queryTokens: string[]): number {
  const text = normalizeForCompare(item.text);
  const tagText = item.tags.join(" ");

  let queryBoost = 0;
  for (const token of queryTokens) {
    if (!token) {
      continue;
    }
    if (text.includes(token)) {
      queryBoost += 12;
    }
    if (tagText.includes(token)) {
      queryBoost += 9;
    }
  }

  const recencyDays = Math.max(0, (Date.now() - Date.parse(item.updatedAt)) / (1000 * 60 * 60 * 24));
  const recencyScore = Math.max(0, 20 - Math.min(20, recencyDays));
  const usageScore = Math.min(20, item.useCount * 2);
  const importanceScore = Math.min(30, Math.max(1, item.importance) * 6);
  const typeScore = TYPE_PRIORITY[item.type] ?? 0;

  return typeScore + queryBoost + recencyScore + usageScore + importanceScore;
}

function isExpired(item: MemoryItem): boolean {
  if (!item.expiresAt) {
    return false;
  }
  return Date.parse(item.expiresAt) <= Date.now();
}

function dedupeBySimilarity(items: MemoryItem[]): { kept: MemoryItem[]; removedIds: Set<string> } {
  const removedIds = new Set<string>();
  const kept: MemoryItem[] = [];

  for (const item of items) {
    const normalized = normalizeForCompare(item.text);
    const duplicate = kept.find((existing) => normalizeForCompare(existing.text) === normalized);
    if (!duplicate) {
      kept.push(item);
      continue;
    }

    const existingScore = existingValueScore(duplicate);
    const currentScore = existingValueScore(item);
    if (currentScore > existingScore) {
      removedIds.add(duplicate.id);
      kept.splice(kept.indexOf(duplicate), 1, item);
    } else {
      removedIds.add(item.id);
    }
  }

  return { kept, removedIds };
}

function existingValueScore(item: MemoryItem): number {
  return (TYPE_PRIORITY[item.type] ?? 0) + item.importance * 5 + item.useCount * 2;
}

function buildIndex(items: MemoryItem[]): MemoryStore["index"] {
  const byTag: Record<string, string[]> = {};
  const byType: Record<string, string[]> = {};

  for (const item of items) {
    if (!byType[item.type]) {
      byType[item.type] = [];
    }
    byType[item.type].push(item.id);

    for (const tag of item.tags) {
      if (!byTag[tag]) {
        byTag[tag] = [];
      }
      byTag[tag].push(item.id);
    }
  }

  return {
    byTag,
    byType,
    updatedAt: nowIso()
  };
}

function parseMemoryConfig(raw: unknown): Partial<MemoryConfig> {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const config = raw as { memory?: Partial<MemoryConfig> };
  if (!config.memory || typeof config.memory !== "object") {
    return {};
  }

  return config.memory;
}

export async function getMemoryConfig(rootDir: string): Promise<MemoryConfig> {
  const paths = getMemoryPaths(rootDir);
  const raw = await readJsonIfExists<{ memory?: Partial<MemoryConfig> } | Record<string, never>>(paths.config, {});
  const parsed = parseMemoryConfig(raw);

  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    includeTypes: (parsed.includeTypes as MemoryType[] | undefined) ?? DEFAULT_CONFIG.includeTypes,
    excludeTypes: (parsed.excludeTypes as MemoryType[] | undefined) ?? DEFAULT_CONFIG.excludeTypes
  };
}

export async function ensureMemoryStore(rootDir: string): Promise<void> {
  const paths = getMemoryPaths(rootDir);
  await fs.mkdir(paths.dir, { recursive: true });

  const hasItems = await readJsonIfExists<MemoryItem[] | null>(paths.items, null);
  if (!hasItems) {
    await writeJson(paths.items, []);
  }

  const hasSummaries = await readJsonIfExists<MemorySummary[] | null>(paths.summaries, null);
  if (!hasSummaries) {
    await writeJson(paths.summaries, []);
  }

  const hasIndex = await readJsonIfExists<MemoryStore["index"] | null>(paths.index, null);
  if (!hasIndex) {
    await writeJson(paths.index, { byTag: {}, byType: {}, updatedAt: nowIso() });
  }
}

export async function loadMemoryStore(rootDir: string): Promise<MemoryStore> {
  await ensureMemoryStore(rootDir);
  const paths = getMemoryPaths(rootDir);

  const [items, summaries, index] = await Promise.all([
    readJsonIfExists<MemoryItem[]>(paths.items, []),
    readJsonIfExists<MemorySummary[]>(paths.summaries, []),
    readJsonIfExists<MemoryStore["index"]>(paths.index, { byTag: {}, byType: {}, updatedAt: nowIso() })
  ]);

  return { items, summaries, index };
}

async function saveMemoryStore(rootDir: string, store: MemoryStore): Promise<void> {
  const paths = getMemoryPaths(rootDir);
  await Promise.all([
    writeJson(paths.items, store.items),
    writeJson(paths.summaries, store.summaries),
    writeJson(paths.index, store.index)
  ]);
}

function withRedaction(input: string): { text: string; redacted: boolean; findings: number } {
  const findings = detectSensitiveMatches(input);
  if (findings.length === 0) {
    return { text: input, redacted: false, findings: 0 };
  }

  const redacted = redactSensitive(input);
  const total = findings.reduce((sum, finding) => sum + finding.count, 0);
  return { text: redacted, redacted: true, findings: total };
}

export async function addMemory(rootDir: string, input: AddMemoryInput): Promise<{ item: MemoryItem; warning?: string }> {
  const type = ensureMemoryType(input.type);
  const source = input.source ?? "manual";
  const importance = Math.max(1, Math.min(5, input.importance ?? 3));
  const redaction = withRedaction(input.text.trim());
  const now = nowIso();

  const item: MemoryItem = {
    id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    text: redaction.text,
    source,
    tags: uniqueTags(input.tags ?? []),
    importance,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    useCount: 0,
    expiresAt: input.expiresAt ?? null
  };

  const store = await loadMemoryStore(rootDir);
  store.items.unshift(item);
  store.index = buildIndex(store.items);
  await saveMemoryStore(rootDir, store);

  const warning = redaction.redacted
    ? `Secret-like content detected and redacted (${redaction.findings} match${redaction.findings === 1 ? "" : "es"}).`
    : undefined;

  return { item, warning };
}

export async function listMemory(rootDir: string, input: ListMemoryInput = {}): Promise<MemoryItem[]> {
  const store = await loadMemoryStore(rootDir);
  const query = input.query ? normalizeForCompare(input.query) : "";

  let items = [...store.items];
  if (!input.includeExpired) {
    items = items.filter((item) => !isExpired(item));
  }
  if (input.type) {
    items = items.filter((item) => item.type === input.type);
  }
  if (input.tag) {
    const expected = input.tag.toLowerCase();
    items = items.filter((item) => item.tags.includes(expected));
  }
  if (query) {
    items = items.filter((item) => normalizeForCompare(item.text).includes(query));
  }

  items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  if (input.limit && input.limit > 0) {
    return items.slice(0, input.limit);
  }

  return items;
}

export async function searchMemory(rootDir: string, input: SearchMemoryInput): Promise<MemoryItem[]> {
  const store = await loadMemoryStore(rootDir);
  const queryTokens = normalizeForCompare(input.query).split(" ").filter(Boolean);
  const includeTypes = new Set(input.includeTypes ?? DEFAULT_CONFIG.includeTypes);
  const excludeTypes = new Set(input.excludeTypes ?? []);
  const maxItems = input.maxItems ?? DEFAULT_CONFIG.maxItems;
  const maxTokens = input.maxTokens ?? DEFAULT_CONFIG.maxTokens;

  const ranked = store.items
    .filter((item) => !isExpired(item))
    .filter((item) => includeTypes.has(item.type))
    .filter((item) => !excludeTypes.has(item.type))
    .map((item) => ({ item, score: scoreMemory(item, queryTokens) }))
    .sort((a, b) => b.score - a.score);

  const selected: MemoryItem[] = [];
  let tokens = 0;

  for (const entry of ranked) {
    if (selected.length >= maxItems) {
      break;
    }

    const itemTokens = estimateTokens(entry.item.text);
    if (tokens + itemTokens > maxTokens) {
      continue;
    }

    const isDuplicate = selected.some((existing) => normalizeForCompare(existing.text) === normalizeForCompare(entry.item.text));
    if (isDuplicate) {
      continue;
    }

    selected.push(entry.item);
    tokens += itemTokens;
  }

  if (selected.length > 0) {
    const now = nowIso();
    const selectedIds = new Set(selected.map((item) => item.id));
    let changed = false;
    for (const item of store.items) {
      if (!selectedIds.has(item.id)) {
        continue;
      }
      item.useCount += 1;
      item.lastUsedAt = now;
      item.updatedAt = now;
      changed = true;
    }

    if (changed) {
      store.index = buildIndex(store.items);
      await saveMemoryStore(rootDir, store);
    }
  }

  return selected;
}

export async function forgetMemory(rootDir: string, input: ForgetMemoryInput): Promise<{ removed: number; removedIds: string[] }> {
  if (!input.id && !input.query) {
    throw new Error("Provide --id or --query.");
  }

  const store = await loadMemoryStore(rootDir);
  const query = input.query ? normalizeForCompare(input.query) : "";

  const removedIds: string[] = [];
  store.items = store.items.filter((item) => {
    const matchById = input.id ? item.id === input.id : false;
    const matchByQuery = query ? normalizeForCompare(item.text).includes(query) : false;
    const shouldRemove = matchById || matchByQuery;
    if (shouldRemove) {
      removedIds.push(item.id);
    }
    return !shouldRemove;
  });

  if (removedIds.length === 0) {
    return { removed: 0, removedIds: [] };
  }

  const removedSet = new Set(removedIds);
  store.summaries = store.summaries
    .map((summary) => ({
      ...summary,
      sourceItemIds: summary.sourceItemIds.filter((id) => !removedSet.has(id))
    }))
    .filter((summary) => summary.sourceItemIds.length > 0);

  store.index = buildIndex(store.items);
  await saveMemoryStore(rootDir, store);

  return { removed: removedIds.length, removedIds };
}

export async function pruneMemory(rootDir: string): Promise<PruneMemoryResult> {
  const store = await loadMemoryStore(rootDir);

  const beforeCount = store.items.length;
  const expiredIds = new Set(store.items.filter((item) => isExpired(item)).map((item) => item.id));
  let remaining = store.items.filter((item) => !expiredIds.has(item.id));

  const deduped = dedupeBySimilarity(remaining);
  remaining = deduped.kept;

  // Remove low value notes that are old and rarely used.
  const lowValueIds = new Set(
    remaining
      .filter((item) => item.type === "note")
      .filter((item) => item.importance <= 2)
      .filter((item) => item.useCount === 0)
      .filter((item) => Date.now() - Date.parse(item.createdAt) > 1000 * 60 * 60 * 24 * 45)
      .map((item) => item.id)
  );

  remaining = remaining.filter((item) => !lowValueIds.has(item.id));
  store.items = remaining;

  const removedAll = new Set<string>([...expiredIds, ...deduped.removedIds, ...lowValueIds]);
  store.summaries = store.summaries
    .map((summary) => ({
      ...summary,
      sourceItemIds: summary.sourceItemIds.filter((id) => !removedAll.has(id))
    }))
    .filter((summary) => summary.sourceItemIds.length > 0);

  store.index = buildIndex(store.items);
  await saveMemoryStore(rootDir, store);

  return {
    removedDuplicate: deduped.removedIds.size,
    removedExpired: expiredIds.size,
    removedLowValue: lowValueIds.size,
    remaining: store.items.length
  };
}

export async function summarizeMemory(rootDir: string): Promise<SummarizeMemoryResult> {
  const store = await loadMemoryStore(rootDir);

  const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 21;
  const candidates = store.items
    .filter((item) => Date.parse(item.updatedAt) < cutoff)
    .filter((item) => item.useCount <= 1)
    .filter((item) => item.type !== "rule" && item.type !== "warning")
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));

  const grouped = new Map<MemoryType, MemoryItem[]>();
  for (const item of candidates) {
    const list = grouped.get(item.type) ?? [];
    list.push(item);
    grouped.set(item.type, list);
  }

  const now = nowIso();
  const summaries: MemorySummary[] = [];
  const consumedIds = new Set<string>();

  for (const [type, items] of grouped.entries()) {
    if (items.length < 3) {
      continue;
    }

    const top = items.slice(0, 10);
    const summaryText = `${type} summary: ${top.map((item) => item.text).join(" | ").slice(0, 800)}`;
    const summary: MemorySummary = {
      id: `sum_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      text: redactSensitive(summaryText),
      sourceItemIds: top.map((item) => item.id),
      createdAt: now,
      updatedAt: now
    };

    for (const item of top) {
      consumedIds.add(item.id);
    }

    summaries.push(summary);
  }

  if (summaries.length === 0) {
    return {
      createdSummaries: 0,
      removedItems: 0,
      summaries: []
    };
  }

  store.summaries = [...summaries, ...store.summaries].slice(0, 200);
  store.items = store.items.filter((item) => !consumedIds.has(item.id));
  store.index = buildIndex(store.items);

  await saveMemoryStore(rootDir, store);

  return {
    createdSummaries: summaries.length,
    removedItems: consumedIds.size,
    summaries
  };
}

export async function buildMemoryContext(rootDir: string, input: BuildMemoryContextInput): Promise<BuildMemoryContextResult> {
  const config = {
    ...(await getMemoryConfig(rootDir)),
    ...(input.config ?? {})
  };

  if (!config.enabled) {
    return {
      includedItems: [],
      includedSummaries: [],
      excluded: [],
      sections: {
        persistentMemory: [],
        memoryDecisions: [],
        projectState: [],
        excludedMemory: ["Memory disabled by config"]
      },
      tokenEstimate: 0
    };
  }

  const store = await loadMemoryStore(rootDir);

  // Always include all non-expired rule and warning items regardless of maxItems cap.
  // These are the enforcement anchors for self-healing and must never be silently dropped.
  const ALWAYS_INCLUDE_TYPES = new Set<MemoryType>(["rule", "warning"]);
  const alwaysIncluded = store.items.filter(
    (item) =>
      ALWAYS_INCLUDE_TYPES.has(item.type) &&
      !isExpired(item) &&
      config.includeTypes.includes(item.type) &&
      !config.excludeTypes.includes(item.type)
  );
  const alwaysIncludedIds = new Set(alwaysIncluded.map((item) => item.id));

  // Fill remaining budget with relevance-scored items, excluding already-guaranteed ones.
  const remainingBudget = Math.max(0, config.maxItems - alwaysIncluded.length);
  const scored = await searchMemory(rootDir, {
    query: input.query,
    includeTypes: config.includeTypes,
    excludeTypes: config.excludeTypes,
    maxItems: remainingBudget + alwaysIncluded.length, // over-fetch then filter
    maxTokens: config.maxTokens
  });
  const additionalItems = scored.filter((item) => !alwaysIncludedIds.has(item.id)).slice(0, remainingBudget);
  const relevant = [...alwaysIncluded, ...additionalItems];

  const includedIds = new Set(relevant.map((item) => item.id));
  const excluded: Array<{ id: string; reason: string }> = [];

  for (const item of store.items) {
    if (includedIds.has(item.id)) {
      continue;
    }

    if (config.excludeTypes.includes(item.type)) {
      excluded.push({ id: item.id, reason: `type excluded (${item.type})` });
      continue;
    }

    if (!config.includeTypes.includes(item.type)) {
      excluded.push({ id: item.id, reason: `type not included (${item.type})` });
      continue;
    }

    if (isExpired(item)) {
      excluded.push({ id: item.id, reason: "expired" });
      continue;
    }

    excluded.push({ id: item.id, reason: "not relevant to current query" });
  }

  const summaries = store.summaries
    .filter((summary) => summary.sourceItemIds.some((id) => includedIds.has(id)))
    .slice(0, 4);

  const summaryLines = summaries.map((summary) => `[summary] ${summary.text}`);
  const rawLines = relevant.map((item) => `[${item.type}] ${item.text}`);
  const persistentMemory = [...summaryLines, ...rawLines].slice(0, config.maxItems);
  const memoryDecisions = relevant
    .filter((item) => item.type === "decision" || item.type === "rule" || item.type === "warning")
    .map((item) => `${item.text} (${item.id})`)
    .slice(0, 6);

  const projectState = relevant
    .filter((item) => item.type === "project_state" || item.type === "fact")
    .map((item) => `${item.text} (${item.id})`)
    .slice(0, 6);

  const excludedMemory = excluded.slice(0, 10).map((item) => `${item.id}: ${item.reason}`);

  const tokenEstimate = estimateTokens([...persistentMemory, ...memoryDecisions, ...projectState].join("\n"));

  return {
    includedItems: relevant,
    includedSummaries: summaries,
    excluded,
    sections: {
      persistentMemory,
      memoryDecisions,
      projectState,
      excludedMemory
    },
    tokenEstimate
  };
}
