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

# Optional: set to 1 to skip the GitHub Copilot login prompt on commit-msg
# ACE_NO_COPILOT_PROMPT=1
`;

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

async function run(): Promise<void> {
  const projectRoot = process.env.INIT_CWD;
  if (!projectRoot || projectRoot === process.cwd()) {
    return;
  }

  await Promise.all([
    ensureGitignoreEntries(projectRoot),
    ensureEnvFile(projectRoot)
  ]);
}

run().catch((err: unknown) => {
  console.warn("awesome-context-engine postinstall warning:", (err as Error).message);
});
