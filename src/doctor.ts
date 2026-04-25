import { promises as fs } from "node:fs";
import path from "node:path";
import { getContextPaths } from "./templates.js";
import { hasVscodeAutoTask } from "./vscodeTask.js";

export type DoctorCheck = {
  label: string;
  ok: boolean;
  detail?: string;
};

export type DoctorResult = {
  healthy: boolean;
  checks: DoctorCheck[];
};

const REQUIRED_MEMORY_FILES = ["memory.md", "project-map.md", "workflows.md", "decisions.md", "preferences.md"];

async function existsAsFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function existsAsDirectory(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function canRunAutoMode(rootDir: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const packagePath = path.join(rootDir, "package.json");
    const raw = await fs.readFile(packagePath, "utf8");
    const pkg = JSON.parse(raw) as {
      bin?: string | Record<string, string>;
    };

    let binPath = "";
    if (typeof pkg.bin === "string") {
      binPath = pkg.bin;
    } else if (pkg.bin && typeof pkg.bin === "object") {
      const direct = pkg.bin["awesome-context-engine"];
      if (typeof direct === "string") {
        binPath = direct;
      }
    }

    if (!binPath) {
      return { ok: false, detail: "package.json bin is not configured." };
    }

    const resolved = path.resolve(rootDir, binPath);
    const exists = await existsAsFile(resolved);
    if (!exists) {
      return { ok: false, detail: `Bin target missing: ${binPath}` };
    }

    const code = await fs.readFile(resolved, "utf8");
    if (!code.startsWith("#!/usr/bin/env node")) {
      return { ok: false, detail: "CLI bin file is missing a Node shebang." };
    }

    if (!code.includes('case "auto"')) {
      return { ok: false, detail: "CLI command handler does not include auto mode." };
    }

    return { ok: true, detail: "Package bin points to an auto-capable CLI build." };
  } catch (error) {
    return {
      ok: false,
      detail: `Auto mode check failed: ${(error as Error).message}`
    };
  }
}

export async function runDoctor(rootDir: string): Promise<DoctorResult> {
  const paths = getContextPaths(rootDir);
  const checks: DoctorCheck[] = [];

  const hasContextDir = await existsAsDirectory(paths.contextDir);
  checks.push({
    label: ".awesome-context exists",
    ok: hasContextDir,
    detail: hasContextDir ? "Found" : "Missing .awesome-context directory."
  });

  const missingMemory: string[] = [];
  for (const fileName of REQUIRED_MEMORY_FILES) {
    const present = await existsAsFile(path.join(paths.contextDir, fileName));
    if (!present) {
      missingMemory.push(fileName);
    }
  }
  checks.push({
    label: "required memory files exist",
    ok: missingMemory.length === 0,
    detail: missingMemory.length === 0 ? "All required files present." : `Missing: ${missingMemory.join(", ")}`
  });

  const hasAiContext = await existsAsFile(paths.aiContextPath);
  checks.push({
    label: "ai-context.md exists",
    ok: hasAiContext,
    detail: hasAiContext ? "Found" : "Missing .awesome-context/ai-context.md"
  });

  const hasTask = await hasVscodeAutoTask(rootDir);
  checks.push({
    label: "VS Code auto task exists",
    ok: hasTask,
    detail: hasTask ? "Found awesome-context auto task." : "Task missing in .vscode/tasks.json"
  });

  const autoMode = await canRunAutoMode(rootDir);
  checks.push({
    label: "package can run auto mode",
    ok: autoMode.ok,
    detail: autoMode.detail
  });

  return {
    healthy: checks.every((check) => check.ok),
    checks
  };
}
