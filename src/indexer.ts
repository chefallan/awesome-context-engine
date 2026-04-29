import { promises as fs } from "node:fs";
import path from "node:path";
import { getContextPaths, getDefaultIgnoreNames } from "./templates.js";

export type IndexedFile = {
  path: string;
  bytes: number;
  mtimeMs: number;
};

export type IndexData = {
  generatedAt: string;
  rootDir: string;
  totalFiles: number;
  totalDirectories: number;
  byExtension: Record<string, number>;
  files: IndexedFile[];
  truncated: boolean;
  packageScripts: Record<string, string>;
  dependencies: string[];
};

export type IndexResult = {
  indexMarkdownPath: string;
  indexJsonPath: string;
  data: IndexData;
};

export type IndexOptions = {
  maxFiles?: number;
  writeJson?: boolean;
  writeMarkdown?: boolean;
};

type WalkState = {
  files: IndexedFile[];
  totalDirectories: number;
  byExtension: Record<string, number>;
  truncated: boolean;
};

const DEFAULT_MAX_FILES = 15000;
const TREE_MAX_DEPTH = 3;

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
  ".sass": "Sass",
  ".less": "Less",
  ".html": "HTML",
  ".yml": "YAML",
  ".yaml": "YAML",
  ".toml": "TOML",
  ".xml": "XML",
  ".sh": "Shell",
  ".ps1": "PowerShell",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".swift": "Swift",
  ".rb": "Ruby",
  ".php": "PHP",
  ".sql": "SQL"
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

const IMPORTANT_CONFIG_FILES = [
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "next.config.js",
  "next.config.mjs",
  "vite.config.ts",
  "vite.config.js",
  "webpack.config.js",
  "rollup.config.js",
  "babel.config.js",
  ".babelrc",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.json",
  "eslint.config.js",
  "prettier.config.js",
  ".prettierrc",
  "tailwind.config.js",
  "tailwind.config.ts",
  "postcss.config.js",
  "jest.config.js",
  "jest.config.ts",
  "vitest.config.ts",
  "vitest.config.js",
  "playwright.config.ts",
  "cypress.config.ts",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml"
];

const NON_PRIMARY_PATH_SEGMENTS = [
  "fixture",
  "fixtures",
  "example",
  "examples",
  "sample",
  "samples",
  "demo",
  "demos",
  "mock",
  "mocks",
  "tmp",
  "temp",
  "sandbox"
];

