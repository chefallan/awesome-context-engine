import path from "node:path";

export const CONTEXT_DIR_NAME = ".awesome-context";

export type ContextPaths = {
  contextDir: string;
  skillsDir: string;
  memoryPath: string;
  workflowsPath: string;
  decisionsPath: string;
  preferencesPath: string;
  aiContextPath: string;
  projectMapPath: string;
  indexJsonPath: string;
  graphJsonPath: string;
  minimalContextPath: string;
};

export function getContextPaths(rootDir: string): ContextPaths {
  const contextDir = path.join(rootDir, CONTEXT_DIR_NAME);

  return {
    contextDir,
    skillsDir: path.join(contextDir, "skills"),
    memoryPath: path.join(contextDir, "memory.md"),
    workflowsPath: path.join(contextDir, "workflows.md"),
    decisionsPath: path.join(contextDir, "decisions.md"),
    preferencesPath: path.join(contextDir, "preferences.md"),
    aiContextPath: path.join(contextDir, "ai-context.md"),
    projectMapPath: path.join(contextDir, "project-map.md"),
    indexJsonPath: path.join(contextDir, "project-index.json"),
    graphJsonPath: path.join(contextDir, "graph.json"),
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
