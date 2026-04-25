import { promises as fs } from "node:fs";
import path from "node:path";
import { getContextPaths } from "./templates.js";

type BenchmarkFileStat = {
  file: string;
  exists: boolean;
  chars: number;
  estimatedTokens: number;
};

export type TokenBenchmarkResult = {
  generatedAt: string;
  baseline: {
    chars: number;
    estimatedTokens: number;
    files: BenchmarkFileStat[];
  };
  optimized: {
    chars: number;
    estimatedTokens: number;
    file: string;
  };
  delta: {
    charsSaved: number;
    tokensSaved: number;
    percentSaved: number;
  };
  notes: string[];
};

function estimateTokens(text: string): number {
  // Cross-model approximation used for quick CLI benchmarking.
  return Math.ceil(text.length / 4);
}

async function readIfExists(filePath: string): Promise<{ exists: boolean; content: string }> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return { exists: true, content };
  } catch {
    return { exists: false, content: "" };
  }
}

export async function runTokenBenchmark(rootDir: string): Promise<TokenBenchmarkResult> {
  const paths = getContextPaths(rootDir);

  const baselineTargets = [
    paths.memoryPath,
    paths.preferencesPath,
    paths.decisionsPath,
    paths.workflowsPath,
    paths.projectMapPath,
    paths.minimalContextPath
  ];

  const baselineFiles: BenchmarkFileStat[] = [];
  let baselineChars = 0;

  for (const filePath of baselineTargets) {
    const loaded = await readIfExists(filePath);
    const chars = loaded.content.length;
    const estimatedTokens = estimateTokens(loaded.content);
    baselineChars += chars;

    baselineFiles.push({
      file: path.relative(rootDir, filePath).replace(/\\/g, "/"),
      exists: loaded.exists,
      chars,
      estimatedTokens
    });
  }

  const optimizedLoaded = await readIfExists(paths.aiContextPath);
  const optimizedChars = optimizedLoaded.content.length;
  const optimizedTokens = estimateTokens(optimizedLoaded.content);

  const charsSaved = baselineChars - optimizedChars;
  const baselineTokens = baselineFiles.reduce((sum, file) => sum + file.estimatedTokens, 0);
  const tokensSaved = baselineTokens - optimizedTokens;
  const percentSaved = baselineTokens > 0 ? Number(((tokensSaved / baselineTokens) * 100).toFixed(2)) : 0;

  const notes = [
    "Estimated tokens are computed using chars / 4 and are model-agnostic approximations.",
    "Use this for relative A/B comparisons before and after sync changes."
  ];

  if (!optimizedLoaded.exists) {
    notes.push("ai-context.md was not found. Run `awesome-context-engine sync` before benchmarking.");
  }

  return {
    generatedAt: new Date().toISOString(),
    baseline: {
      chars: baselineChars,
      estimatedTokens: baselineTokens,
      files: baselineFiles
    },
    optimized: {
      chars: optimizedChars,
      estimatedTokens: optimizedTokens,
      file: path.relative(rootDir, paths.aiContextPath).replace(/\\/g, "/")
    },
    delta: {
      charsSaved,
      tokensSaved,
      percentSaved
    },
    notes
  };
}
