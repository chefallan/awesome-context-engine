import { promises as fs } from "node:fs";
import path from "node:path";

export type VscodeTaskStatus = "created" | "updated" | "unchanged";

type TaskDefinition = {
  label: string;
  type: string;
  command: string;
  isBackground?: boolean;
  problemMatcher?: unknown[];
  runOptions?: Record<string, unknown>;
  presentation?: Record<string, unknown>;
  [key: string]: unknown;
};

type TasksFile = {
  version?: string;
  tasks?: unknown;
  [key: string]: unknown;
};

export const AUTO_TASK_LABEL = "awesome-context auto";

export function getAutoTaskDefinition(): TaskDefinition {
  return {
    label: AUTO_TASK_LABEL,
    type: "shell",
    command: "npx awesome-context-engine auto",
    isBackground: true,
    problemMatcher: [],
    runOptions: {
      runOn: "folderOpen"
    },
    presentation: {
      reveal: "silent",
      panel: "dedicated",
      clear: false
    }
  };
}

function stripJsonComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function stripTrailingCommas(content: string): string {
  return content.replace(/,\s*([}\]])/g, "$1");
}

function parseTasksFile(raw: string): TasksFile {
  const normalized = stripTrailingCommas(stripJsonComments(raw));
  const parsed = JSON.parse(normalized) as TasksFile;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return parsed;
}

function extractTasks(parsed: TasksFile): unknown[] {
  return Array.isArray(parsed.tasks) ? [...parsed.tasks] : [];
}

function hasAutoTaskInList(tasks: unknown[]): boolean {
  return tasks.some((task) => {
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      return false;
    }
    return (task as Record<string, unknown>).label === AUTO_TASK_LABEL;
  });
}

export async function hasVscodeAutoTask(rootDir: string): Promise<boolean> {
  const tasksPath = path.join(rootDir, ".vscode", "tasks.json");
  try {
    const raw = await fs.readFile(tasksPath, "utf8");
    const parsed = parseTasksFile(raw);
    const tasks = extractTasks(parsed);
    return hasAutoTaskInList(tasks);
  } catch {
    return false;
  }
}

export async function ensureVscodeAutoTask(rootDir: string): Promise<VscodeTaskStatus> {
  const tasksPath = path.join(rootDir, ".vscode", "tasks.json");
  const autoTask = getAutoTaskDefinition();

  let existingParsed: TasksFile = {};
  let fileExists = false;

  try {
    const raw = await fs.readFile(tasksPath, "utf8");
    existingParsed = parseTasksFile(raw);
    fileExists = true;
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode !== "ENOENT") {
      throw error;
    }
  }

  const tasks = extractTasks(existingParsed);
  const existingIndex = tasks.findIndex((task) => {
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      return false;
    }
    return (task as Record<string, unknown>).label === AUTO_TASK_LABEL;
  });

  let status: VscodeTaskStatus = "unchanged";
  if (!fileExists) {
    tasks.push(autoTask);
    status = "created";
  } else if (existingIndex >= 0) {
    const current = tasks[existingIndex];
    if (JSON.stringify(current) !== JSON.stringify(autoTask)) {
      tasks[existingIndex] = autoTask;
      status = "updated";
    }
  } else {
    tasks.push(autoTask);
    status = "updated";
  }

  if (status === "unchanged") {
    return status;
  }

  const output: TasksFile = {
    ...existingParsed,
    version: typeof existingParsed.version === "string" ? existingParsed.version : "2.0.0",
    tasks
  };

  await fs.mkdir(path.dirname(tasksPath), { recursive: true });
  await fs.writeFile(tasksPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return status;
}
