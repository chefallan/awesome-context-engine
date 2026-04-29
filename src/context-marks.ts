import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { canUseGenesis, getRecallNotes, getRelevantDecisions } from "./genesis.js";
import { generateGraphContext, readGraphData, type GraphData } from "./graph.js";
import { getContextPaths } from "./templates.js";

const ACE_DNA_TAG = "@ace-dna";
const MAX_HEADER_CHARS = 650;
const DEFAULT_MAX_RELATED = 6;

type LanguageKind = "block" | "hash" | "markdown";

type FileContextEntry = {
  provides: string[];
  consumed_by: string[];
  related: string[];
  constraints: string[];
  summary: string;
};

type ImpactEntry = {
  direct: string[];
  transitive: string[];
  tests: string[];
  docs: string[];
  routes: string[];
  components: string[];
  configs: string[];
};

export type FileContextData = {
  version: 1;
  generatedAt: string;
  files: Record<string, FileContextEntry>;
};

export type ImpactMapData = {
  version: 1;
  generatedAt: string;
  files: Record<string, ImpactEntry>;
};

export type ContextRefreshResult = {
  metadataPath: string;
  impactMapPath: string;
  graphPath: string;
  data: FileContextData;
  impact: ImpactMapData;
  written: boolean;
};

export type ContextMarkResult = {
  metadataPath: string;
  metadataWritten: boolean;
  filesUpdated: string[];
  filesUnchanged: string[];
};

export type ContextCheckIssue = {
  file: string;
  status: "missing" | "stale" | "duplicate" | "malformed" | "oversized";
  detail?: string;
};

export type ContextCheckResult = {
  metadataPath: string;
  issues: ContextCheckIssue[];
  checkedFiles: number;
};

export type ContextImpactResult = {
  target: string;
  provides: string[];
  directConsumers: string[];
  transitiveConsumers: string[];
  tests: string[];
  docs: string[];
  routes: string[];
  components: string[];
  configs: string[];
  related: string[];
};

export type ContextPack = {
  file: string;
  purpose: string;
  provides: string[];
  consumedBy: string[];
  constraints: string[];
  related: string[];
  likelyImpacted: string[];
  recommendedRead: string[];
  relevantDecisions: string[];
  relevantPreferences: string[];
  suggestedTests: string[];
  warnings: string[];
  sourceSnippets: Array<{ file: string; content: string }>;
};

type ContextPackOptions = ContextMarksOptions & {
  copy?: boolean;
  includeSource?: boolean;
  tokens?: number;
  maxFiles?: number;
};

export type ContextMarksOptions = {
  dryRun?: boolean;
  include?: string[];
  exclude?: string[];
  limit?: number;
  maxRelated?: number;
};

type Scope = {
  include: string[];
  exclude: string[];
};

const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".php",
  ".rb",
  ".rs",
  ".java",
  ".kt",
  ".cs",
  ".md",
  ".sh",
  ".yml",
  ".yaml"
]);

const JS_TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const HASH_COMMENT_EXTENSIONS = new Set([".py", ".rb", ".sh", ".yml", ".yaml"]);

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function uniqueSorted(items: string[], limit?: number): string[] {
  const out = [...new Set(items.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return typeof limit === "number" ? out.slice(0, Math.max(0, limit)) : out;
}

function normalizeScopePath(value: string): string {
  const normalized = normalizePath(value).replace(/^\.\//, "").replace(/^\//, "").trim();
  if (!normalized) return "";
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function buildScope(options: ContextMarksOptions): Scope {
  return {
    include: uniqueSorted((options.include ?? []).map(normalizeScopePath).filter(Boolean)),
    exclude: uniqueSorted((options.exclude ?? []).map(normalizeScopePath).filter(Boolean))
  };
}

function inScope(filePath: string, scope: Scope): boolean {
  const normalized = normalizePath(filePath);
  if (scope.include.length > 0 && !scope.include.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }
  if (scope.exclude.length > 0 && scope.exclude.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }
  return true;
}

function isSupportedFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) return false;
  const lower = normalizePath(filePath).toLowerCase();
  if (lower.startsWith(".awesome-context/") || lower.startsWith("dist/") || lower.startsWith("build/") || lower.startsWith("vendor/")) return false;
  if (["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"].includes(path.basename(lower))) return false;
  if (lower.endsWith(".min.js")) return false;
  return true;
}

function languageKindForFile(filePath: string): LanguageKind {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md") return "markdown";
  if (HASH_COMMENT_EXTENSIONS.has(ext)) return "hash";
  return "block";
}

function edgeFileIdToPath(id: string): string | null {
  if (!id.startsWith("file:")) return null;
  return id.slice(5);
}

function nodeMap(graph: GraphData): Map<string, (typeof graph.nodes)[number]> {
  return new Map(graph.nodes.map((node) => [node.path, node]));
}

function reverseImportMap(graph: GraphData): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.type !== "imports") continue;
    const from = edgeFileIdToPath(edge.from);
    const to = edgeFileIdToPath(edge.to);
    if (!from || !to) continue;
    const current = map.get(to) ?? [];
    current.push(from);
    map.set(to, current);
  }

  for (const [key, value] of map.entries()) {
    map.set(key, uniqueSorted(value));
  }
  return map;
}