type PackageJsonData = {
  packagePath: string;
  name?: string;
  description?: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

function extOf(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext.length > 0 ? ext : "[no-ext]";
}

function getIndexerIgnoreNames(): Set<string> {
  const ignoreNames = getDefaultIgnoreNames();
  ignoreNames.add("coverage");
  ignoreNames.add(".awesome-context");
  return ignoreNames;
}

async function readPackageJson(rootDir: string, packageRelativePath: string): Promise<PackageJsonData | null> {
  const packagePath = path.join(rootDir, packageRelativePath);
  try {
    const raw = await fs.readFile(packagePath, "utf8");
    const parsed = JSON.parse(raw) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    return {
      packagePath: packageRelativePath,
      name: typeof (parsed as { name?: string }).name === "string" ? (parsed as { name?: string }).name : undefined,
      description:
        typeof (parsed as { description?: string }).description === "string"
          ? (parsed as { description?: string }).description
          : undefined,
      scripts: parsed.scripts ?? {},
      dependencies: parsed.dependencies ?? {},
      devDependencies: parsed.devDependencies ?? {}
    };
  } catch {
    return null;
  }
}

async function discoverWorkspacePackages(rootDir: string, files: IndexedFile[]): Promise<PackageJsonData[]> {
  const packagePaths = files
    .map((file) => file.path)
    .filter((filePath) => path.basename(filePath).toLowerCase() === "package.json")
    .sort((a, b) => a.localeCompare(b));

  const packages: PackageJsonData[] = [];
  for (const packagePath of packagePaths) {
    const data = await readPackageJson(rootDir, packagePath);
    if (data) {
      packages.push(data);
    }
  }

  return packages;
}

function detectFrameworks(packageJsons: PackageJsonData[], files: IndexedFile[]): string[] {
  const fileSet = new Set(files.map((file) => file.path.toLowerCase()));
  const deps = new Set<string>();

  for (const packageJson of packageJsons) {
    for (const key of Object.keys(packageJson.dependencies)) {
      deps.add(key.toLowerCase());
    }
    for (const key of Object.keys(packageJson.devDependencies)) {
      deps.add(key.toLowerCase());
    }
  }

  const hasNext = deps.has("next") || fileSet.has("next.config.js") || fileSet.has("next.config.mjs");
  const hasRemix = deps.has("@remix-run/node") || deps.has("@remix-run/react");
  const hasNuxt = deps.has("nuxt");
  const hasReact = deps.has("react");
  const hasVue = deps.has("vue");

  const frameworks: string[] = [];
  const add = (name: string, condition: boolean) => {
    if (condition) {
      frameworks.push(name);
    }
  };

  // Prioritize meta-frameworks over base UI libraries.
  add("Next.js", hasNext);
  add("Remix", hasRemix);
  add("Nuxt", hasNuxt);
  add("Astro", deps.has("astro"));
  add("NestJS", deps.has("@nestjs/core"));
  add("Express", deps.has("express"));
  add("Fastify", deps.has("fastify"));
  add("Koa", deps.has("koa"));
  add("Angular", deps.has("@angular/core"));
  add("Svelte", deps.has("svelte"));
  add("React", hasReact && !hasNext && !hasRemix);
  add("Vue", hasVue && !hasNuxt);

  return frameworks;
}

function detectLanguages(byExtension: Record<string, number>): Array<{ language: string; files: number }> {
  const languageCounts: Record<string, number> = {};

  for (const [extension, count] of Object.entries(byExtension)) {
    const language = LANGUAGE_BY_EXTENSION[extension];
    if (!language) {
      continue;
    }
    languageCounts[language] = (languageCounts[language] ?? 0) + count;
  }

  return Object.entries(languageCounts)
    .map(([language, files]) => ({ language, files }))
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
}

function pickImportantConfigs(files: IndexedFile[]): string[] {
  const fileSet = new Set(files.map((file) => file.path));
  const selected = IMPORTANT_CONFIG_FILES.filter((name) => fileSet.has(name));

  for (const file of files) {
    if (file.path.endsWith(".config.ts") || file.path.endsWith(".config.js") || file.path.endsWith(".config.mjs")) {
      if (!selected.includes(file.path)) {
        selected.push(file.path);
      }
    }
  }

  return selected.sort((a, b) => a.localeCompare(b));
}

function pickEntrypoints(files: IndexedFile[]): string[] {
  const entrypoints = files
    .map((file) => file.path)
    .filter((filePath) => ENTRYPOINT_NAMES.has(path.basename(filePath).toLowerCase()));

  return entrypoints.sort((a, b) => scorePathForBrowsing(b) - scorePathForBrowsing(a) || a.localeCompare(b));
}

function scorePathForBrowsing(filePath: string): number {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const segments = normalized.split("/");
  let score = 0;

  if (normalized.startsWith("src/")) score += 40;
  if (normalized === "package.json") score += 35;
  if (normalized === "tsconfig.json") score += 20;
  if (normalized.startsWith("scripts/")) score += 12;
  if (normalized.startsWith("docs/")) score += 8;
  if (normalized.startsWith("test/")) score -= 18;
  if (normalized.includes("/.tmp-") || normalized.startsWith(".tmp-")) score -= 40;
  if (segments.some((segment) => NON_PRIMARY_PATH_SEGMENTS.includes(segment))) score -= 30;

  return score;
}

function isPrimaryBrowsePath(filePath: string): boolean {
  return scorePathForBrowsing(filePath) >= 0;
}

function partitionWorkspacePackages(packageJsons: PackageJsonData[]): {
  primary: PackageJsonData[];
  auxiliary: PackageJsonData[];
} {
  const primary: PackageJsonData[] = [];
  const auxiliary: PackageJsonData[] = [];

  for (const pkg of packageJsons) {
    if (isPrimaryBrowsePath(pkg.packagePath)) {
      primary.push(pkg);
    } else {
      auxiliary.push(pkg);
    }
  }

  return { primary, auxiliary };
}

function partitionTopDirectories(directories: Array<{ name: string; files: number }>): {
  primary: Array<{ name: string; files: number }>;
  auxiliary: Array<{ name: string; files: number }>;
} {
  const primary: Array<{ name: string; files: number }> = [];
  const auxiliary: Array<{ name: string; files: number }> = [];

  for (const dir of directories) {
    if (isPrimaryBrowsePath(`${dir.name}/`)) {
      primary.push(dir);
    } else {
      auxiliary.push(dir);
    }
  }

  return { primary, auxiliary };
}

function partitionEntrypoints(entrypoints: string[]): { primary: string[]; auxiliary: string[] } {
  const primary: string[] = [];
  const auxiliary: string[] = [];

  for (const entrypoint of entrypoints) {
    if (isPrimaryBrowsePath(entrypoint)) {
      primary.push(entrypoint);
    } else {
      auxiliary.push(entrypoint);
    }
  }

  return { primary, auxiliary };
}

function pickTopDirectories(files: IndexedFile[]): Array<{ name: string; files: number }> {
  const counts: Record<string, number> = {};

  for (const file of files) {
    const topLevel = file.path.split("/")[0];
    if (!topLevel || topLevel === ".") {
      continue;
    }
    counts[topLevel] = (counts[topLevel] ?? 0) + 1;
  }

  return Object.entries(counts)
    .map(([name, fileCount]) => ({ name, files: fileCount }))
    .sort((a, b) => {
      const scoreDiff = scorePathForBrowsing(`${b.name}/`) - scorePathForBrowsing(`${a.name}/`);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return b.files - a.files || a.name.localeCompare(b.name);
    });
}

function summarizeDependencies(packageJsons: PackageJsonData[], limit = 14): string[] {
  const counts: Record<string, number> = {};

  for (const pkg of packageJsons) {
    for (const dep of [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]) {
      counts[dep] = (counts[dep] ?? 0) + 1;
    }
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

async function readReadmeSummary(rootDir: string): Promise<string | null> {
  const candidates = ["README.md", "readme.md"];

  for (const candidate of candidates) {
    const fullPath = path.join(rootDir, candidate);
    try {
      const raw = await fs.readFile(fullPath, "utf8");
      const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !line.startsWith("#"))
        .filter((line) => !line.startsWith("!["))
        .filter((line) => !line.startsWith("[!["));

      const summary = lines.find((line) => line.length >= 30 && line.length <= 220);
      if (summary) {
        return summary;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function renderWorkspacePackages(packageJsons: PackageJsonData[]): string {
  if (packageJsons.length === 0) {
    return "- none detected";
  }

  return packageJsons
    .slice()
    .sort((a, b) => scorePathForBrowsing(b.packagePath) - scorePathForBrowsing(a.packagePath) || a.packagePath.localeCompare(b.packagePath))
    .map((pkg) => {
      const scope = pkg.packagePath === "package.json" ? "root" : path.posix.dirname(pkg.packagePath.replace(/\\/g, "/"));
      const name = pkg.name ?? "(unnamed package)";
      const description = pkg.description ? `: ${pkg.description}` : "";
      return `- ${scope} -> ${name}${description}`;
    })
    .join("\n");
}

function renderDirectoryLines(directories: Array<{ name: string; files: number }>): string {
  if (directories.length === 0) {
    return "- none detected";
  }

  return directories.map((dir) => `- ${dir.name}/: ${dir.files} files`).join("\n");
}

function buildBrowseFirstLines(params: {
  readmeSummary: string | null;
  importantConfigs: string[];
  entrypoints: string[];
  topDirectories: Array<{ name: string; files: number }>;
  testCommands: Array<{ name: string; command: string }>;
  buildCommands: Array<{ name: string; command: string }>;
}): string[] {
  const lines: string[] = [];

  if (params.readmeSummary) {
    lines.push(`Start with README intent: ${params.readmeSummary}`);
  }

  const primaryEntrypoints = params.entrypoints.filter((entrypoint) => isPrimaryBrowsePath(entrypoint));
  for (const entrypoint of primaryEntrypoints.slice(0, 3)) {
    lines.push(`Inspect entrypoint: ${entrypoint}`);
  }

  for (const config of params.importantConfigs.slice(0, 3)) {
    lines.push(`Inspect config: ${config}`);
  }

  const primaryDirectories = params.topDirectories.filter((dir) => isPrimaryBrowsePath(`${dir.name}/`));
  for (const dir of primaryDirectories.slice(0, 3)) {
    lines.push(`Browse directory: ${dir.name}/ (${dir.files} files)`);
  }

  if (params.buildCommands[0]) {
    lines.push(`Build command: ${params.buildCommands[0].name}`);
  }
  if (params.testCommands[0]) {
    lines.push(`Test command: ${params.testCommands[0].name}`);
  }

  return lines;
}

function detectCommands(
  scripts: Array<{ name: string; command: string }>
): { testCommands: Array<{ name: string; command: string }>; buildCommands: Array<{ name: string; command: string }> } {
  const testCommands = scripts
    .filter((script) => /test|spec|e2e|coverage|vitest|jest/i.test(script.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const buildCommands = scripts
    .filter((script) => /build|compile|bundle|prod/i.test(script.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { testCommands, buildCommands };
}

function collectWorkspaceScripts(packageJsons: PackageJsonData[]): Array<{ name: string; command: string }> {
  const scripts: Array<{ name: string; command: string }> = [];

  for (const pkg of packageJsons) {
    const normalized = pkg.packagePath.replace(/\\/g, "/");
    const scope = normalized === "package.json" ? "root" : path.posix.dirname(normalized);
    for (const [name, command] of Object.entries(pkg.scripts)) {
      scripts.push({ name: `${scope}#${name}`, command });
    }
  }

  return scripts.sort((a, b) => a.name.localeCompare(b.name));
}

async function renderFolderTree(rootDir: string, ignoreNames: Set<string>, maxDepth: number): Promise<string[]> {
  const lines: string[] = ["."];

  const walk = async (currentDir: string, depth: number, prefix: string): Promise<void> => {
    if (depth >= maxDepth) {
      return;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const visibleEntries = entries
      .filter((entry) => !ignoreNames.has(entry.name))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) {
          return -1;
        }
        if (!a.isDirectory() && b.isDirectory()) {
          return 1;
        }
        return a.name.localeCompare(b.name);
      });

    for (let i = 0; i < visibleEntries.length; i += 1) {
      const entry = visibleEntries[i];
      const isLast = i === visibleEntries.length - 1;
      const branch = isLast ? "└── " : "├── ";
      const childPrefix = `${prefix}${isLast ? "    " : "│   "}`;
      const displayName = entry.isDirectory() ? `${entry.name}/` : entry.name;
      lines.push(`${prefix}${branch}${displayName}`);

      if (entry.isDirectory()) {
        await walk(path.join(currentDir, entry.name), depth + 1, childPrefix);
      }
    }
  };

  await walk(rootDir, 0, "");
  return lines;
}

async function walkDirectory(
  rootDir: string,
  currentDir: string,
  state: WalkState,
  ignoreNames: Set<string>,
  maxFiles: number
): Promise<void> {
  if (state.files.length >= maxFiles) {
    state.truncated = true;
    return;
  }

  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (ignoreNames.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      state.totalDirectories += 1;
      await walkDirectory(rootDir, absolutePath, state, ignoreNames, maxFiles);
      if (state.files.length >= maxFiles) {
        state.truncated = true;
        return;
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const stat = await fs.stat(absolutePath);
    state.files.push({
      path: relativePath,
      bytes: stat.size,
      mtimeMs: stat.mtimeMs
    });

    const extension = extOf(relativePath);
    state.byExtension[extension] = (state.byExtension[extension] ?? 0) + 1;

    if (state.files.length >= maxFiles) {
      state.truncated = true;
      return;
    }
  }
}

function renderIndexMarkdown(
  data: IndexData,
  treeLines: string[],
  readmeSummary: string | null,
  packageJsons: PackageJsonData[],
  languages: Array<{ language: string; files: number }>,
  frameworks: string[],
  scripts: Array<{ name: string; command: string }>,
  importantConfigs: string[],
  testCommands: Array<{ name: string; command: string }>,
  buildCommands: Array<{ name: string; command: string }>,
  entrypoints: string[],
  dependencyHighlights: string[]
): string {
  const languageLines = languages.length
    ? languages.map((item) => `- ${item.language}: ${item.files}`).join("\n")
    : "- none";

  const frameworkLines = frameworks.length ? frameworks.map((name) => `- ${name}`).join("\n") : "- none";

  const scriptLines = scripts.length
    ? scripts.map((item) => `- ${item.name}: ${item.command}`).join("\n")
    : "- none";

  const configLines = importantConfigs.length
    ? importantConfigs.map((filePath) => `- ${filePath}`).join("\n")
    : "- none";

  const testLines = testCommands.length
    ? testCommands.map((item) => `- ${item.name}: ${item.command}`).join("\n")
    : "- none detected";

  const buildLines = buildCommands.length
    ? buildCommands.map((item) => `- ${item.name}: ${item.command}`).join("\n")
    : "- none detected";

  const entrypointGroups = partitionEntrypoints(entrypoints);
  const entrypointLines = entrypointGroups.primary.length
    ? entrypointGroups.primary.map((filePath) => `- ${filePath}`).join("\n")
    : "- none detected";
  const auxiliaryEntrypointLines = entrypointGroups.auxiliary.length
    ? entrypointGroups.auxiliary.map((filePath) => `- ${filePath}`).join("\n")
    : "- none detected";

  const packageGroups = partitionWorkspacePackages(packageJsons);
  const primaryPackageLines = renderWorkspacePackages(packageGroups.primary);
  const auxiliaryPackageLines = renderWorkspacePackages(packageGroups.auxiliary);
  const directoryGroups = partitionTopDirectories(pickTopDirectories(data.files));

  const topDirectoryLines = renderDirectoryLines(directoryGroups.primary.slice(0, 8));
  const auxiliaryDirectoryLines = renderDirectoryLines(directoryGroups.auxiliary.slice(0, 8));

  const dependencyLines = dependencyHighlights.length
    ? dependencyHighlights.map((dependency) => `- ${dependency}`).join("\n")
    : "- none detected";

  const identityLines = [
    packageJsons[0]?.name ? `- Root package: ${packageJsons[0].name}` : "- Root package: unknown",
    packageJsons[0]?.description
      ? `- Package description: ${packageJsons[0].description}`
      : readmeSummary
        ? `- README summary: ${readmeSummary}`
        : "- README summary: none detected",
    `- Workspace packages: ${packageJsons.length}`,
    `- Direct dependencies indexed: ${data.dependencies.length}`
  ].join("\n");

  const browseFirstLines = buildBrowseFirstLines({
    readmeSummary,
    importantConfigs,
    entrypoints,
    topDirectories: pickTopDirectories(data.files),
    testCommands,
    buildCommands
  });

  const browseFirst = browseFirstLines.length
    ? browseFirstLines.map((line) => `- ${line}`).join("\n")
    : "- none detected";

  return `# Project Map

Generated at: ${data.generatedAt}

## Repository Snapshot
- Total files: ${data.totalFiles}
- Total directories: ${data.totalDirectories}
- Truncated scan: ${data.truncated ? "yes" : "no"}

## Repository Identity
${identityLines}

## Browse First
${browseFirst}

## Workspace Packages
${primaryPackageLines}

## Auxiliary Packages
${auxiliaryPackageLines}

## Folder Tree (max depth 3)

\`\`\`text
${treeLines.join("\n")}
\`\`\`

## Detected Languages
${languageLines}

## Detected Frameworks
${frameworkLines}

## Package Scripts
${scriptLines}

## Important Config Files
${configLines}

## Test Commands
${testLines}

## Build Commands
${buildLines}

## Entrypoints
${entrypointLines}

## Auxiliary Entrypoints
${auxiliaryEntrypointLines}

## Key Directories
${topDirectoryLines}

## Auxiliary Paths
${auxiliaryDirectoryLines}

## Dependency Highlights
${dependencyLines}
`;
}

export async function indexProject(rootDir: string, options: IndexOptions = {}): Promise<IndexResult> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const paths = getContextPaths(rootDir);
  await fs.mkdir(paths.contextDir, { recursive: true });

  const state: WalkState = {
    files: [],
    totalDirectories: 0,
    byExtension: {},
    truncated: false
  };

  const ignoreNames = getIndexerIgnoreNames();
  await walkDirectory(rootDir, rootDir, state, ignoreNames, maxFiles);

  state.files.sort((a, b) => a.path.localeCompare(b.path));

  const packageJsons = await discoverWorkspacePackages(rootDir, state.files);
  const scripts = collectWorkspaceScripts(packageJsons);

  const mergedScripts: Record<string, string> = {};
  const mergedDeps: string[] = [];
  for (const pkg of packageJsons) {
    Object.assign(mergedScripts, pkg.scripts);
    mergedDeps.push(...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies));
  }

  const data: IndexData = {
    generatedAt: new Date().toISOString(),
    rootDir,
    totalFiles: state.files.length,
    totalDirectories: state.totalDirectories,
    byExtension: state.byExtension,
    files: state.files,
    truncated: state.truncated,
    packageScripts: mergedScripts,
    dependencies: [...new Set(mergedDeps)]
  };

  const frameworks = detectFrameworks(packageJsons, state.files);
  const languages = detectLanguages(state.byExtension);
  const importantConfigs = pickImportantConfigs(state.files);
  const entrypoints = pickEntrypoints(state.files);
  const topDirectories = pickTopDirectories(state.files);
  const dependencyHighlights = summarizeDependencies(packageJsons);
  const { testCommands, buildCommands } = detectCommands(scripts);
  const treeLines = await renderFolderTree(rootDir, ignoreNames, TREE_MAX_DEPTH);
  const readmeSummary = await readReadmeSummary(rootDir);

  const markdown = renderIndexMarkdown(
    data,
    treeLines,
    readmeSummary,
    packageJsons,
    languages,
    frameworks,
    scripts,
    importantConfigs,
    testCommands,
    buildCommands,
    entrypoints,
    dependencyHighlights
  );
  if (options.writeMarkdown !== false) {
    await fs.writeFile(paths.projectMapPath, markdown, "utf8");
  }
  if (options.writeJson !== false) {
    await fs.writeFile(paths.indexJsonPath, JSON.stringify(data, null, 2), "utf8");
  }

  return {
    indexMarkdownPath: paths.projectMapPath,
    indexJsonPath: paths.indexJsonPath,
    data
  };
}
