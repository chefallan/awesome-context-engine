import { confirm } from "@inquirer/prompts";
import pc from "picocolors";

export function heading(message: string): void {
  console.log(pc.cyan(message));
}

export function info(message: string): void {
  console.log(message);
}

export function secondary(message: string): void {
  console.log(pc.dim(message));
}

export function success(message: string): void {
  console.log(pc.green(`✓ ${message}`));
}

export function warning(message: string): void {
  console.log(pc.yellow(message));
}

export function error(message: string): void {
  console.error(pc.red(message));
}

export async function confirmPrompt(message: string, defaultValue = true, skipPrompt = false): Promise<boolean> {
  if (skipPrompt) {
    return defaultValue;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  return confirm({
    message,
    default: defaultValue
  });
}