function importMap(graph: GraphData): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.type !== "imports") continue;
    const from = edgeFileIdToPath(edge.from);
    const to = edgeFileIdToPath(edge.to);
    if (!from || !to) continue;
    const current = map.get(from) ?? [];
    current.push(to);
    map.set(from, current);
  }
  for (const [key, value] of map.entries()) {
    map.set(key, uniqueSorted(value));
  }
  return map;
}

function parseConstraintLine(value: string): string[] {
  if (!value || value === "-") return [];
  return value
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2)
    .slice(0, 6);
}

function parseManagedHeader(source: string): { constraints: string[] } | null {
  const range = findAceDnaRange(source);
  if (!range) return null;

  const block = source.slice(range.start, range.end);
  if (!block.includes(ACE_DNA_TAG)) return null;

  const line = block
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.includes("constraints:"));

  if (!line) return { constraints: [] };
  const value = line.split("constraints:")[1]?.trim() ?? "";
  return { constraints: parseConstraintLine(value) };
}

function sanitizeConstraint(line: string): string {
  return line
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^`+|`+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractConstraintLines(markdown: string): string[] {
  const result: string[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith("<!--")) continue;
    const cleaned = sanitizeConstraint(line);
    if (cleaned.length < 8 || cleaned.length > 90) continue;
    if (!/[a-zA-Z]/.test(cleaned)) continue;
    result.push(cleaned);
  }
  return uniqueSorted(result, 3);
}

async function deriveGlobalConstraints(rootDir: string): Promise<string[]> {
  const paths = getContextPaths(rootDir);
  const files = [paths.preferencesPath, paths.decisionsPath];
  const constraints: string[] = [];

  for (const filePath of files) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      for (const line of extractConstraintLines(raw)) {
        if (!constraints.includes(line)) constraints.push(line);
        if (constraints.length >= 3) return constraints;
      }
    } catch {
      continue;
    }
  }

  return constraints;
}

function summarizePurpose(node: { symbols: string[]; tags: string[]; path: string }): string {
  if (node.symbols.length > 0) {
    const head = node.symbols.slice(0, 3).join(", ");
    return `Defines ${head}.`;
  }
  if (node.tags.includes("route")) return "Route handling module.";
  if (node.tags.includes("component")) return "UI component module.";
  if (node.tags.includes("config")) return "Configuration module.";
  if (node.tags.includes("docs")) return "Documentation file.";
  return `Module file: ${node.path}`;
}

function buildImpactMap(graph: GraphData, scope: Scope): ImpactMapData {
  const reverse = reverseImportMap(graph);
  const nodesByPath = nodeMap(graph);
  const result: Record<string, ImpactEntry> = {};

  for (const node of graph.nodes) {
    if (!isSupportedFile(node.path) || !inScope(node.path, scope)) continue;

    const direct = (reverse.get(node.path) ?? []).filter((filePath) => inScope(filePath, scope));
    const queue = [...direct];
    const visited = new Set(direct);
    const transitive: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const nexts = reverse.get(current) ?? [];
      for (const next of nexts) {
        if (!inScope(next, scope)) continue;
        if (next === node.path || visited.has(next)) continue;
        visited.add(next);
        transitive.push(next);
        queue.push(next);
      }
    }

    const all = uniqueSorted([...direct, ...transitive]);
    const tests = all.filter((filePath) => nodesByPath.get(filePath)?.tags.includes("test"));
    const docs = all.filter((filePath) => nodesByPath.get(filePath)?.tags.includes("docs"));
    const routes = all.filter((filePath) => nodesByPath.get(filePath)?.tags.includes("route"));
    const components = all.filter((filePath) => nodesByPath.get(filePath)?.tags.includes("component"));
    const configs = all.filter((filePath) => nodesByPath.get(filePath)?.tags.includes("config"));

    result[node.path] = {
      direct: uniqueSorted(direct),
      transitive: uniqueSorted(transitive),
      tests: uniqueSorted(tests),
      docs: uniqueSorted(docs),
      routes: uniqueSorted(routes),
      components: uniqueSorted(components),
      configs: uniqueSorted(configs)
    };
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    files: result
  };
}

