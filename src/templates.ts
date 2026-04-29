import path from "node:path";

export const CONTEXT_DIR_NAME = ".awesome-context";

export type ContextPaths = {
  contextDir: string;
  skillsDir: string;
  memoryDir: string;
  fileContextPath: string;
  cachePath: string;
  memoryPath: string;
  memoryItemsPath: string;
  memorySummariesPath: string;
  memoryIndexPath: string;
  workflowsPath: string;
  decisionsPath: string;
  preferencesPath: string;
  configPath: string;
  aiContextPath: string;
  projectMapPath: string;
  indexJsonPath: string;
  graphJsonPath: string;
  impactMapPath: string;
  minimalContextPath: string;
};

export function getContextPaths(rootDir: string): ContextPaths {
  const contextDir = path.join(rootDir, CONTEXT_DIR_NAME);
  const memoryDir = path.join(contextDir, "memory");

  return {
    contextDir,
    skillsDir: path.join(contextDir, "skills"),
    memoryDir,
    fileContextPath: path.join(contextDir, "file-context.json"),
    cachePath: path.join(contextDir, "cache.json"),
    memoryPath: path.join(contextDir, "memory.md"),
    memoryItemsPath: path.join(memoryDir, "items.json"),
    memorySummariesPath: path.join(memoryDir, "summaries.json"),
    memoryIndexPath: path.join(memoryDir, "index.json"),
    workflowsPath: path.join(contextDir, "workflows.md"),
    decisionsPath: path.join(contextDir, "decisions.md"),
    preferencesPath: path.join(contextDir, "preferences.md"),
    configPath: path.join(contextDir, "config.json"),
    aiContextPath: path.join(contextDir, "ai-context.md"),
    projectMapPath: path.join(contextDir, "project-map.md"),
    indexJsonPath: path.join(contextDir, "project-index.json"),
    graphJsonPath: path.join(contextDir, "graph.json"),
    impactMapPath: path.join(contextDir, "impact-map.json"),
    minimalContextPath: path.join(contextDir, "minimal-context.md")
  };
}

export function getDefaultIgnoreNames(): Set<string> {
  return new Set([
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    CONTEXT_DIR_NAME
  ]);
}
