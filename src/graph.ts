import { promises as fs } from "node:fs";
import path from "node:path";
import { detectSensitiveMatches, redactSensitive } from "./redact.js";
import { StrictModeViolationError } from "./strict-mode.js";
import { getContextPaths, getDefaultIgnoreNames } from "./templates.js";

export type GraphOptions = {
  strict?: boolean;
};

type GraphData = {
  generatedAt: string;
  totalFiles: number;
  nodes: Record<string, { imports: string[]; dependents: string[] }>;
};

type ScannedFile = {
  relativePath: string;
  absolutePath: string;
  mtimeMs: number;
};

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const DEBOUNCE_MAX_FILES = 5000;
const RECENT_FILE_LIMIT = 8;
const RELATED_FILE_LIMIT = 20;
const TEST_FILE_LIMIT = 12;
const SUMMARY_FILE_LIMIT = 16;
const SUMMARY_POINT_LIMIT = 3;
const MAX_MINIMAL_CONTEXT_CHARS = 7000;

function normalizePath(input: string): string {
  return input.replace(/\\/g, "/");
}

function isCodeFile(filePath: string): boolean {
  return CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isTestFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.includes("/__tests__/") ||
    /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(lower)
  );
}

function stemForMatch(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  return base
    .replace(/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i, "")
    .replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/i, "");
}

function getIgnoreNames(): Set<string> {
  const ignore = getDefaultIgnoreNames();
  ignore.add("coverage");
  return ignore;
}

async function collectScannedFiles(rootDir: string): Promise<ScannedFile[]> {
  const result: ScannedFile[] = [];
  const ignoreNames = getIgnoreNames();

  const walk = async (currentDir: string): Promise<void> => {
    if (result.length >= DEBOUNCE_MAX_FILES) {
      return;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (ignoreNames.has(entry.name)) {
        continue;
      }

      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = normalizePath(path.relative(rootDir, absolutePath));

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stats = await fs.stat(absolutePath);
      result.push({ relativePath, absolutePath, mtimeMs: stats.mtimeMs });

      if (result.length >= DEBOUNCE_MAX_FILES) {
        return;
      }
    }
  };

  await walk(rootDir);
  return result;
}

