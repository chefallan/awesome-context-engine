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
};

export type IndexResult = {
  indexMarkdownPath: string;
  indexJsonPath: string;
  data: IndexData;
};

export type IndexOptions = {
  maxFiles?: number;
  writeJson?: boolean;
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

type PackageJsonData = {
  packagePath: string;
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

  return entrypoints.sort((a, b) => a.localeCompare(b));
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
  languages: Array<{ language: string; files: number }>,
  frameworks: string[],
  scripts: Array<{ name: string; command: string }>,
  importantConfigs: string[],
  testCommands: Array<{ name: string; command: string }>,
  buildCommands: Array<{ name: string; command: string }>,
  entrypoints: string[]
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

  const entrypointLines = entrypoints.length
    ? entrypoints.map((filePath) => `- ${filePath}`).join("\n")
    : "- none detected";

  return `# Project Map

Generated at: ${data.generatedAt}

## Repository Snapshot
- Total files: ${data.totalFiles}
- Total directories: ${data.totalDirectories}
- Truncated scan: ${data.truncated ? "yes" : "no"}

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

  const data: IndexData = {
    generatedAt: new Date().toISOString(),
    rootDir,
    totalFiles: state.files.length,
    totalDirectories: state.totalDirectories,
    byExtension: state.byExtension,
    files: state.files,
    truncated: state.truncated
  };

  const frameworks = detectFrameworks(packageJsons, state.files);
  const languages = detectLanguages(state.byExtension);
  const importantConfigs = pickImportantConfigs(state.files);
  const entrypoints = pickEntrypoints(state.files);
  const { testCommands, buildCommands } = detectCommands(scripts);
  const treeLines = await renderFolderTree(rootDir, ignoreNames, TREE_MAX_DEPTH);

  const markdown = renderIndexMarkdown(
    data,
    treeLines,
    languages,
    frameworks,
    scripts,
    importantConfigs,
    testCommands,
    buildCommands,
    entrypoints
  );
  await fs.writeFile(paths.projectMapPath, markdown, "utf8");
  if (options.writeJson !== false) {
    await fs.writeFile(paths.indexJsonPath, JSON.stringify(data, null, 2), "utf8");
  }

  return {
    indexMarkdownPath: paths.projectMapPath,
    indexJsonPath: paths.indexJsonPath,
    data
  };
}