function truncateEntry(entry: FileContextEntry, maxRelated: number): FileContextEntry {
  return {
    provides: uniqueSorted(entry.provides, 8),
    consumed_by: uniqueSorted(entry.consumed_by, maxRelated),
    related: uniqueSorted(entry.related, maxRelated),
    constraints: uniqueSorted(entry.constraints, 4),
    summary: entry.summary
  };
}

function buildHeaderBlock(filePath: string, entry: FileContextEntry): string {
  const kind = languageKindForFile(filePath);
  const provides = entry.provides.length > 0 ? entry.provides.join(", ") : "-";
  const consumedBy = entry.consumed_by.length > 0 ? entry.consumed_by.join(", ") : "-";
  const constraints = entry.constraints.length > 0 ? entry.constraints.join("; ") : "-";
  const related = entry.related.length > 0 ? entry.related.join(", ") : "-";

  if (kind === "markdown") {
    return ["<!--", `@ace-dna`, `provides: ${provides}`, `consumed_by: ${consumedBy}`, `constraints: ${constraints}`, `related: ${related}`, "-->"]
      .join("\n");
  }

  if (kind === "hash") {
    return [
      `# @ace-dna`,
      `# provides: ${provides}`,
      `# consumed_by: ${consumedBy}`,
      `# constraints: ${constraints}`,
      `# related: ${related}`
    ].join("\n");
  }

  return [
    "/**",
    ` * @ace-dna`,
    ` * provides: ${provides}`,
    ` * consumed_by: ${consumedBy}`,
    ` * constraints: ${constraints}`,
    ` * related: ${related}`,
    " */"
  ].join("\n");
}

function findAceDnaRanges(source: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];

  const blockRegex = /(?:^|\n)\s*\/\*\*[\s\S]{0,2000}?@ace-dna[\s\S]{0,2000}?\*\//g;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRegex.exec(source)) !== null) {
    const value = blockMatch[0] ?? "";
    if (value.includes("provides:") && value.includes("consumed_by:") && value.includes("related:")) {
      const start = source[blockMatch.index] === "\n" ? blockMatch.index + 1 : blockMatch.index;
      ranges.push({ start, end: blockMatch.index + value.length });
    }
  }

  const htmlRegex = /(?:^|\n)\s*<!--[\s\S]{0,2000}?@ace-dna[\s\S]{0,2000}?-->/g;
  let htmlMatch: RegExpExecArray | null;
  while ((htmlMatch = htmlRegex.exec(source)) !== null) {
    const value = htmlMatch[0] ?? "";
    if (value.includes("provides:") && value.includes("consumed_by:") && value.includes("related:")) {
      const start = source[htmlMatch.index] === "\n" ? htmlMatch.index + 1 : htmlMatch.index;
      ranges.push({ start, end: htmlMatch.index + value.length });
    }
  }

  const lines = source.split(/\r?\n/);
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed.startsWith("# @ace-dna")) {
      offset += line.length + 1;
      continue;
    }

    let startOffset = offset;
    let j = i - 1;
    while (j >= 0 && lines[j].trim().startsWith("#")) {
      startOffset -= lines[j].length + 1;
      j -= 1;
    }

    let endOffset = offset + line.length + 1;
    let k = i + 1;
    while (k < lines.length && lines[k].trim().startsWith("#")) {
      endOffset += lines[k].length + 1;
      k += 1;
    }

    const value = source.slice(startOffset, Math.min(endOffset, source.length));
    if (value.includes("provides:") && value.includes("consumed_by:") && value.includes("related:")) {
      ranges.push({ start: startOffset, end: Math.min(endOffset, source.length) });
    }

    i = k - 1;
    offset = endOffset;
  }

  return ranges.sort((a, b) => a.start - b.start);
}

