import { promises as fs } from "node:fs";
import path from "node:path";

const GITIGNORE_BLOCK = `
# awesome-context-engine — environment variables
.env
.env.local
.env.*.local
`;

const ENV_TEMPLATE = `# awesome-context-engine
# Anthropic API key — https://console.anthropic.com
ANTHROPIC_API_KEY=

# Optional: set to 1 to skip the GitHub Copilot login prompt on commit-msg
# ACE_NO_COPILOT_PROMPT=1
`;

async function ensureGitignoreEntries(projectRoot: string): Promise<void> {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  try {
    const existing = await fs.readFile(gitignorePath, "utf8");
    if (existing.includes(".env")) {
      return;
    }
    await fs.writeFile(gitignorePath, `${existing.trimEnd()}\n${GITIGNORE_BLOCK}`, "utf8");
    console.log("awesome-context-engine: added .env entries to .gitignore");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.writeFile(gitignorePath, GITIGNORE_BLOCK.trimStart(), "utf8");
      console.log("awesome-context-engine: created .gitignore with .env entries");
    }
  }
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
