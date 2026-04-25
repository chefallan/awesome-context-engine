type SecretPattern = {
  name: string;
  pattern: RegExp;
};

export type SecretMatchSummary = {
  name: string;
  count: number;
};

const SECRET_PATTERNS: SecretPattern[] = [
  { name: "aws-access-key", pattern: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: "github-token-classic", pattern: /\bghp_[A-Za-z0-9]{36}\b/g },
  { name: "github-token-oauth", pattern: /\bgho_[A-Za-z0-9]{36}\b/g },
  { name: "github-token-user", pattern: /\bghu_[A-Za-z0-9]{36}\b/g },
  { name: "github-token-server", pattern: /\bghs_[A-Za-z0-9]{36}\b/g },
  { name: "github-token-refresh", pattern: /\bghr_[A-Za-z0-9]{36}\b/g },
  { name: "slack-token-common", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "openai-style-key", pattern: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "google-api-key", pattern: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { name: "slack-token-generic", pattern: /\bxox[a-z]-[A-Za-z0-9-]{10,}\b/g },
  { name: "jwt-token", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "authorization-header", pattern: /\b(?:authorization|bearer)\s+[A-Za-z0-9._\-]{16,}\b/gi },
  { name: "secret-assignment-quoted", pattern: /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["'][^"']+["']/gi },
  { name: "secret-assignment", pattern: /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s"']+/gi },
  { name: "database-uri", pattern: /\b(?:postgres(?:ql)?:\/\/|mysql:\/\/|mongodb(?:\+srv)?:\/\/)[^\s"']+/gi }
];

export function detectSensitiveMatches(input: string): SecretMatchSummary[] {
  const findings: SecretMatchSummary[] = [];

  for (const item of SECRET_PATTERNS) {
    const matches = input.match(item.pattern);
    if (!matches || matches.length === 0) {
      continue;
    }

    findings.push({ name: item.name, count: matches.length });
  }

  return findings;
}

export function redactSensitive(input: string): string {
  let output = input;

  for (const item of SECRET_PATTERNS) {
    output = output.replace(item.pattern, "[REDACTED]");
  }

  return output;
}
