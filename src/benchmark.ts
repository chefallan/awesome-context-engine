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
  sweBenchInspired: {
    estimated: true;
    framework: string;
    scenarios: Array<{
      id: string;
      model: string;
      assistant: string;
      repoTaskType: string;
      contextSize: "small" | "medium" | "large";
      comparison: {
        withoutAce: {
          estimatedTokens: number;
          estimatedCostUsd: number;
        };
        withAce: {
          estimatedTokens: number;
          estimatedCostUsd: number;
        };
        delta: {
          estimatedTokensSaved: number;
          estimatedPercentSaved: number;
          estimatedCostSavedUsd: number;
          relevanceImprovement: "higher" | "similar";
          estimatedTaskCompletionDeltaPercentRange: string;
        };
      };
      notes: string[];
    }>;
  };
  notes: string[];
};

export type BenchmarkEvalScenario = {
  id: string;
  model: string;
  assistant: string;
  repoTaskType: string;
  contextSize: "small" | "medium" | "large";
  contextMultiplier?: number;
  measured?: {
    withoutAceTokens?: number;
    withAceTokens?: number;
    withoutAceCostUsd?: number;
    withAceCostUsd?: number;
    relevanceWithoutAceScore?: number;
    relevanceWithAceScore?: number;
    withoutAceSuccessRate?: number;
    withAceSuccessRate?: number;
  };
  notes?: string[];
};

export type BenchmarkEvalManifest = {
  version: 1;
  generatedAt: string;
  scenarios: BenchmarkEvalScenario[];
};

export type BenchmarkEvalScenarioResult = {
  id: string;
  model: string;
  assistant: string;
  repoTaskType: string;
  contextSize: "small" | "medium" | "large";
  source: "measured" | "estimated";
  comparison: {
    withoutAce: {
      estimatedTokens: number;
      estimatedCostUsd: number;
    };
    withAce: {
      estimatedTokens: number;
      estimatedCostUsd: number;
    };
    delta: {
      estimatedTokensSaved: number;
      estimatedPercentSaved: number;
      estimatedCostSavedUsd: number;
      relevanceImprovement: "higher" | "similar" | "lower";
      taskCompletion: {
        measurable: boolean;
        measuredDeltaPercent?: number;
        estimatedDeltaRange?: string;
      };
    };
  };
  notes: string[];
};

export type BenchmarkEvalResult = {
  generatedAt: string;
  manifestPath: string;
  outputPath: string;
  summary: {
    totalScenarios: number;
    measuredScenarios: number;
    estimatedScenarios: number;
    averageEstimatedTokenReductionPercent: number;
    averageEstimatedCostSavedUsd: number;
  };
  scenarios: BenchmarkEvalScenarioResult[];
  notes: string[];
};

type ModelProfile = {
  name: string;
  tokenMultiplier: number;
  estimatedInputCostPer1kUsd: number;
};

type ScenarioBlueprint = {
  id: string;
  model: string;
  assistant: string;
  repoTaskType: string;
  contextSize: "small" | "medium" | "large";
  contextMultiplier: number;
  emphasis: string;
};

const MODEL_PROFILES: ModelProfile[] = [
  { name: "GPT-5", tokenMultiplier: 1.0, estimatedInputCostPer1kUsd: 0.005 },
  { name: "Claude Sonnet 4", tokenMultiplier: 1.03, estimatedInputCostPer1kUsd: 0.0045 },
  { name: "Gemini 2.5 Pro", tokenMultiplier: 0.98, estimatedInputCostPer1kUsd: 0.0035 },
  { name: "o3", tokenMultiplier: 1.07, estimatedInputCostPer1kUsd: 0.01 },
  { name: "GPT-4.1", tokenMultiplier: 1.05, estimatedInputCostPer1kUsd: 0.006 }
];

