import { promises as fs } from "node:fs";
import path from "node:path";
import { indexProject, type IndexResult } from "./indexer.js";
import { syncContext, type SyncResult } from "./sync.js";
import { getContextPaths } from "./templates.js";

type PackageJsonData = {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type ScanOptions = {
  strict?: boolean;
  dryRun?: boolean;
};

export type ScanResult = {
  index: IndexResult;
  sync: SyncResult | null;
  dryRun: boolean;
  updatedFiles: string[];
  preview: {
    memory: string[];
    workflows: string[];
    preferences: string[];
    decisions: string[];
  };
};

const SCAN_BLOCK_START = "<!-- awesome-context-engine:scan:start -->";
const SCAN_BLOCK_END = "<!-- awesome-context-engine:scan:end -->";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript React",
  ".js": "JavaScript",
  ".jsx": "JavaScript React",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".json": "JSON",
  ".md": "Markdown",
  ".css": "CSS",
  ".scss": "SCSS",
  ".html": "HTML",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".php": "PHP",
  ".rb": "Ruby",
  ".swift": "Swift",
  ".kt": "Kotlin",
  ".sql": "SQL",
  ".sh": "Shell",
  ".ps1": "PowerShell"
};

const ENTRYPOINT_NAMES = new Set([
  "index.ts",
  "index.tsx",
  "index.js",
  "index.jsx",
  "main.ts",
  "main.tsx",
  "main.js",
  "main.jsx",
  "app.ts",
  "app.tsx",
  "app.js",
  "app.jsx",
  "server.ts",
  "server.js",
  "cli.ts",
  "cli.js"
]);

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function pickTopLanguages(byExtension: Record<string, number>, limit = 4): string[] {
  const counts: Record<string, number> = {};

  for (const [extension, count] of Object.entries(byExtension)) {
    const language = LANGUAGE_BY_EXTENSION[extension.toLowerCase()];
    if (!language) {
      continue;
    }
    counts[language] = (counts[language] ?? 0) + count;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([language]) => language);
}

function detectFrameworks(pkg: PackageJsonData): string[] {
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {})
  };

  const has = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);

  const frameworks: string[] = [];
  if (has("next")) frameworks.push("Next.js");
  if (has("@remix-run/react") || has("@remix-run/node")) frameworks.push("Remix");
  if (has("nuxt")) frameworks.push("Nuxt");
  if (has("astro")) frameworks.push("Astro");
  if (has("@nestjs/core")) frameworks.push("NestJS");
  if (has("express")) frameworks.push("Express");
  if (has("fastify")) frameworks.push("Fastify");
  if (has("koa")) frameworks.push("Koa");
  if (has("react") && !frameworks.includes("Next.js") && !frameworks.includes("Remix")) frameworks.push("React");
  if (has("vue") && !frameworks.includes("Nuxt")) frameworks.push("Vue");
  if (has("svelte")) frameworks.push("Svelte");

  return frameworks;
}