function findAceDnaRange(source: string): { start: number; end: number } | null {
  const ranges = findAceDnaRanges(source);
  return ranges.length > 0 ? ranges[0] : null;
}

function findInsertOffset(source: string, filePath: string): number {
  let offset = 0;

  if (source.startsWith("#!")) {
    const newline = source.indexOf("\n");
    offset = newline >= 0 ? newline + 1 : source.length;
  }

  if (source.startsWith("/*") && source.includes("*/")) {
    const close = source.indexOf("*/");
    if (close >= 0 && close + 2 > offset && close < 5000) {
      const preview = source.slice(0, close + 2).toLowerCase();
      if (preview.includes("license") || preview.includes("copyright")) {
        offset = close + 2;
        if (source.slice(offset, offset + 1) === "\n") offset += 1;
      }
    }
  }

  if (path.extname(filePath).toLowerCase() === ".py") {
    const after = source.slice(offset);
    const lineEnd = after.indexOf("\n");
    const firstLine = lineEnd >= 0 ? after.slice(0, lineEnd) : after;
    if (/coding[:=]/.test(firstLine)) {
      offset += lineEnd >= 0 ? lineEnd + 1 : firstLine.length;
    }
  }

  return offset;
}

function applyHeader(source: string, filePath: string, header: string): { next: string; changed: boolean } {
  const range = findAceDnaRange(source);

  if (range) {
    const current = source.slice(range.start, range.end).trim();
    if (current === header.trim()) {
      return { next: source, changed: false };
    }

    const leading = source.slice(0, range.start);
    const trailing = source.slice(range.end);
    const replacement = `${header}\n\n`;
    const next = `${leading}${replacement}${trailing.replace(/^\s*/, "")}`;
    return { next, changed: true };
  }

  const offset = findInsertOffset(source, filePath);
  const prefix = source.slice(0, offset);
  const suffix = source.slice(offset);
  const spacer = suffix.startsWith("\n") ? "" : "\n";
  const next = `${prefix}${header}\n${spacer}${suffix}`;
  return { next, changed: true };
}

async function readRepoNotes(rootDir: string): Promise<string[]> {
  const paths = getContextPaths(rootDir);
  const files = [paths.memoryPath, paths.decisionsPath, paths.workflowsPath, paths.preferencesPath];
  const notes: string[] = [];

  for (const filePath of files) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim().replace(/^[-*]\s+/, "");
        if (!trimmed || trimmed.startsWith("#") || trimmed.length < 12 || trimmed.length > 120) continue;
        notes.push(trimmed);
      }
    } catch {
      continue;
    }
  }

  return uniqueSorted(notes, 8);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function buildRecommendedRead(entry: FileContextEntry, impact: ImpactEntry): string[] {
  return uniqueSorted([
    ...entry.related,
    ...entry.consumed_by,
    ...impact.tests,
    ...impact.routes,
    ...impact.components,
    ...impact.configs,
    ...impact.docs
  ], 10);
}