const SCENARIO_BLUEPRINTS: ScenarioBlueprint[] = [
  {
    id: "api-bugfix-triage",
    model: "GPT-5",
    assistant: "VS Code Copilot Chat",
    repoTaskType: "TypeScript SaaS monorepo / API bugfix",
    contextSize: "large",
    contextMultiplier: 1.8,
    emphasis: "dependency-aware file targeting"
  },
  {
    id: "auth-refactor",
    model: "Claude Sonnet 4",
    assistant: "VS Code Copilot Chat",
    repoTaskType: "Node service repo / auth refactor",
    contextSize: "medium",
    contextMultiplier: 1.2,
    emphasis: "decision and constraints recall"
  },
  {
    id: "ui-regression-fix",
    model: "Gemini 2.5 Pro",
    assistant: "VS Code Copilot Chat",
    repoTaskType: "React frontend / UI regression",
    contextSize: "medium",
    contextMultiplier: 1.1,
    emphasis: "focused file context packs"
  },
  {
    id: "release-pipeline-edit",
    model: "o3",
    assistant: "VS Code Copilot Chat",
    repoTaskType: "DevOps-heavy repo / release pipeline edit",
    contextSize: "small",
    contextMultiplier: 0.75,
    emphasis: "workflow-specific command guidance"
  },
  {
    id: "docs-code-alignment",
    model: "GPT-4.1",
    assistant: "VS Code Copilot Chat",
    repoTaskType: "Polyglot repo / docs + code alignment",
    contextSize: "small",
    contextMultiplier: 0.65,
    emphasis: "memory and stale-context pruning"
  }
];

type BenchmarkEvalPaths = {
  benchmarkDir: string;
  manifestPath: string;
  outputPath: string;
};

function estimateTokens(text: string): number {
  // Cross-model approximation used for quick CLI benchmarking.
  return Math.ceil(text.length / 4);
}

function estimateCostUsd(tokens: number, inputCostPer1kUsd: number): number {
  return Number(((tokens / 1000) * inputCostPer1kUsd).toFixed(4));
}

function estimateTaskCompletionDeltaRange(percentSaved: number): string {
  if (percentSaved >= 45) {
    return "6-12% (estimated)";
  }
  if (percentSaved >= 30) {
    return "3-8% (estimated)";
  }
  if (percentSaved >= 15) {
    return "1-5% (estimated)";
  }
  return "0-3% (estimated)";
}

function buildSweBenchInspiredScenarios(baseTokens: number, optimizedTokens: number): TokenBenchmarkResult["sweBenchInspired"]["scenarios"] {
  return SCENARIO_BLUEPRINTS.map((scenario) => {
    const model = MODEL_PROFILES.find((entry) => entry.name === scenario.model) ?? MODEL_PROFILES[0];

    const withoutAce = Math.max(1, Math.round(baseTokens * scenario.contextMultiplier * model.tokenMultiplier));
    const withAce = Math.max(1, Math.round(optimizedTokens * scenario.contextMultiplier * model.tokenMultiplier));
    const saved = withoutAce - withAce;
    const percentSaved = withoutAce > 0 ? Number(((saved / withoutAce) * 100).toFixed(2)) : 0;

    const withoutAceCost = estimateCostUsd(withoutAce, model.estimatedInputCostPer1kUsd);
    const withAceCost = estimateCostUsd(withAce, model.estimatedInputCostPer1kUsd);
    const savedCost = Number((withoutAceCost - withAceCost).toFixed(4));

    return {
      id: scenario.id,
      model: scenario.model,
      assistant: scenario.assistant,
      repoTaskType: scenario.repoTaskType,
      contextSize: scenario.contextSize,
      comparison: {
        withoutAce: {
          estimatedTokens: withoutAce,
          estimatedCostUsd: withoutAceCost
        },
        withAce: {
          estimatedTokens: withAce,
          estimatedCostUsd: withAceCost
        },
        delta: {
          estimatedTokensSaved: saved,
          estimatedPercentSaved: percentSaved,
          estimatedCostSavedUsd: savedCost,
          relevanceImprovement: saved > 0 ? "higher" : "similar",
          estimatedTaskCompletionDeltaPercentRange: estimateTaskCompletionDeltaRange(percentSaved)
        }
      },
      notes: [
        `Estimated scenario using local repo baseline scaled to a ${scenario.contextSize} context profile.`,
        `Quality emphasis: ${scenario.emphasis}.`,
        "Task completion deltas are scenario estimates, not measured pass-rate claims."
      ]
    };
  });
}

