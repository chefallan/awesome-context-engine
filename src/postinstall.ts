import { promises as fs } from "node:fs";
import path from "node:path";

const DESIRED_ENTRIES = [
  ".awesome-context/ai-context.md",
  ".awesome-context/minimal-context.md",
  ".awesome-context/graph.json",
  ".awesome-context/file-hashes.json",
  "!.awesome-context/memory.md",
  "!.awesome-context/project-map.md",
  "!.awesome-context/workflows.md",
  "!.awesome-context/decisions.md",
  "!.awesome-context/preferences.md",
  "!.awesome-context/skills/",
  "!.awesome-context/skills/**",
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  "*.tsbuildinfo",
  "*.log",
  "npm-debug.log*",
  "yarn-debug.log*",
  "yarn-error.log*",
  "pnpm-debug.log*",
  ".env",
  ".env.*",
  "!.env.example",
  ".DS_Store",
  "Thumbs.db",
  "*.tmp",
  "*.temp",
  ".tmp*/",
];

const ENV_TEMPLATE = `# awesome-context-engine
# Anthropic API key — https://console.anthropic.com
ANTHROPIC_API_KEY=
`;

function isAutoTaskCommand(cmd: unknown): boolean {
  if (typeof cmd !== "string") return false;
  const normalized = cmd.trim().replace(/\s+/g, " ");
  return (
    normalized === "npx awesome-context-engine auto" ||
    normalized === "npx --yes awesome-context-engine auto" ||
    /(?:^|\s)awesome-context-engine\s+auto(?:\s|$)/.test(normalized) ||
    /(?:^|\s)ace\s+auto(?:\s|$)/.test(normalized)
  );
}

async function removeOldAutoTask(projectRoot: string): Promise<void> {
  const tasksPath = path.join(projectRoot, ".vscode", "tasks.json");

  let raw: string;
  try {
    raw = await fs.readFile(tasksPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }

  let parsed: { tasks?: unknown[]; [key: string]: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // malformed tasks.json — leave untouched
  }

  if (!Array.isArray(parsed.tasks)) return;

  const before = parsed.tasks.length;
  parsed.tasks = parsed.tasks.filter((task) => {
    if (typeof task !== "object" || task === null) return true;
    const t = task as Record<string, unknown>;
    if (isAutoTaskCommand(t.command)) return false;
    // handle shell tasks where command may be nested under options or args
    if (typeof t.args === "string" && isAutoTaskCommand(t.args)) return false;
    return true;
  });

  if (parsed.tasks.length === before) return;

  const removed = before - parsed.tasks.length;
  await fs.writeFile(tasksPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  console.log(
    `awesome-context-engine: removed ${removed} deprecated \`auto\` task${removed > 1 ? "s" : ""} from .vscode/tasks.json`
  );
}

async function ensureGitignoreEntries(projectRoot: string): Promise<void> {
  const gitignorePath = path.join(projectRoot, ".gitignore");

  let existing = "";
  try {
    existing = await fs.readFile(gitignorePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const existingLines = new Set(
    existing.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  );

  const missing = DESIRED_ENTRIES.filter((entry) => !existingLines.has(entry));
  if (missing.length === 0) return;

  const append = `\n# awesome-context-engine\n${missing.join("\n")}\n`;
  await fs.writeFile(gitignorePath, `${existing.trimEnd()}${append}`, "utf8");
  console.log(`awesome-context-engine: added ${missing.length} missing entr${missing.length === 1 ? "y" : "ies"} to .gitignore`);
}

async function ensureEnvFile(projectRoot: string): Promise<void> {
  const envPath = path.join(projectRoot, ".env");
  try {
    await fs.access(envPath);
  } catch {
    await fs.writeFile(envPath, ENV_TEMPLATE, "utf8");
    console.log("awesome-context-engine: created .env with API key placeholder");
  }
}

function parseVersion(v: string): [number, number, number] {
  const parts = v.replace(/^[^0-9]*/, "").split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function versionGte(version: string, min: string): boolean {
  const [ma, mi, pa] = parseVersion(version);
  const [mb, mib, pb] = parseVersion(min);
  if (ma !== mb) return ma > mb;
  if (mi !== mib) return mi > mib;
  return pa >= pb;
}

async function run(): Promise<void> {
  const projectRoot = process.env.INIT_CWD;
  if (!projectRoot || projectRoot === process.cwd()) {
    return;
  }

  // Read own version from package.json alongside the compiled output.
  let ownVersion = "0.0.0";
  try {
    const pkgPath = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "package.json");
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8")) as { version?: string };
    if (typeof pkg.version === "string") ownVersion = pkg.version;
  } catch {
    // best-effort
  }

  const migrations: Promise<void>[] = [
    ensureGitignoreEntries(projectRoot),
    ensureEnvFile(projectRoot)
  ];

  if (versionGte(ownVersion, "2.0.0")) {
    migrations.push(removeOldAutoTask(projectRoot));
  }

  await Promise.all(migrations);
}

run().catch((err: unknown) => {
  console.warn("awesome-context-engine postinstall warning:", (err as Error).message);
});
