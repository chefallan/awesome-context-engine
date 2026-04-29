import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { indexProject } from "./indexer.js";
import { detectSensitiveMatches, redactSensitive } from "./redact.js";
import { StrictModeViolationError } from "./strict-mode.js";
import { getContextPaths } from "./templates.js";

const CACHE_VERSION = 1;
const GRAPH_VERSION = 1;
const GRAPH_PARSER_VERSION = 2;

export type GraphOptions = {
  strict?: boolean;
  dryRun?: boolean;
  incremental?: boolean;
  full?: boolean;
};

export type GraphNode = {
  id: string;
  type: "file";
  path: string;
  language: string;
  symbols: string[];
  tags: string[];
};

export type GraphEdge = {
  from: string;
  to: string;
  type: "imports" | "references";
  confidence: number;
};

export type GraphData = {
  version: 1;
  generatedAt: string;
  root: ".";
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type AceCacheFile = {
  hash: string;
  size: number;
  mtimeMs: number;
  language: string;
  symbols: string[];
  imports: string[];
  exports: string[];
  summary: string;
  lastProcessed: string;
};

export type AceCacheData = {
  version: 1;
  generatedAt: string;
  root: ".";
  parserVersion: number;
  graphVersion: number;
  configFingerprint: string;
  files: Record<string, AceCacheFile>;
};

export type CacheStatusResult = {
  trackedFiles: number;
  added: number;
  changed: number;
  unchanged: number;
  deleted: number;
  hitRate: number;
  invalidated: boolean;
  reasons: string[];
};

export type GraphGenerationStats = {
  cache: CacheStatusResult;
  extractedFiles: number;
};

type SourceFile = {
  path: string;
  absolutePath: string;
  mtimeMs: number;
  size: number;
  hash: string;
};

const MAX_MINIMAL_CONTEXT_CHARS = 7000;
const RECENT_FILE_LIMIT = 8;
const RELATED_FILE_LIMIT = 20;
const TEST_FILE_LIMIT = 12;
const SUMMARY_FILE_LIMIT = 16;
const SUMMARY_POINT_LIMIT = 3;

const SOURCE_EXTENSIONS = new Set([
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
  ".yaml",
  ".yml",
  ".json"
]);

const CODE_EXTENSIONS = new Set([
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
  ".cs"
]);

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function extOf(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

function isLockfile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "cargo.lock", "poetry.lock", "composer.lock"].includes(base);
}

function isMinified(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith(".min.js") || lower.endsWith(".min.css") || lower.includes(".bundle.");
}

function isBinaryLike(filePath: string): boolean {
  const ext = extOf(filePath);
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip", ".gz", ".tar", ".woff", ".woff2", ".ttf", ".ico"].includes(ext);
}

function isGraphEligible(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  const lower = normalized.toLowerCase();
  if (
    lower.startsWith("dist/") ||
    lower.startsWith("build/") ||
    lower.startsWith("vendor/") ||
    lower.startsWith("coverage/") ||
    lower.startsWith("node_modules/") ||
    lower.startsWith(".awesome-context/")
  ) {
    return false;
  }
  if (isLockfile(lower) || isMinified(lower) || isBinaryLike(lower)) {
    return false;
  }
  return SOURCE_EXTENSIONS.has(extOf(lower));
}

function languageFromPath(filePath: string): string {
  const ext = extOf(filePath);
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".go": "go",
    ".php": "php",
    ".rb": "ruby",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".cs": "csharp",
    ".md": "markdown",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".json": "json"
  };
  return map[ext] ?? "text";
}