function getBenchmarkEvalPaths(rootDir: string): BenchmarkEvalPaths {
  const contextDir = getContextPaths(rootDir).contextDir;
  const benchmarkDir = path.join(contextDir, "benchmark");
  return {
    benchmarkDir,
    manifestPath: path.join(benchmarkDir, "eval-scenarios.json"),
    outputPath: path.join(benchmarkDir, "eval-results.json")
  };
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildDefaultEvalManifest(): BenchmarkEvalManifest {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    scenarios: SCENARIO_BLUEPRINTS.map((scenario) => ({
      id: scenario.id,
      model: scenario.model,
      assistant: scenario.assistant,
      repoTaskType: scenario.repoTaskType,
      contextSize: scenario.contextSize,
      contextMultiplier: scenario.contextMultiplier,
      notes: [
        "Optional: add measured token/cost/relevance/success fields under measured for real run data.",
        "Without measured fields this scenario stays estimated/example."
      ]
    }))
  };
}

async function ensureEvalManifest(rootDir: string): Promise<{ manifest: BenchmarkEvalManifest; manifestPath: string }> {
  const paths = getBenchmarkEvalPaths(rootDir);
  await fs.mkdir(paths.benchmarkDir, { recursive: true });

  const existing = await readJsonIfExists<BenchmarkEvalManifest>(paths.manifestPath);
  if (existing && Array.isArray(existing.scenarios)) {
    return { manifest: existing, manifestPath: paths.manifestPath };
  }

  const manifest = buildDefaultEvalManifest();
  await writeJson(paths.manifestPath, manifest);
  return { manifest, manifestPath: paths.manifestPath };
}

function findModelProfile(name: string): ModelProfile {
  return MODEL_PROFILES.find((profile) => profile.name === name) ?? MODEL_PROFILES[0];
}

function estimateScenarioTokens(
  scenario: BenchmarkEvalScenario,
  baseTokens: number,
  optimizedTokens: number
): { withoutAce: number; withAce: number } {
  const model = findModelProfile(scenario.model);
  const multiplier = scenario.contextMultiplier ?? (scenario.contextSize === "large" ? 1.8 : scenario.contextSize === "medium" ? 1.2 : 0.75);

  const withoutAce = Math.max(1, Math.round(baseTokens * multiplier * model.tokenMultiplier));
  const withAce = Math.max(1, Math.round(optimizedTokens * multiplier * model.tokenMultiplier));
  return { withoutAce, withAce };
}

function clampScore(value: number | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return Math.max(1, Math.min(5, value));
}

function clampRate(value: number | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return Math.max(0, Math.min(1, value));
}

function inferRelevanceImprovement(withoutScore: number | null, withScore: number | null): "higher" | "similar" | "lower" {
  if (withoutScore === null || withScore === null) {
    return "higher";
  }
  if (withScore > withoutScore) return "higher";
  if (withScore < withoutScore) return "lower";
  return "similar";
}