function extractImportSpecifiers(sourceCode: string): string[] {
  const specifiers = new Set<string>();
  const pattern =
    /(?:import\s+(?:[^"'\n]+\s+from\s+)?|export\s+[^"'\n]*\s+from\s+|require\(|import\()\s*["']([^"']+)["']/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sourceCode)) !== null) {
    const specifier = match[1]?.trim();
    if (specifier) {
      specifiers.add(specifier);
    }
  }

  return [...specifiers];
}

function resolveImport(fromFile: string, specifier: string, allFiles: Set<string>): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const fromDir = path.posix.dirname(fromFile);
  const normalizedBase = path.posix.normalize(path.posix.join(fromDir, specifier));
  const candidates = [
    normalizedBase,
    `${normalizedBase}.ts`,
    `${normalizedBase}.tsx`,
    `${normalizedBase}.js`,
    `${normalizedBase}.jsx`,
    `${normalizedBase}.mjs`,
    `${normalizedBase}.cjs`,
    `${normalizedBase}/index.ts`,
    `${normalizedBase}/index.tsx`,
    `${normalizedBase}/index.js`,
    `${normalizedBase}/index.jsx`,
    `${normalizedBase}/index.mjs`,
    `${normalizedBase}/index.cjs`
  ];

  for (const candidate of candidates) {
    if (allFiles.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function buildGraph(scannedFiles: ScannedFile[]): Promise<GraphData> {
  const codeFiles = scannedFiles.filter((file) => isCodeFile(file.relativePath));
  const allCodeFilePaths = new Set(codeFiles.map((file) => file.relativePath));

  const importsMap = new Map<string, Set<string>>();
  const dependentsMap = new Map<string, Set<string>>();

  for (const file of codeFiles) {
    importsMap.set(file.relativePath, new Set<string>());
    dependentsMap.set(file.relativePath, new Set<string>());
  }

  for (const file of codeFiles) {
    let source = "";
    try {
      source = await fs.readFile(file.absolutePath, "utf8");
    } catch {
      continue;
    }

    const specifiers = extractImportSpecifiers(source);
    for (const specifier of specifiers) {
      const resolved = resolveImport(file.relativePath, specifier, allCodeFilePaths);
      if (!resolved) {
        continue;
      }

      importsMap.get(file.relativePath)?.add(resolved);
      dependentsMap.get(resolved)?.add(file.relativePath);
    }
  }

  const nodes: Record<string, { imports: string[]; dependents: string[] }> = {};
  for (const filePath of allCodeFilePaths) {
    nodes[filePath] = {
      imports: [...(importsMap.get(filePath) ?? new Set<string>())].sort((a, b) => a.localeCompare(b)),
      dependents: [...(dependentsMap.get(filePath) ?? new Set<string>())].sort((a, b) => a.localeCompare(b))
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    totalFiles: allCodeFilePaths.size,
    nodes
  };
}

function pickRecentlyChangedFiles(scannedFiles: ScannedFile[]): string[] {
  return scannedFiles
    .filter((file) => isCodeFile(file.relativePath))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, RECENT_FILE_LIMIT)
    .map((file) => file.relativePath);
}

function pickDirectlyRelatedFiles(graph: GraphData, recentFiles: string[]): string[] {
  const related = new Set<string>();

  for (const filePath of recentFiles) {
    const node = graph.nodes[filePath];
    if (!node) {
      continue;
    }

    for (const imported of node.imports) {
      related.add(imported);
    }
    for (const dependent of node.dependents) {
      related.add(dependent);
    }
  }

  for (const recent of recentFiles) {
    related.delete(recent);
  }

  return [...related].sort((a, b) => a.localeCompare(b)).slice(0, RELATED_FILE_LIMIT);
}

function pickRelevantTests(allFiles: string[], focusFiles: string[]): string[] {
  const tests = allFiles.filter((filePath) => isTestFile(filePath));
  if (tests.length === 0) {
    return [];
  }

  const focusStems = new Set(focusFiles.map((filePath) => stemForMatch(filePath)));
  const matchingTests = tests.filter((testPath) => focusStems.has(stemForMatch(testPath)));

  const selected = (matchingTests.length > 0 ? matchingTests : tests)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, TEST_FILE_LIMIT);

  return selected;
}

async function summarizeFile(filePath: string, absolutePath: string): Promise<string[]> {
  let raw = "";
  try {
    raw = await fs.readFile(absolutePath, "utf8");
  } catch {
    return ["File summary unavailable."];
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const points: string[] = [];

  for (const line of lines) {
    if (points.length >= SUMMARY_POINT_LIMIT) {
      break;
    }

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
    if (/^interface\s+[A-Za-z0-9_]+/.test(line) || /^type\s+[A-Za-z0-9_]+\s*=/.test(line)) {
      points.push(`Defines type ${line.replace(/\s*=.*$/, "")}.`);
      continue;
    }
    if (/^\/\//.test(line) || /^\/\*/.test(line)) {
      points.push(line.replace(/^\/\/?\s*/, "").replace(/^\*\s*/, ""));
      continue;
    }
  }

  if (points.length === 0) {
    points.push(`Key module file: ${filePath}`);
  }

  return points.slice(0, SUMMARY_POINT_LIMIT);
}

function trimToBudget(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, maxChars)}\n\n...[truncated for context budget]`;
}

async function renderMinimalContext(rootDir: string, graph: GraphData, scannedFiles: ScannedFile[]): Promise<string> {
  const recentlyChanged = pickRecentlyChangedFiles(scannedFiles);
  const related = pickDirectlyRelatedFiles(graph, recentlyChanged);
  const allPaths = scannedFiles.map((file) => file.relativePath);
  const relevantTests = pickRelevantTests(allPaths, [...recentlyChanged, ...related]);

  const summaryTargets = [...recentlyChanged, ...related, ...relevantTests].slice(0, SUMMARY_FILE_LIMIT);
  const uniqueSummaryTargets = [...new Set(summaryTargets)];

  const pathToAbsolute = new Map(scannedFiles.map((file) => [file.relativePath, file.absolutePath]));
  const summaries: Array<{ file: string; points: string[] }> = [];

  for (const target of uniqueSummaryTargets) {
    const absolutePath = pathToAbsolute.get(target);
    if (!absolutePath) {
      continue;
    }

    const points = await summarizeFile(target, absolutePath);
    summaries.push({ file: target, points });
  }

  const renderList = (items: string[]) => (items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none");

  const summaryBlock = summaries.length
    ? summaries
        .map((summary) => {
          const points = summary.points.map((point) => `- ${point}`).join("\n");
          return `### ${summary.file}\n${points}`;
        })
        .join("\n\n")
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

export async function generateGraphContext(
  rootDir: string,
  options: GraphOptions = {}
): Promise<{ graphPath: string; minimalContextPath: string }> {
  const paths = getContextPaths(rootDir);
  await fs.mkdir(paths.contextDir, { recursive: true });

  const scannedFiles = await collectScannedFiles(rootDir);
  const graph = await buildGraph(scannedFiles);
  const minimalContext = await renderMinimalContext(rootDir, graph, scannedFiles);
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

  await fs.writeFile(paths.graphJsonPath, JSON.stringify(graph, null, 2), "utf8");
  await fs.writeFile(paths.minimalContextPath, redactedMinimalContext, "utf8");

  return {
    graphPath: paths.graphJsonPath,
    minimalContextPath: paths.minimalContextPath
  };
}
