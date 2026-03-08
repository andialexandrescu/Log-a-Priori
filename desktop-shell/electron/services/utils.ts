import { spawn, type ChildProcess, type SpawnOptionsWithoutStdio } from "node:child_process";

export interface SpawnedProcess {
  child: ChildProcess;
  command: string;
  args: string[];
}

export function spawnProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
): SpawnedProcess {
  const child = spawn(command, args, {
    windowsHide: true,
    ...options
  });

  return { child, command, args };
}

export function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 0));
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForService(
  url: string,
  name: string,
  timeoutMs = 90_000,
  intervalMs = 2_000
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch {
    }

    await delay(intervalMs);
  }

  throw new Error(`${name} is not reachable at ${url} after ${timeoutMs}ms`);
}

export function nowIso(): string {
  return new Date().toISOString();
}