async function tryCopyToClipboard(text: string): Promise<boolean> {
  const attempts: Array<{ cmd: string; args: string[]; useStdin: boolean }> =
    process.platform === "win32"
      ? [{ cmd: "clip", args: [], useStdin: true }]
      : process.platform === "darwin"
        ? [{ cmd: "pbcopy", args: [], useStdin: true }]
        : [
            { cmd: "wl-copy", args: [], useStdin: true },
            { cmd: "xclip", args: ["-selection", "clipboard"], useStdin: true },
            { cmd: "xsel", args: ["--clipboard", "--input"], useStdin: true }
          ];

  for (const attempt of attempts) {
    try {
      execFileSync(attempt.cmd, attempt.args, { input: text, stdio: ["pipe", "ignore", "ignore"] });
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

function renderPackMarkdown(pack: ContextPack): string {
  const renderList = (items: string[]) => (items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none");

  const sourceBlock =
    pack.sourceSnippets.length > 0
      ? `\nSource:\n${pack.sourceSnippets
          .map((snippet) => `\n### ${snippet.file}\n\n\`\`\`text\n${snippet.content}\n\`\`\``)
          .join("\n")}`
      : "";

  return `# Context Pack: ${pack.file}\n\nPurpose:\n${pack.purpose}\n\nProvides:\n${renderList(pack.provides)}\n\nConsumed by:\n${renderList(pack.consumedBy)}\n\nConstraints:\n${renderList(pack.constraints)}\n\nLikely impacted:\n${renderList(pack.likelyImpacted)}\n\nRecommended files to read:\n${renderList(pack.recommendedRead)}\n\nRelevant decisions:\n${renderList(pack.relevantDecisions)}\n\nRelevant preferences:\n${renderList(pack.relevantPreferences)}\n\nSuggested tests:\n${renderList(pack.suggestedTests)}\n\nWarnings:\n${renderList(pack.warnings)}${sourceBlock}\n`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function applyTokenBudget(items: string[], tokenBudget: number): string[] {
  if (tokenBudget <= 0) {
    return [];
  }

  const kept: string[] = [];
  let used = 0;
  for (const item of items) {
    const itemTokens = estimateTokens(item) + 2;
    if (used + itemTokens > tokenBudget) {
      break;
    }
    kept.push(item);
    used += itemTokens;
  }

  return kept;
}

async function readNoteLines(filePath: string, limit: number): Promise<string[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return uniqueSorted(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/^[-*]\s+/, ""))
        .filter((line) => Boolean(line) && !line.startsWith("#") && line.length >= 10 && line.length <= 140),
      limit
    );
  } catch {
    return [];
  }
}

async function buildSourceSnippets(rootDir: string, files: string[], tokenBudget: number): Promise<Array<{ file: string; content: string }>> {
  const snippets: Array<{ file: string; content: string }> = [];
  let remaining = tokenBudget;

  for (const filePath of files) {
    if (remaining <= 0) {
      break;
    }

    try {
      const absolutePath = path.join(rootDir, filePath);
      const raw = await fs.readFile(absolutePath, "utf8");
      const normalized = raw.trimEnd();
      const sourceTokens = estimateTokens(normalized);
      if (sourceTokens <= remaining) {
        snippets.push({ file: filePath, content: normalized });
        remaining -= sourceTokens;
      } else {
        const approxChars = Math.max(120, remaining * 4);
        const trimmed = `${normalized.slice(0, approxChars)}\n... [truncated by --tokens budget]`;
        snippets.push({ file: filePath, content: trimmed });
        remaining = 0;
      }
    } catch {
      continue;
    }
  }

  return snippets;
}

function buildFileContext(graph: GraphData, scope: Scope, preservedConstraints: Map<string, string[]>, globalConstraints: string[]): FileContextData {
  const nodes = graph.nodes.filter((node) => isSupportedFile(node.path) && inScope(node.path, scope));
  const reverse = reverseImportMap(graph);
  const imports = importMap(graph);
  const byPath = nodeMap(graph);
  const files: Record<string, FileContextEntry> = {};

  for (const node of nodes) {
    const consumedBy = (reverse.get(node.path) ?? []).filter((filePath) => inScope(filePath, scope));
    const importsForNode = (imports.get(node.path) ?? []).filter((filePath) => inScope(filePath, scope));
    const nearby = nodes
      .filter((candidate) => candidate.path !== node.path && path.posix.dirname(candidate.path) === path.posix.dirname(node.path))
      .map((candidate) => candidate.path)
      .slice(0, 2);

    const entry: FileContextEntry = {
      provides: uniqueSorted(node.symbols, 8),
      consumed_by: uniqueSorted(consumedBy, 8),
      related: uniqueSorted([...importsForNode, ...consumedBy, ...nearby], DEFAULT_MAX_RELATED),
      constraints: uniqueSorted([...(preservedConstraints.get(node.path) ?? []), ...globalConstraints], 4),
      summary: summarizePurpose(node)
    };

    files[node.path] = entry;
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    files
  };
}

async function readPreservedConstraints(rootDir: string, graph: GraphData): Promise<Map<string, string[]>> {
  const constraints = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (!isSupportedFile(node.path)) continue;
    try {
      const raw = await fs.readFile(path.join(rootDir, node.path), "utf8");
      const parsed = parseManagedHeader(raw);
      if (parsed && parsed.constraints.length > 0) {
        constraints.set(node.path, uniqueSorted(parsed.constraints, 4));
      }
    } catch {
      continue;
    }
  }
  return constraints;
}

