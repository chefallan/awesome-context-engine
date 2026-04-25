import type { SecretMatchSummary } from "./redact.js";

export class StrictModeViolationError extends Error {
  readonly findings: SecretMatchSummary[];

  constructor(message: string, findings: SecretMatchSummary[]) {
    super(message);
    this.name = "StrictModeViolationError";
    this.findings = findings;
  }
}

export function isStrictModeViolationError(error: unknown): error is StrictModeViolationError {
  return error instanceof StrictModeViolationError;
}

export function getExitCodeForError(error: unknown): number {
  return isStrictModeViolationError(error) ? 2 : 1;
}
