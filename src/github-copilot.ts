import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CopilotReadiness =
  | { state: "ready"; token: string }
  | { state: "needs-login" }
  | { state: "unavailable" };

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
  try {
    await execFileAsync("gh", ["auth", "login", "--web", "--git-protocol", "https"], {
      stdio: "inherit"
    } as Parameters<typeof execFileAsync>[2]);
    return getGhAuthToken();
  } catch {
    return null;
  }
}

export async function generateWithGitHubCopilot(
  files: string[],
  diffText: string,
  githubToken: string
): Promise<{ action: string; highlights: string[] } | null> {
  const copilotToken = await exchangeForCopilotToken(githubToken);
  if (!copilotToken) {
    return null;
  }

  const truncatedDiff = diffText.length > 8000 ? `${diffText.slice(0, 8000)}\n...[diff truncated]` : diffText;
  const fileList = files.slice(0, 40).join("\n");

  const prompt = `You are writing a git commit message for a change set.

Changed files:
${fileList}

Diff:
${truncatedDiff}

Respond with JSON only — no markdown, no explanation:
{
  "action": "<4-8 word verb phrase, e.g. 'add awesome-context metadata and UI tweaks'>",
  "highlights": [
    "<specific bullet: what was added/changed/removed>",
    "<specific bullet: another key change>"
  ]
}

Rules:
- action starts with a verb (add, fix, update, refactor, remove, etc.)
- highlights name actual files, components, or features — be specific
- 2-4 highlights maximum
- do NOT use phrases like "this work", "repository-level updates", or "delivery summary"`;

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
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      return null;
    }

    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as { action?: unknown; highlights?: unknown };
    if (
      typeof parsed.action === "string" &&
      Array.isArray(parsed.highlights) &&
      parsed.highlights.every((h) => typeof h === "string")
    ) {
      return { action: parsed.action, highlights: parsed.highlights as string[] };
    }

    return null;
  } catch {
    return null;
  }
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