async function ensureGraph(rootDir: string, dryRun: boolean): Promise<{ graphPath: string; graph: GraphData }> {
  const existing = await readGraphData(rootDir);
  if (existing) {
    return { graphPath: getContextPaths(rootDir).graphJsonPath, graph: existing };
  }

  const generated = await generateGraphContext(rootDir, {});
  if (dryRun) {
    try {
      await fs.rm(generated.graphPath, { force: true });
    } catch {
      // noop
    }
  }

  return { graphPath: generated.graphPath, graph: generated.graph };
}

function parseNumberOption(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function withEntryLimits(data: FileContextData, options: ContextMarksOptions): FileContextData {
  const maxRelated = parseNumberOption(options.maxRelated) ?? DEFAULT_MAX_RELATED;
  const files: Record<string, FileContextEntry> = {};

  for (const [filePath, entry] of Object.entries(data.files)) {
    files[filePath] = truncateEntry(entry, maxRelated);
  }

  return {
    version: data.version,
    generatedAt: data.generatedAt,
    files
  };
}

export async function refreshContextMarks(rootDir: string, options: ContextMarksOptions = {}): Promise<ContextRefreshResult> {
  const dryRun = Boolean(options.dryRun);
  const scope = buildScope(options);
  const paths = getContextPaths(rootDir);

  await fs.mkdir(paths.contextDir, { recursive: true });
  const graphResult = await generateGraphContext(rootDir, { dryRun });

  const preserved = await readPreservedConstraints(rootDir, graphResult.graph);
  const globalConstraints = await deriveGlobalConstraints(rootDir);
  const built = buildFileContext(graphResult.graph, scope, preserved, globalConstraints);
  const data = withEntryLimits(built, options);
  const impact = buildImpactMap(graphResult.graph, scope);

  if (!dryRun) {
    await fs.writeFile(paths.fileContextPath, JSON.stringify(data, null, 2), "utf8");
    await fs.writeFile(paths.impactMapPath, JSON.stringify(impact, null, 2), "utf8");
  }

  return {
    metadataPath: paths.fileContextPath,
    impactMapPath: paths.impactMapPath,
    graphPath: graphResult.graphPath,
    data,
    impact,
    written: !dryRun
  };
}

export async function markContextFiles(rootDir: string, options: ContextMarksOptions = {}): Promise<ContextMarkResult> {
  const dryRun = Boolean(options.dryRun);
  const refresh = await refreshContextMarks(rootDir, {
    dryRun,
    include: options.include,
    exclude: options.exclude,
    maxRelated: options.maxRelated
  });

  const filesUpdated: string[] = [];
  const filesUnchanged: string[] = [];
  const limit = parseNumberOption(options.limit);

  const entries = Object.entries(refresh.data.files)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, limit ?? Number.MAX_SAFE_INTEGER);

  for (const [filePath, entry] of entries) {
    const absolutePath = path.join(rootDir, filePath);
    let raw = "";

    try {
      raw = await fs.readFile(absolutePath, "utf8");
    } catch {
      filesUnchanged.push(filePath);
      continue;
    }

    const header = buildHeaderBlock(filePath, entry);
    if (header.length > MAX_HEADER_CHARS) {
      filesUnchanged.push(filePath);
      continue;
    }

    const applied = applyHeader(raw, filePath, header);
    if (!applied.changed) {
      filesUnchanged.push(filePath);
      continue;
    }

    if (!dryRun) {
      await fs.writeFile(absolutePath, applied.next, "utf8");
    }

    filesUpdated.push(filePath);
  }

  return {
    metadataPath: refresh.metadataPath,
    metadataWritten: refresh.written,
    filesUpdated,
    filesUnchanged
  };
}

function isMalformedBlock(block: string): boolean {
  const required = ["provides:", "consumed_by:", "constraints:", "related:"];
  return required.some((key) => !block.includes(key));
}