function tagsFromPath(filePath: string): string[] {
  const lower = filePath.toLowerCase();
  const tags = new Set<string>();

  if (lower.includes("/test/") || lower.includes("/tests/") || /\.(test|spec)\./.test(lower)) tags.add("test");
  if (lower.startsWith("docs/") || lower.endsWith(".md")) tags.add("docs");
  if (lower.includes("/routes/") || lower.includes("/router/")) tags.add("route");
  if (lower.includes("/components/") || lower.includes(".component.")) tags.add("component");
  if (path.basename(lower).includes("config") || lower.endsWith(".json") || lower.endsWith(".yml") || lower.endsWith(".yaml")) tags.add("config");
  if (CODE_EXTENSIONS.has(extOf(lower))) tags.add("source");

  return [...tags].sort((a, b) => a.localeCompare(b));
}

function parseSymbols(filePath: string, source: string): string[] {
  const ext = extOf(filePath);
  const symbols = new Set<string>();
  const addMatches = (pattern: RegExp, group = 1): void => {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const value = match[group]?.trim();
      if (value && value.length <= 64) {
        symbols.add(value);
      }
    }
  };

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    addMatches(/export\s+(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/g);
    addMatches(/export\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/g);
    addMatches(/export\s+(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)/g);
  } else if (ext === ".py") {
    addMatches(/^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm);
    addMatches(/^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[(:]/gm);
  } else if (ext === ".go") {
    addMatches(/^func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm);
    addMatches(/^type\s+([A-Za-z_][A-Za-z0-9_]*)\s+/gm);
  } else if (ext === ".php") {
    addMatches(/function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g);
    addMatches(/class\s+([A-Za-z_][A-Za-z0-9_]*)\s*/g);
  } else if (ext === ".rb") {
    addMatches(/^def\s+([A-Za-z_][A-Za-z0-9_!?=]*)\s*/gm);
    addMatches(/^class\s+([A-Za-z_][A-Za-z0-9_:]*)\s*/gm);
  } else if (ext === ".rs") {
    addMatches(/pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g);
    addMatches(/pub\s+struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*/g);
  } else if ([".java", ".kt", ".cs"].includes(ext)) {
    addMatches(/(?:public\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/g);
    addMatches(/(?:public\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)/g);
  }

  return [...symbols].sort((a, b) => a.localeCompare(b)).slice(0, 12);
}

function parseExports(filePath: string, source: string, symbols: string[]): string[] {
  const ext = extOf(filePath);
  const exportsSet = new Set<string>();
  const addMatches = (pattern: RegExp, group = 1): void => {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const value = match[group]?.trim();
      if (value && value.length <= 64) exportsSet.add(value);
    }
  };

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    addMatches(/export\s+(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/g);
    addMatches(/export\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/g);
    addMatches(/export\s+(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)/g);
    addMatches(/export\s*\{\s*([A-Za-z_][A-Za-z0-9_]*)/g);
  } else {
    for (const symbol of symbols) exportsSet.add(symbol);
  }

  if (exportsSet.size === 0) {
    for (const symbol of symbols) exportsSet.add(symbol);
  }

  return [...exportsSet].sort((a, b) => a.localeCompare(b)).slice(0, 12);
}

function extractSpecifiers(filePath: string, source: string): string[] {
  const ext = extOf(filePath);
  const specifiers = new Set<string>();
  const add = (value: string): void => {
    const v = value.trim();
    if (v && v.length <= 180) specifiers.add(v);
  };
  const addRegex = (pattern: RegExp, group = 1): void => {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[group]) add(match[group]);
    }
  };

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".php"].includes(ext)) {
    addRegex(/(?:import\s+(?:[^"'\n]+\s+from\s+)?|export\s+[^"'\n]*\s+from\s+|require\(|import\()\s*["']([^"']+)["']/g);
  }
  if (ext === ".py") {
    addRegex(/^from\s+([A-Za-z0-9_\.]+)\s+import\s+/gm);
    addRegex(/^import\s+([A-Za-z0-9_\.]+)/gm);
  }
  if ([".go", ".java", ".kt"].includes(ext)) {
    addRegex(/^import\s+(?:[A-Za-z0-9_\.]+\s+)?["']?([A-Za-z0-9_\.\/-]+)["']?/gm);
  }
  if (ext === ".rs") addRegex(/^use\s+([A-Za-z0-9_:]+)\s*;/gm);
  if (ext === ".rb") addRegex(/(?:require|require_relative)\s*["']([^"']+)["']/g);
  if (ext === ".cs") addRegex(/^using\s+([A-Za-z0-9_\.]+)\s*;/gm);

  return [...specifiers].sort((a, b) => a.localeCompare(b));
}

function buildLookupKeys(filePath: string): string[] {
  const normalized = normalizePath(filePath);
  const ext = extOf(normalized);
  const withoutExt = normalized.slice(0, -ext.length);
  const keys = new Set<string>([normalized, withoutExt, path.posix.basename(withoutExt)]);
  if (ext === ".py") keys.add(withoutExt.replace(/\//g, "."));
  return [...keys];
}

function resolveSpecifier(consumerPath: string, specifier: string, allPaths: Set<string>, lookup: Map<string, string[]>): string | null {
  const consumerDir = path.posix.dirname(consumerPath);
  const candidates: string[] = [];
  const extCandidates = [...SOURCE_EXTENSIONS].filter((ext) => ext !== ".md");

  const push = (base: string): void => {
    candidates.push(base);
    for (const ext of extCandidates) {
      candidates.push(`${base}${ext}`);
      candidates.push(`${base}/index${ext}`);
    }
  };

  if (specifier.startsWith(".")) {
    push(path.posix.normalize(path.posix.join(consumerDir, specifier)));
  } else {
    const normalized = specifier.replace(/\\/g, "/");
    push(normalized);
    if (normalized.includes(".")) push(normalized.replace(/\./g, "/"));
  }

  for (const candidate of candidates) {
    if (allPaths.has(candidate)) return candidate;
    const fromLookup = lookup.get(candidate);
    if (fromLookup && fromLookup.length > 0) return fromLookup[0];
  }

  return null;
}

function toNodeId(filePath: string): string {
  return `file:${filePath}`;
}

function isTestFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.includes("/test/") || lower.includes("/tests/") || /\.(test|spec)\./.test(lower);
}

function isDocFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.startsWith("docs/") || lower.endsWith(".md");
}

function stemForMatch(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  return base
    .replace(/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|cs)$/i, "")
    .replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|cs|md)$/i, "");
}

function pickRecentlyChangedFiles(files: SourceFile[]): string[] {
  return files
    .filter((file) => CODE_EXTENSIONS.has(extOf(file.path)))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, RECENT_FILE_LIMIT)
    .map((file) => file.path);
}

function pickDirectlyRelatedFiles(graph: GraphData, recentFiles: string[]): string[] {
  const related = new Set<string>();
  for (const recent of recentFiles) {
    const nodeId = toNodeId(recent);
    for (const edge of graph.edges) {
      if (edge.type !== "imports") continue;
      if (edge.from === nodeId && edge.to.startsWith("file:")) related.add(edge.to.slice(5));
      if (edge.to === nodeId && edge.from.startsWith("file:")) related.add(edge.from.slice(5));
    }
  }
  for (const recent of recentFiles) related.delete(recent);
  return [...related].sort((a, b) => a.localeCompare(b)).slice(0, RELATED_FILE_LIMIT);
}

function pickRelevantTests(allPaths: string[], focusFiles: string[]): string[] {
  const tests = allPaths.filter((filePath) => isTestFile(filePath));
  if (tests.length === 0) return [];
  const stems = new Set(focusFiles.map((filePath) => stemForMatch(filePath)));
  const matching = tests.filter((filePath) => stems.has(stemForMatch(filePath)));
  return (matching.length ? matching : tests).sort((a, b) => a.localeCompare(b)).slice(0, TEST_FILE_LIMIT);
}

function summarizePurpose(filePath: string, symbols: string[], tags: string[]): string {
  if (symbols.length > 0) {
    const head = symbols.slice(0, 3).join(", ");
    return `Defines ${head}.`;
  }
  if (tags.includes("route")) return "Route handling module.";
  if (tags.includes("component")) return "UI component module.";
  if (tags.includes("config")) return "Configuration module.";
  if (tags.includes("docs")) return "Documentation file.";
  return `Module file: ${filePath}`;
}

async function summarizeFile(filePath: string, absolutePath: string): Promise<string[]> {
  let raw = "";
  try {
    raw = await fs.readFile(absolutePath, "utf8");
  } catch {
    return ["File summary unavailable."];
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const points: string[] = [];

  for (const line of lines) {
    if (points.length >= SUMMARY_POINT_LIMIT) break;
    if (/^(export\s+)?(async\s+)?function\s+[A-Za-z0-9_]+/.test(line)) {
      points.push(`Defines ${line.replace(/\s*\{?$/, "")}.`);
      continue;
    }
    if (/^class\s+[A-Za-z0-9_]+/.test(line) || /^export\s+class\s+[A-Za-z0-9_]+/.test(line)) {
      points.push(`Contains ${line.replace(/\s*\{?$/, "")}.`);
      continue;
    }
    if (/^(export\s+)?(const|let|var)\s+[A-Za-z0-9_]+\s*=/.test(line)) {
      points.push(`Declares ${line.replace(/\s*=.*$/, "")}.`);
      continue;
    }
    if (/^def\s+[A-Za-z0-9_]+\s*\(/.test(line)) {
      points.push(`Defines ${line.replace(/:$/, "")}.`);
      continue;
    }
    if (/^\/\//.test(line) || /^#/.test(line) || /^\/\*/.test(line)) {
      points.push(line.replace(/^\/\/?\s*/, "").replace(/^#\s*/, "").replace(/^\*\s*/, ""));
      continue;
    }
  }

  if (points.length === 0) points.push(`Key module file: ${filePath}`);
  return points.slice(0, SUMMARY_POINT_LIMIT);
}

function trimToBudget(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n\n...[truncated for context budget]`;
}

async function renderMinimalContext(rootDir: string, graph: GraphData, files: SourceFile[]): Promise<string> {
  const recentlyChanged = pickRecentlyChangedFiles(files);
  const related = pickDirectlyRelatedFiles(graph, recentlyChanged);
  const allPaths = files.map((file) => file.path);
  const relevantTests = pickRelevantTests(allPaths, [...recentlyChanged, ...related]);

  const summaryTargets = [...new Set([...recentlyChanged, ...related, ...relevantTests])].slice(0, SUMMARY_FILE_LIMIT);
  const pathToAbsolute = new Map(files.map((file) => [file.path, file.absolutePath]));

  const summaries: Array<{ file: string; points: string[] }> = [];
  for (const filePath of summaryTargets) {
    const absolutePath = pathToAbsolute.get(filePath);
    if (!absolutePath) continue;
    summaries.push({ file: filePath, points: await summarizeFile(filePath, absolutePath) });
  }

  const renderList = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "- none");
  const summaryBlock = summaries.length
    ? summaries.map((summary) => `### ${summary.file}\n${summary.points.map((point) => `- ${point}`).join("\n")}`).join("\n\n")
    : "- none";

  const output = `# Minimal Context

Generated at: ${new Date().toISOString()}
Root: ${rootDir}

## Recently Changed Files
${renderList(recentlyChanged)}

## Directly Related Files
${renderList(related)}

## Relevant Test Files
${renderList(relevantTests)}

## Short File Summaries
${summaryBlock}
`;

  return trimToBudget(output, MAX_MINIMAL_CONTEXT_CHARS);
}

function hashBuffer(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function computeConfigFingerprint(rootDir: string): Promise<string> {
  const parts: string[] = [`parser:${GRAPH_PARSER_VERSION}`, `graph:${GRAPH_VERSION}`];
  const files = ["package.json", "tsconfig.json", ".gitignore", ".npmignore", ".ignore"];

  for (const relativePath of files) {
    const absolutePath = path.join(rootDir, relativePath);
    try {
      const raw = await fs.readFile(absolutePath, "utf8");
      parts.push(`${relativePath}:${hashBuffer(Buffer.from(raw, "utf8"))}`);
    } catch {
      parts.push(`${relativePath}:missing`);
    }
  }

  return hashBuffer(Buffer.from(parts.join("|"), "utf8"));
}

async function collectEligibleFiles(rootDir: string): Promise<SourceFile[]> {
  const index = await indexProject(rootDir, { writeMarkdown: false, writeJson: false });
  const out: SourceFile[] = [];

  for (const file of index.data.files) {
    if (!isGraphEligible(file.path)) continue;
    const normalized = normalizePath(file.path);
    const absolutePath = path.join(rootDir, normalized);
    try {
      const content = await fs.readFile(absolutePath);
      out.push({
        path: normalized,
        absolutePath,
        mtimeMs: file.mtimeMs,
        size: content.length,
        hash: hashBuffer(content)
      });
    } catch {
      continue;
    }
  }

  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

async function readAceCache(rootDir: string): Promise<{ cache: AceCacheData | null; corrupt: boolean }> {
  const paths = getContextPaths(rootDir);
  try {
    const raw = await fs.readFile(paths.cachePath, "utf8");
    const parsed = JSON.parse(raw) as AceCacheData;
    if (parsed.version !== CACHE_VERSION || parsed.root !== "." || typeof parsed.files !== "object") {
      return { cache: null, corrupt: true };
    }
    return { cache: parsed, corrupt: false };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { cache: null, corrupt: false };
    return { cache: null, corrupt: true };
  }
}

async function writeAceCache(rootDir: string, cache: AceCacheData): Promise<string> {
  const paths = getContextPaths(rootDir);
  await fs.mkdir(paths.contextDir, { recursive: true });
  await fs.writeFile(paths.cachePath, JSON.stringify(cache, null, 2), "utf8");
  return paths.cachePath;
}

function buildLookupFromFiles(files: SourceFile[]): Map<string, string[]> {
  const lookup = new Map<string, string[]>();
  for (const file of files) {
    for (const key of buildLookupKeys(file.path)) {
      const current = lookup.get(key) ?? [];
      if (!current.includes(file.path)) current.push(file.path);
      lookup.set(key, current.sort((a, b) => a.localeCompare(b)));
    }
  }
  return lookup;
}

function determineCacheStatus(
  files: SourceFile[],
  existing: AceCacheData | null,
  full: boolean,
  configFingerprint: string,
  corrupt: boolean
): { status: CacheStatusResult; fullInvalidate: boolean } {
  const currentPaths = new Set(files.map((file) => file.path));
  const previousFiles = existing?.files ?? {};

  const reasons: string[] = [];
  let fullInvalidate = full;

  if (full) reasons.push("full requested");
  if (corrupt) {
    fullInvalidate = true;
    reasons.push("cache corrupt");
  }
  if (!existing) {
    fullInvalidate = true;
    reasons.push("cache missing");
  } else {
    if (existing.version !== CACHE_VERSION) {
      fullInvalidate = true;
      reasons.push("cache schema changed");
    }
    if (existing.parserVersion !== GRAPH_PARSER_VERSION) {
      fullInvalidate = true;
      reasons.push("parser version changed");
    }
    if (existing.graphVersion !== GRAPH_VERSION) {
      fullInvalidate = true;
      reasons.push("graph schema changed");
    }
    if (existing.configFingerprint !== configFingerprint) {
      fullInvalidate = true;
      reasons.push("config changed");
    }
  }

  let unchanged = 0;
  let changed = 0;
  let added = 0;

  for (const file of files) {
    const cached = previousFiles[file.path];
    if (!cached) {
      added += 1;
      continue;
    }
    if (!fullInvalidate && cached.hash === file.hash) {
      unchanged += 1;
    } else {
      changed += 1;
    }
  }

  let deleted = 0;
  for (const oldPath of Object.keys(previousFiles)) {
    if (!currentPaths.has(oldPath)) deleted += 1;
  }

  const trackedFiles = files.length;
  const hitRate = trackedFiles === 0 ? 1 : Number((unchanged / trackedFiles).toFixed(4));

  return {
    status: {
      trackedFiles,
      added,
      changed,
      unchanged,
      deleted,
      hitRate,
      invalidated: fullInvalidate,
      reasons: [...new Set(reasons)].sort((a, b) => a.localeCompare(b))
    },
    fullInvalidate
  };
}

async function parseFileMetadata(file: SourceFile): Promise<{ symbols: string[]; imports: string[]; exports: string[]; summary: string }> {
  let source = "";
  try {
    source = await fs.readFile(file.absolutePath, "utf8");
  } catch {
    source = "";
  }

  const symbols = parseSymbols(file.path, source);
  const imports = CODE_EXTENSIONS.has(extOf(file.path)) ? extractSpecifiers(file.path, source) : [];
  const exports = parseExports(file.path, source, symbols);
  const summary = summarizePurpose(file.path, symbols, tagsFromPath(file.path));
  return { symbols, imports, exports, summary };
}

async function buildGraphData(
  rootDir: string,
  options: GraphOptions
): Promise<{ graph: GraphData; files: SourceFile[]; cache: AceCacheData; stats: GraphGenerationStats }> {
  const full = Boolean(options.full);
  const incremental = options.incremental !== false;
  const files = await collectEligibleFiles(rootDir);
  const { cache: existingCache, corrupt } = await readAceCache(rootDir);
  const configFingerprint = await computeConfigFingerprint(rootDir);
  const { status, fullInvalidate } = determineCacheStatus(files, existingCache, full || !incremental, configFingerprint, corrupt);

  const previousFiles = existingCache?.files ?? {};
  const nextFiles: Record<string, AceCacheFile> = {};
  let extractedFiles = 0;

  for (const file of files) {
    const cached = previousFiles[file.path];
    const canReuse = Boolean(cached) && !fullInvalidate && cached.hash === file.hash;
    if (canReuse) {
      nextFiles[file.path] = {
        ...cached,
        size: file.size,
        mtimeMs: file.mtimeMs,
        hash: file.hash
      };
      continue;
    }

    const parsed = await parseFileMetadata(file);
    extractedFiles += 1;
    nextFiles[file.path] = {
      hash: file.hash,
      size: file.size,
      mtimeMs: file.mtimeMs,
      language: languageFromPath(file.path),
      symbols: parsed.symbols,
      imports: parsed.imports,
      exports: parsed.exports,
      summary: parsed.summary,
      lastProcessed: new Date().toISOString()
    };
  }

  const lookup = buildLookupFromFiles(files);
  const allPaths = new Set(files.map((file) => file.path));

  const nodes: GraphNode[] = files.map((file) => {
    const entry = nextFiles[file.path];
    return {
      id: toNodeId(file.path),
      type: "file",
      path: file.path,
      language: entry.language,
      symbols: [...entry.symbols],
      tags: tagsFromPath(file.path)
    };
  });

  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  for (const file of files) {
    if (!CODE_EXTENSIONS.has(extOf(file.path))) continue;
    const entry = nextFiles[file.path];
    for (const specifier of entry.imports) {
      const target = resolveSpecifier(file.path, specifier, allPaths, lookup);
      if (!target || target === file.path) continue;
      const edge: GraphEdge = { from: toNodeId(file.path), to: toNodeId(target), type: "imports", confidence: 1 };
      const key = `${edge.from}|${edge.to}|${edge.type}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push(edge);
      }
    }
  }

  const docs = nodes.filter((node) => isDocFile(node.path));
  const tests = nodes.filter((node) => isTestFile(node.path));
  const sources = nodes.filter((node) => node.tags.includes("source") && !node.tags.includes("test"));

  for (const doc of docs) {
    const docStem = stemForMatch(doc.path);
    for (const src of sources) {
      if (stemForMatch(src.path) !== docStem) continue;
      const edge: GraphEdge = { from: doc.id, to: src.id, type: "references", confidence: 0.6 };
      const key = `${edge.from}|${edge.to}|${edge.type}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push(edge);
      }
    }
  }

  for (const test of tests) {
    const testStem = stemForMatch(test.path);
    for (const src of sources) {
      if (stemForMatch(src.path) !== testStem) continue;
      const edge: GraphEdge = { from: test.id, to: src.id, type: "references", confidence: 0.8 };
      const key = `${edge.from}|${edge.to}|${edge.type}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push(edge);
      }
    }
  }

  nodes.sort((a, b) => a.path.localeCompare(b.path));
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type));

  const graph: GraphData = {
    version: 1,
    generatedAt: new Date().toISOString(),
    root: ".",
    nodes,
    edges
  };

  const cache: AceCacheData = {
    version: 1,
    generatedAt: new Date().toISOString(),
    root: ".",
    parserVersion: GRAPH_PARSER_VERSION,
    graphVersion: GRAPH_VERSION,
    configFingerprint,
    files: Object.fromEntries(Object.entries(nextFiles).sort((a, b) => a[0].localeCompare(b[0])))
  };

  return {
    graph,
    files,
    cache,
    stats: {
      cache: status,
      extractedFiles
    }
  };
}

export async function readGraphData(rootDir: string): Promise<GraphData | null> {
  const paths = getContextPaths(rootDir);
  try {
    const raw = await fs.readFile(paths.graphJsonPath, "utf8");
    return JSON.parse(raw) as GraphData;
  } catch {
    return null;
  }
}

export async function clearAceCache(rootDir: string): Promise<{ removed: boolean; cachePath: string }> {
  const paths = getContextPaths(rootDir);
  try {
    await fs.rm(paths.cachePath);
    return { removed: true, cachePath: paths.cachePath };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { removed: false, cachePath: paths.cachePath };
    throw error;
  }
}

export async function getAceCacheStatus(rootDir: string, options: { full?: boolean } = {}): Promise<CacheStatusResult> {
  const files = await collectEligibleFiles(rootDir);
  const { cache, corrupt } = await readAceCache(rootDir);
  const configFingerprint = await computeConfigFingerprint(rootDir);
  const { status } = determineCacheStatus(files, cache, Boolean(options.full), configFingerprint, corrupt);
  return status;
}

export async function generateGraphContext(
  rootDir: string,
  options: GraphOptions = {}
): Promise<{ graphPath: string; minimalContextPath: string; graph: GraphData; cachePath: string; stats: GraphGenerationStats }> {
  const paths = getContextPaths(rootDir);
  await fs.mkdir(paths.contextDir, { recursive: true });

  const { graph, files, cache, stats } = await buildGraphData(rootDir, options);
  const minimalContext = await renderMinimalContext(rootDir, graph, files);

  if (options.strict) {
    const findings = detectSensitiveMatches(minimalContext);
    if (findings.length > 0) {
      const total = findings.reduce((sum, finding) => sum + finding.count, 0);
      const labels = findings.map((finding) => finding.name).join(", ");
      throw new StrictModeViolationError(
        `Strict mode blocked minimal context write: ${total} secret-like matches detected (${labels}).`,
        findings
      );
    }
  }

  const redactedMinimalContext = redactSensitive(minimalContext);
  if (!options.dryRun) {
    await fs.writeFile(paths.graphJsonPath, JSON.stringify(graph, null, 2), "utf8");
    await fs.writeFile(paths.minimalContextPath, redactedMinimalContext, "utf8");
    await writeAceCache(rootDir, cache);
  }

  return {
    graphPath: paths.graphJsonPath,
    minimalContextPath: paths.minimalContextPath,
    graph,
    cachePath: paths.cachePath,
    stats
  };
}
