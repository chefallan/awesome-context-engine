import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CopilotReadiness =
  | { state: "ready"; token: string }
  | { state: "needs-login" }
  | { state: "unavailable" };

export type CopilotResult =
  | { ok: true; action: string; highlights: string[] }
  | { ok: false; reason: "no-subscription" | "api-error" | "parse-error" };

const COMMIT_PROMPT = (fileList: string, diff: string) =>
  `Changed files:
${fileList}

Diff:
${diff}

Write a git commit message. Respond using ONLY these exact JSON keys:
{
  "action": "<4-8 word verb phrase starting with a verb, e.g. 'add copilot AI commit generation'>",
  "highlights": ["<specific change 1>", "<specific change 2>"]
}

Rules: action starts with a verb. highlights name actual files or features. 2-4 highlights. No other keys.`;

export async function checkGhCopilotReadiness(): Promise<CopilotReadiness> {
  const ghAvailable = await isGhCliAvailable();
  if (!ghAvailable) {
    return { state: "unavailable" };
  }

  const token = await getGhAuthToken();
  if (!token) {
    return { state: "needs-login" };
  }

  return { state: "ready", token };
}

export async function loginWithGh(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("gh", ["auth", "login", "--web", "--git-protocol", "https"], {
      stdio: "inherit",
      shell: false
    });

    child.on("close", async () => {
      resolve(await getGhAuthToken());
    });

    child.on("error", () => {
      resolve(null);
    });
  });
}

export async function generateWithGitHubCopilot(
  files: string[],
  diffText: string,
  githubToken: string
): Promise<CopilotResult> {
  const truncatedDiff = diffText.length > 5000 ? `${diffText.slice(0, 5000)}\n...[diff truncated]` : diffText;
  const prompt = COMMIT_PROMPT(files.slice(0, 40).join("\n"), truncatedDiff);

  // Try GitHub Models API first — direct Bearer auth, no token exchange required
  const modelsResult = await tryGitHubModels(githubToken, prompt);
  if (modelsResult !== null) {
    return modelsResult;
  }

  // Fall back to Copilot internal API (requires Copilot subscription)
  const copilotToken = await exchangeForCopilotToken(githubToken);
  if (!copilotToken) {
    return { ok: false, reason: "no-subscription" };
  }

  return tryCopilotApi(copilotToken, prompt);
}

export async function callGitHubModels(githubToken: string, prompt: string, maxTokens = 600): Promise<string | null> {
  try {
    const response = await fetch("https://models.inference.ai.azure.com/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${githubToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You output only valid JSON. No markdown, no explanation, no prose. Just the JSON object."
          },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) return null;

    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

async function tryGitHubModels(githubToken: string, prompt: string): Promise<CopilotResult | null> {
  try {
    const response = await fetch("https://models.inference.ai.azure.com/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${githubToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You output only valid JSON. No markdown, no explanation, no prose. Just the JSON object."
          },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      return null;
    }

    return parseCompletionResponse(await response.json());
  } catch {
    return null;
  }
}

async function tryCopilotApi(copilotToken: string, prompt: string): Promise<CopilotResult> {
  try {
    const response = await fetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${copilotToken}`,
        "Content-Type": "application/json",
        "Editor-Version": "vscode/1.85.0",
        "Copilot-Integration-Id": "vscode-chat"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You output only valid JSON. No markdown, no explanation, no prose. Just the JSON object."
          },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      return { ok: false, reason: "api-error" };
    }

    return parseCompletionResponse(await response.json());
  } catch {
    return { ok: false, reason: "api-error" };
  }
}

function parseCompletionResponse(json: unknown): CopilotResult {
  const content = (json as { choices?: Array<{ message?: { content?: string } }> })
    .choices?.[0]?.message?.content?.trim() ?? "";

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { ok: false, reason: "parse-error" };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { action?: unknown; highlights?: unknown };
    if (
      typeof parsed.action === "string" &&
      Array.isArray(parsed.highlights) &&
      parsed.highlights.every((h) => typeof h === "string")
    ) {
      return { ok: true, action: parsed.action, highlights: parsed.highlights as string[] };
    }
  } catch {
    // fall through
  }

  return { ok: false, reason: "parse-error" };
}

async function isGhCliAvailable(): Promise<boolean> {
  try {
    await execFileAsync("gh", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function getGhAuthToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"]);
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

async function exchangeForCopilotToken(githubToken: string): Promise<string | null> {
  try {
    const response = await fetch("https://api.github.com/copilot_internal/v2/token", {
      headers: {
        "Authorization": `token ${githubToken}`,
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      return null;
    }

    const json = await response.json() as { token?: string };
    return json.token ?? null;
  } catch {
    return null;
  }
}