export async function checkContextMarks(
  rootDir: string,
  options: ContextMarksOptions & { ci?: boolean } = {}
): Promise<ContextCheckResult> {
  const refreshed = await refreshContextMarks(rootDir, {
    dryRun: true,
    include: options.include,
    exclude: options.exclude,
    maxRelated: options.maxRelated
  });

  const issues: ContextCheckIssue[] = [];

  for (const [filePath, entry] of Object.entries(refreshed.data.files).sort((a, b) => a[0].localeCompare(b[0]))) {
    const absolutePath = path.join(rootDir, filePath);
    let raw = "";

    try {
      raw = await fs.readFile(absolutePath, "utf8");
    } catch {
      continue;
    }

    const ranges = findAceDnaRanges(raw);
    if (ranges.length === 0) {
      issues.push({ file: filePath, status: "missing" });
      continue;
    }
    if (ranges.length > 1) {
      issues.push({ file: filePath, status: "duplicate", detail: `found ${ranges.length} @ace-dna blocks` });
      continue;
    }

    const range = ranges[0];
    const current = raw.slice(range.start, range.end).trim();
    if (current.length > MAX_HEADER_CHARS) {
      issues.push({ file: filePath, status: "oversized", detail: `${current.length} chars` });
    }
    if (isMalformedBlock(current)) {
      issues.push({ file: filePath, status: "malformed" });
      continue;
    }

    const expected = buildHeaderBlock(filePath, entry).trim();
    if (current !== expected) {
      issues.push({ file: filePath, status: "stale" });
    }
  }

  return {
    metadataPath: refreshed.metadataPath,
    issues,
    checkedFiles: Object.keys(refreshed.data.files).length
  };
}

export async function impactContextMarks(
  rootDir: string,
  inputFile: string,
  options: ContextMarksOptions = {}
): Promise<ContextImpactResult> {
  const scope = buildScope(options);
  const paths = getContextPaths(rootDir);
  const metadata = await readJsonFile<FileContextData>(paths.fileContextPath);
  const impactData = await readJsonFile<ImpactMapData>(paths.impactMapPath);
  const graph = await readGraphData(rootDir);

  if (!metadata || !impactData || !graph) {
    throw new Error("Context artifacts are missing or stale. Run 'ace context:refresh' and try again.");
  }

  const normalized = normalizePath(inputFile);
  const target = normalized in metadata.files ? normalized : normalizePath(path.relative(rootDir, path.resolve(rootDir, inputFile)));

  const entry = metadata.files[target];
  if (!entry) {
    throw new Error(`Context artifacts are stale for '${inputFile}'. Run 'ace context:refresh' and try again.`);
  }

  if (!inScope(target, scope)) {
    throw new Error(`File is out of current scope: ${target}`);
  }

  const impact = impactData.files[target] ?? {
    direct: [],
    transitive: [],
    tests: [],
    docs: [],
    routes: [],
    components: [],
    configs: []
  };

  const filterScope = (items: string[]): string[] => items.filter((item) => inScope(item, scope));

  return {
    target,
    provides: entry.provides,
    directConsumers: filterScope(impact.direct),
    transitiveConsumers: filterScope(impact.transitive),
    tests: filterScope(impact.tests),
    docs: filterScope(impact.docs),
    routes: filterScope(impact.routes),
    components: filterScope(impact.components),
    configs: filterScope(impact.configs),
    related: filterScope(entry.related)
  };
}