function scenarioFromMeasuredOrEstimated(
  scenario: BenchmarkEvalScenario,
  baseTokens: number,
  optimizedTokens: number
): BenchmarkEvalScenarioResult {
  const model = findModelProfile(scenario.model);
  const estimated = estimateScenarioTokens(scenario, baseTokens, optimizedTokens);

  const measuredWithoutTokens = scenario.measured?.withoutAceTokens;
  const measuredWithTokens = scenario.measured?.withAceTokens;
  const hasMeasuredTokens = typeof measuredWithoutTokens === "number" && typeof measuredWithTokens === "number";

  const withoutTokens = hasMeasuredTokens ? Math.max(1, Math.round(measuredWithoutTokens)) : estimated.withoutAce;
  const withTokens = hasMeasuredTokens ? Math.max(1, Math.round(measuredWithTokens)) : estimated.withAce;

  const withoutCost = typeof scenario.measured?.withoutAceCostUsd === "number"
    ? Number(scenario.measured.withoutAceCostUsd.toFixed(4))
    : estimateCostUsd(withoutTokens, model.estimatedInputCostPer1kUsd);
  const withCost = typeof scenario.measured?.withAceCostUsd === "number"
    ? Number(scenario.measured.withAceCostUsd.toFixed(4))
    : estimateCostUsd(withTokens, model.estimatedInputCostPer1kUsd);

  const tokensSaved = withoutTokens - withTokens;
  const percentSaved = withoutTokens > 0 ? Number(((tokensSaved / withoutTokens) * 100).toFixed(2)) : 0;
  const costSaved = Number((withoutCost - withCost).toFixed(4));

  const withoutScore = clampScore(scenario.measured?.relevanceWithoutAceScore);
  const withScore = clampScore(scenario.measured?.relevanceWithAceScore);
  const relevanceImprovement = inferRelevanceImprovement(withoutScore, withScore);

  const withoutRate = clampRate(scenario.measured?.withoutAceSuccessRate);
  const withRate = clampRate(scenario.measured?.withAceSuccessRate);
  const hasMeasuredSuccess = withoutRate !== null && withRate !== null;
  const measuredDeltaPercent = hasMeasuredSuccess ? Number((((withRate - withoutRate) * 100)).toFixed(2)) : undefined;

  const scenarioNotes = [...(scenario.notes ?? [])];
  if (!hasMeasuredTokens) {
    scenarioNotes.push("Token and cost values are estimated from local baseline scaling.");
  }
  if (!hasMeasuredSuccess) {
    scenarioNotes.push("Task completion delta is estimated, not measured pass-rate data.");
  }

  return {
    id: scenario.id,
    model: scenario.model,
    assistant: scenario.assistant,
    repoTaskType: scenario.repoTaskType,
    contextSize: scenario.contextSize,
    source: hasMeasuredTokens ? "measured" : "estimated",
    comparison: {
      withoutAce: {
        estimatedTokens: withoutTokens,
        estimatedCostUsd: withoutCost
      },
      withAce: {
        estimatedTokens: withTokens,
        estimatedCostUsd: withCost
      },
      delta: {
        estimatedTokensSaved: tokensSaved,
        estimatedPercentSaved: percentSaved,
        estimatedCostSavedUsd: costSaved,
        relevanceImprovement,
        taskCompletion: hasMeasuredSuccess
          ? {
              measurable: true,
              measuredDeltaPercent
            }
          : {
              measurable: false,
              estimatedDeltaRange: estimateTaskCompletionDeltaRange(percentSaved)
            }
      }
    },
    notes: scenarioNotes
  };
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

  const sweBenchInspired = {
    estimated: true as const,
    framework: "SWE-bench-inspired use-case comparison (estimated/example framework)",
    scenarios: buildSweBenchInspiredScenarios(baselineTokens, optimizedTokens)
  };

  const notes = [
    "Estimated tokens are computed using chars / 4 and are model-agnostic approximations.",
    "Use this for relative A/B comparisons before and after sync changes.",
    "SWE-bench-inspired scenario rows are estimated/example comparisons, not official benchmark pass-rate measurements."
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
    sweBenchInspired,
    notes
  };
}

export async function runBenchmarkEval(rootDir: string): Promise<BenchmarkEvalResult> {
  const tokenBenchmark = await runTokenBenchmark(rootDir);
  const { manifest, manifestPath } = await ensureEvalManifest(rootDir);
  const paths = getBenchmarkEvalPaths(rootDir);

  const scenarios = manifest.scenarios.map((scenario) =>
    scenarioFromMeasuredOrEstimated(scenario, tokenBenchmark.baseline.estimatedTokens, tokenBenchmark.optimized.estimatedTokens)
  );

  const measuredScenarios = scenarios.filter((scenario) => scenario.source === "measured").length;
  const estimatedScenarios = scenarios.length - measuredScenarios;

  const avgReduction = scenarios.length > 0
    ? Number((scenarios.reduce((sum, scenario) => sum + scenario.comparison.delta.estimatedPercentSaved, 0) / scenarios.length).toFixed(2))
    : 0;
  const avgCostSaved = scenarios.length > 0
    ? Number((scenarios.reduce((sum, scenario) => sum + scenario.comparison.delta.estimatedCostSavedUsd, 0) / scenarios.length).toFixed(4))
    : 0;

  const result: BenchmarkEvalResult = {
    generatedAt: new Date().toISOString(),
    manifestPath: path.relative(rootDir, manifestPath).replace(/\\/g, "/"),
    outputPath: path.relative(rootDir, paths.outputPath).replace(/\\/g, "/"),
    summary: {
      totalScenarios: scenarios.length,
      measuredScenarios,
      estimatedScenarios,
      averageEstimatedTokenReductionPercent: avgReduction,
      averageEstimatedCostSavedUsd: avgCostSaved
    },
    scenarios,
    notes: [
      "This is a SWE-bench-inspired evaluation framework for repeatable local comparisons.",
      "Scenarios without measured fields are explicitly estimated/example rows.",
      "Populate measured fields in .awesome-context/benchmark/eval-scenarios.json for real model/assistant run data."
    ]
  };

  await writeJson(paths.outputPath, result);
  return result;
}
