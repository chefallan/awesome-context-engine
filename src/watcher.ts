import { watch, FSWatcher, promises as fs } from "node:fs";
import path from "node:path";
import { indexProject } from "./indexer.js";
import { syncContext } from "./sync.js";
import { CONTEXT_DIR_NAME, getDefaultIgnoreNames } from "./templates.js";

const DEBOUNCE_MS = 3000;

const AUTO_TRIGGER_CONTEXT_FILES = new Set([
  `${CONTEXT_DIR_NAME}/memory.md`,
  `${CONTEXT_DIR_NAME}/preferences.md`,
  `${CONTEXT_DIR_NAME}/decisions.md`,
  `${CONTEXT_DIR_NAME}/workflows.md`,
  `${CONTEXT_DIR_NAME}/config.json`,
  `${CONTEXT_DIR_NAME}/memory/items.json`,
  `${CONTEXT_DIR_NAME}/memory/summaries.json`,
  `${CONTEXT_DIR_NAME}/memory/index.json`
]);

export type AutoModeOptions = {
  strict?: boolean;
};

function shouldIgnore(relativePath: string | null): boolean {
  if (!relativePath) {
    return false;
  }

  const normalized = relativePath.replace(/\\/g, "/");

  if (normalized.startsWith(`${CONTEXT_DIR_NAME}/`)) {
    return !AUTO_TRIGGER_CONTEXT_FILES.has(normalized);
  }

  const baseName = path.posix.basename(normalized);
  const ignoredNames = getDefaultIgnoreNames();
  ignoredNames.add("coverage");

  if (ignoredNames.has(baseName)) {
    return true;
  }

  return (
    normalized.startsWith("node_modules/") ||
    normalized.startsWith(".git/") ||
    normalized.startsWith(".next/") ||
    normalized.startsWith("dist/") ||
    normalized.startsWith("build/") ||
    normalized.startsWith("coverage/")
  );
}

function normalizeRelativePath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\//, "");
}

function sanitizeForLog(input: string): string {
  // Strip control characters (including ANSI escape initiators) from untrusted file names.
  return input.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

async function collectKnownFiles(rootDir: string): Promise<Set<string>> {
  const known = new Set<string>();

  const walk = async (currentDir: string): Promise<void> => {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = normalizeRelativePath(path.relative(rootDir, absolutePath));

      if (shouldIgnore(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        known.add(relativePath);
      }
    }
  };

  await walk(rootDir);
  return known;
}

export async function startAutoMode(rootDir: string, options: AutoModeOptions = {}): Promise<void> {
  let timer: NodeJS.Timeout | null = null;
  let isRunning = false;
  let rerunRequested = false;
  let watcher: FSWatcher | null = null;
  const knownFiles = await collectKnownFiles(rootDir);

  const run = async () => {
    if (isRunning) {
      rerunRequested = true;
      return;
    }

    isRunning = true;
    try {
      await indexProject(rootDir);
      console.log("Updated project map");

      await syncContext(rootDir, { strict: options.strict });
      console.log("Synced AI context");
      console.log("[auto] cycle complete (index + sync)");
    } catch (error) {
      console.error("[auto] sync failed", error);
    } finally {
      isRunning = false;
      if (rerunRequested) {
        rerunRequested = false;
        await run();
      }
    }
  };

  const detectChangeType = async (relativePath: string): Promise<"add" | "modify" | "delete"> => {
    const absolutePath = path.join(rootDir, relativePath);
    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isFile()) {
        return "modify";
      }

      if (knownFiles.has(relativePath)) {
        return "modify";
      }

      knownFiles.add(relativePath);
      return "add";
    } catch {
      if (knownFiles.has(relativePath)) {
        knownFiles.delete(relativePath);
        return "delete";
      }
      return "modify";
    }
  };

  const handlePathEvent = async (relativePath: string): Promise<void> => {
    if (shouldIgnore(relativePath)) {
      return;
    }

    const normalized = normalizeRelativePath(relativePath);
    const changeType = await detectChangeType(normalized);
    const safePath = sanitizeForLog(normalized);
    console.log(`Detected change in ${safePath} (${changeType})`);
    scheduleRun();
  };

  const scheduleRun = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      void run();
    }, DEBOUNCE_MS);
  };

  await run();

  try {
    watcher = watch(rootDir, { recursive: true }, (_eventType, filename) => {
      if (typeof filename !== "string" || filename.trim().length === 0) {
        return;
      }

      void handlePathEvent(filename);
    });
  } catch {
    console.warn("[auto] recursive watch unavailable, using interval mode");
    setInterval(() => {
      void run();
    }, 5000);
  }

  console.log("[auto] watching for changes. Press Ctrl+C to stop.");

  process.on("SIGINT", () => {
    if (watcher) {
      watcher.close();
    }
    console.log("\n[auto] stopped");
    process.exit(0);
  });
}