export async function buildContextPack(
  rootDir: string,
  inputFile: string,
  options: ContextPackOptions = {}
): Promise<{ markdown: string; pack: ContextPack; copied: boolean }> {
  const refreshed = await refreshContextMarks(rootDir, {
    dryRun: false,
    include: options.include,
    exclude: options.exclude,
    maxRelated: options.maxRelated
  });

  const normalized = normalizePath(inputFile);
  const target = normalized in refreshed.data.files ? normalized : normalizePath(path.relative(rootDir, path.resolve(rootDir, inputFile)));

  const impactData = refreshed.impact.files[target] ?? {
    direct: [],
    transitive: [],
    tests: [],
    docs: [],
    routes: [],
    components: [],
    configs: []
  };

  const impact: ContextImpactResult = {
    target,
    provides: refreshed.data.files[target]?.provides ?? [],
    directConsumers: impactData.direct,
    transitiveConsumers: impactData.transitive,
    tests: impactData.tests,
    docs: impactData.docs,
    routes: impactData.routes,
    components: impactData.components,
    configs: impactData.configs,
    related: refreshed.data.files[target]?.related ?? []
  };

  const entry = refreshed.data.files[impact.target];
  if (!entry) {
    throw new Error(`Context pack file not found: ${inputFile}`);
  }

  const tokenBudget = Math.max(500, options.tokens ?? 4000);
  const maxFiles = Math.max(1, options.maxFiles ?? 8);
  const contextPaths = getContextPaths(rootDir);

  const [fileDecisions, filePreferences] = await Promise.all([
    readNoteLines(contextPaths.decisionsPath, 12),
    readNoteLines(contextPaths.preferencesPath, 12)
  ]);

  const genesisEnabled = await canUseGenesis(rootDir);
  const recallNotes = genesisEnabled ? await getRecallNotes(rootDir, `${impact.target} ${entry.summary}`, 4) : [];
  const likelyImpacted = uniqueSorted([...impact.directConsumers, ...impact.transitiveConsumers], Math.max(6, maxFiles * 2));
  const recommendedReadRaw = buildRecommendedRead(entry, impactData).slice(0, maxFiles);
  const suggestedTestsRaw = uniqueSorted([...impact.tests, ...recommendedReadRaw.filter((item) => /test|spec/i.test(item))], maxFiles);

  const warnings: string[] = [];
  if (likelyImpacted.length === 0) {
    warnings.push("No downstream consumers detected from the current graph snapshot.");
  }
  if (!genesisEnabled) {
    warnings.push("ACE Genesis is disabled; recall comes only from local decisions/preferences files.");
  }

  const sourceFiles = [impact.target, ...recommendedReadRaw.filter((filePath) => filePath !== impact.target)].slice(0, maxFiles);
  const sourceSnippets = options.includeSource ? await buildSourceSnippets(rootDir, sourceFiles, Math.floor(tokenBudget * 0.35)) : [];

  const pack: ContextPack = {
    file: impact.target,
    purpose: entry.summary,
    provides: entry.provides,
    consumedBy: entry.consumed_by,
    constraints: entry.constraints,
    related: entry.related,
    likelyImpacted: applyTokenBudget(likelyImpacted, Math.floor(tokenBudget * 0.16)),
    recommendedRead: applyTokenBudget(recommendedReadRaw, Math.floor(tokenBudget * 0.14)),
    relevantDecisions: applyTokenBudget(uniqueSorted([...fileDecisions, ...recallNotes], 12), Math.floor(tokenBudget * 0.18)),
    relevantPreferences: applyTokenBudget(filePreferences, Math.floor(tokenBudget * 0.14)),
    suggestedTests: applyTokenBudget(suggestedTestsRaw, Math.floor(tokenBudget * 0.1)),
    warnings,
    sourceSnippets
  };

  const markdown = renderPackMarkdown(pack);
  const copied = options.copy ? await tryCopyToClipboard(markdown) : false;

  return { markdown, pack, copied };
}

export async function explainContextFile(rootDir: string, inputFile: string, options: ContextMarksOptions = {}): Promise<string> {
  const refreshed = await refreshContextMarks(rootDir, {
    dryRun: true,
    include: options.include,
    exclude: options.exclude,
    maxRelated: options.maxRelated
  });

  const normalized = normalizePath(inputFile);
  const target = normalized in refreshed.data.files ? normalized : normalizePath(path.relative(rootDir, path.resolve(rootDir, inputFile)));
  const entry = refreshed.data.files[target];
  if (!entry) {
    throw new Error(`Explain target not found: ${inputFile}`);
  }

  const impact = refreshed.impact.files[target] ?? {
    direct: [],
    transitive: [],
    tests: [],
    docs: [],
    routes: [],
    components: [],
    configs: []
  };

  const genesisEnabled = await canUseGenesis(rootDir);
  const priorDecisions = genesisEnabled ? await getRelevantDecisions(rootDir, `${target} ${entry.summary}`, 4) : [];

  const lines = [
    `File: ${target}`,
    `Purpose: ${entry.summary}`,
    `Provides: ${entry.provides.join(", ") || "-"}`,
    `Consumed by (${impact.direct.length} direct): ${impact.direct.join(", ") || "-"}`,
    `Constraints: ${entry.constraints.join("; ") || "-"}`,
    `Related: ${entry.related.join(", ") || "-"}`,
    `Likely impact (${impact.transitive.length} transitive): ${impact.transitive.slice(0, 12).join(", ") || "-"}`,
    `Prior decisions: ${priorDecisions.join(" | ") || "-"}`
  ];

  return lines.join("\n");
}