function pickEntrypoints(files: string[], limit = 8): string[] {
  return files
    .filter((filePath) => ENTRYPOINT_NAMES.has(path.basename(filePath).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
}

function pickTopDirectories(files: string[], limit = 6): string[] {
  const counts: Record<string, number> = {};

  for (const filePath of files) {
    const first = filePath.split("/")[0];
    if (!first || first === ".") {
      continue;
    }
    counts[first] = (counts[first] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => `${name} (${count} files)`);
}

function pickScriptByName(scripts: Record<string, string>, patterns: RegExp[]): { name: string; command: string } | null {
  for (const [name, command] of Object.entries(scripts)) {
    if (patterns.some((pattern) => pattern.test(name))) {
      return { name, command };
    }
  }

  return null;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readReadmeSummary(rootDir: string): Promise<string | null> {
  const candidates = ["README.md", "readme.md"];

  for (const candidate of candidates) {
    const filePath = path.join(rootDir, candidate);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !line.startsWith("#"))
        .filter((line) => !line.startsWith("![]("))
        .filter((line) => !line.startsWith("[!["))
        .filter((line) => !line.startsWith("- ["));

      const sentence = lines.find((line) => line.length >= 30 && line.length <= 220);
      if (sentence) {
        return sentence;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function buildScanBlock(title: string, lines: string[]): string {
  const body = lines.map((line) => `- ${line}`).join("\n");
  return [SCAN_BLOCK_START, `## ${title}`, "", body, SCAN_BLOCK_END, ""].join("\n");
}

async function upsertScanBlock(filePath: string, defaultHeading: string, block: string): Promise<void> {
  let existing = "";

  try {
    existing = await fs.readFile(filePath, "utf8");
  } catch {
    existing = `# ${defaultHeading}\n\n`;
  }

  const startIndex = existing.indexOf(SCAN_BLOCK_START);
  const endIndex = existing.indexOf(SCAN_BLOCK_END);

  let next = existing;
  if (startIndex >= 0 && endIndex > startIndex) {
    const afterEnd = endIndex + SCAN_BLOCK_END.length;
    next = `${existing.slice(0, startIndex).trimEnd()}\n\n${block}`;
    const trailing = existing.slice(afterEnd).trim();
    if (trailing) {
      next = `${next}\n${trailing}\n`;
    }
  } else {
    const prefix = existing.trimEnd();
    next = `${prefix}\n\n${block}`;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, next, "utf8");
}

async function detectPackageManager(rootDir: string): Promise<string> {
  const lockFiles = [
    { name: "pnpm-lock.yaml", manager: "pnpm" },
    { name: "yarn.lock", manager: "yarn" },
    { name: "bun.lockb", manager: "bun" },
    { name: "package-lock.json", manager: "npm" }
  ];

  for (const item of lockFiles) {
    const fullPath = path.join(rootDir, item.name);
    try {
      await fs.access(fullPath);
      return item.manager;
    } catch {
      continue;
    }
  }

  return "npm";
}

function buildMemoryLines(params: {
  packageName: string;
  description: string | null;
  readmeSummary: string | null;
  totalFiles: number;
  totalDirectories: number;
  languages: string[];
  frameworks: string[];
  entrypoints: string[];
  topDirs: string[];
}): string[] {
  const lines: string[] = [];

  lines.push(`Repository: ${params.packageName}.`);
  if (params.description) {
    lines.push(`Purpose: ${params.description}`);
  } else if (params.readmeSummary) {
    lines.push(`Purpose: ${params.readmeSummary}`);
  }

  lines.push(`Repository size snapshot: ${params.totalFiles} files across ${params.totalDirectories} directories.`);

  if (params.languages.length > 0) {
    lines.push(`Primary languages: ${params.languages.join(", ")}.`);
  }

  if (params.frameworks.length > 0) {
    lines.push(`Detected frameworks/libraries: ${params.frameworks.join(", ")}.`);
  }

  if (params.entrypoints.length > 0) {
    lines.push(`Likely entrypoints: ${params.entrypoints.join(", ")}.`);
  }

  if (params.topDirs.length > 0) {
    lines.push(`Largest directories: ${params.topDirs.join(", ")}.`);
  }

  lines.push("Regenerate this baseline with `awesome-context-engine scan` after major architecture changes.");
  return lines;
}

function buildWorkflowLines(scripts: Record<string, string>, packageManager: string): string[] {
  const lines: string[] = [];

  lines.push(`Install dependencies: ${packageManager} install`);

  const buildCommand = pickScriptByName(scripts, [/^build$/i, /compile/i, /bundle/i]);
  const testCommand = pickScriptByName(scripts, [/^test$/i, /spec/i, /e2e/i, /vitest/i, /jest/i]);
  const lintCommand = pickScriptByName(scripts, [/^lint$/i, /eslint/i]);
  const startCommand = pickScriptByName(scripts, [/^start$/i, /^dev$/i, /serve/i]);

  if (startCommand) {
    lines.push(`Run locally: ${packageManager} run ${startCommand.name}`);
  }
  if (buildCommand) {
    lines.push(`Build: ${packageManager} run ${buildCommand.name}`);
  }
  if (testCommand) {
    lines.push(`Test: ${packageManager} run ${testCommand.name}`);
  }
  if (lintCommand) {
    lines.push(`Lint: ${packageManager} run ${lintCommand.name}`);
  }

  lines.push("Context maintenance: run `awesome-context-engine index`, `awesome-context-engine sync`, or `awesome-context-engine auto`.");
  return unique(lines);
}

function buildPreferenceLines(params: {
  strictTypeScript: boolean;
  packageManager: string;
  frameworks: string[];
}): string[] {
  const lines: string[] = [];

  lines.push(`Prefer reproducible scripts from ${params.packageManager} scripts before ad-hoc shell commands.`);
  if (params.strictTypeScript) {
    lines.push("Preserve TypeScript strictness and keep type errors at zero.");
  }
  if (params.frameworks.length > 0) {
    lines.push(`Preserve existing framework conventions (${params.frameworks.join(", ")}).`);
  }
  lines.push("Update .awesome-context files after meaningful product or architecture changes.");

  return lines;
}

function buildDecisionLines(packageName: string): string[] {
  const day = new Date().toISOString().slice(0, 10);

  return [
    `${day}: Adopted awesome-context-engine repository scanning to bootstrap context for existing repositories.`,
    `${day}: Standardized onboarding flow so \`init\` performs a baseline scan and sync automatically for ${packageName}.`
  ];
}

export async function scanRepositoryContext(rootDir: string, options: ScanOptions = {}): Promise<ScanResult> {
  const paths = getContextPaths(rootDir);
  await fs.mkdir(paths.contextDir, { recursive: true });

  const isDryRun = Boolean(options.dryRun);
  const index = await indexProject(rootDir, {
    writeJson: !isDryRun,
    writeMarkdown: !isDryRun
  });
  const files = index.data.files.map((file) => normalizePath(file.path));

  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJson = (await readJsonFile<PackageJsonData>(packageJsonPath)) ?? {};
  const tsConfig = await readJsonFile<{ compilerOptions?: { strict?: boolean } }>(path.join(rootDir, "tsconfig.json"));
  const readmeSummary = await readReadmeSummary(rootDir);

  const packageName = packageJson.name ?? path.basename(rootDir);
  const packageDescription = packageJson.description ?? null;
  const scripts = packageJson.scripts ?? {};
  const frameworks = detectFrameworks(packageJson);
  const languages = pickTopLanguages(index.data.byExtension);
  const entrypoints = pickEntrypoints(files);
  const topDirs = pickTopDirectories(files);
  const packageManager = await detectPackageManager(rootDir);

  const memoryLines = buildMemoryLines({
    packageName,
    description: packageDescription,
    readmeSummary,
    totalFiles: index.data.totalFiles,
    totalDirectories: index.data.totalDirectories,
    languages,
    frameworks,
    entrypoints,
    topDirs
  });
  const workflowLines = buildWorkflowLines(scripts, packageManager);
  const preferenceLines = buildPreferenceLines({
    strictTypeScript: Boolean(tsConfig?.compilerOptions?.strict),
    packageManager,
    frameworks
  });
  const decisionLines = buildDecisionLines(packageName);

  if (!isDryRun) {
    const memoryBlock = buildScanBlock("Auto-Scanned Repository Context", memoryLines);
    const workflowBlock = buildScanBlock("Auto-Scanned Workflows", workflowLines);
    const preferenceBlock = buildScanBlock("Auto-Scanned Preferences", preferenceLines);
    const decisionBlock = buildScanBlock("Auto-Scanned Decisions", decisionLines);

    await upsertScanBlock(paths.memoryPath, "Memory", memoryBlock);
    await upsertScanBlock(paths.workflowsPath, "Workflows", workflowBlock);
    await upsertScanBlock(paths.preferencesPath, "Preferences", preferenceBlock);
    await upsertScanBlock(paths.decisionsPath, "Decisions", decisionBlock);
  }

  const sync = isDryRun ? null : await syncContext(rootDir, { strict: options.strict });

  const updatedFiles = [
    paths.memoryPath,
    paths.workflowsPath,
    paths.preferencesPath,
    paths.decisionsPath,
    index.indexMarkdownPath,
    index.indexJsonPath,
    isDryRun ? paths.aiContextPath : (sync?.contextPath ?? paths.aiContextPath)
  ];

  return {
    index,
    sync,
    dryRun: isDryRun,
    updatedFiles,
    preview: {
      memory: memoryLines,
      workflows: workflowLines,
      preferences: preferenceLines,
      decisions: decisionLines
    }
  };
}
