import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { delay, waitForExit } from "./utils";
import type { RuntimePaths } from "./paths";
import type { TunnelUrls } from "../types";

const CLOUDFLARE_URL_REGEX = /https:\/\/[a-zA-Z0-9_-]+\.trycloudflare\.com/;

function updateEnvVar(filePath: string, key: string, value: string): void {
  const newLine = `${key}=${value}`;
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";

  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
  let updated: string;
  if (pattern.test(current)) {
    updated = current.replace(pattern, newLine);
  } else {
    const separator = current.endsWith("\n") || current.length === 0 ? "" : "\n";
    updated = `${current}${separator}${newLine}\n`;
  }

  fs.writeFileSync(filePath, updated, "utf8");
}

function updateJsonValues(filePath: string, updates: Record<string, string>): void {
  const raw = fs.readFileSync(filePath, "utf8");
  const json = parseSettingsJson(raw, filePath);
  if (!json.Values) {
    json.Values = {};
  }

  for (const [key, value] of Object.entries(updates)) {
    json.Values[key] = value;
  }

  fs.writeFileSync(filePath, JSON.stringify(json, null, 2), "utf8");
}

function parseSettingsJson(raw: string, filePath: string): { Values?: Record<string, string> } {
  const candidates = buildJsonCandidates(raw);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as { Values?: Record<string, string> };
    } catch {
    }
  }

  const preview = raw.slice(0, 120).replace(/\r?\n/g, "\\n");
  throw new Error(`Invalid JSON in ${filePath}. Preview: ${preview}`);
}

function buildJsonCandidates(raw: string): string[] {
  const cleaned = raw.replace(/^\uFEFF/, "").trim();
  const compact = stripJsonCommentsAndTrailingCommas(cleaned);

  const candidates: string[] = [cleaned, compact];

  const firstBrace = compact.indexOf("{");
  const lastBrace = compact.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(compact.slice(firstBrace, lastBrace + 1));
  }

  return candidates;
}

function stripJsonCommentsAndTrailingCommas(input: string): string {
  const withoutBlockComments = input.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, "");
  return withoutLineComments.replace(/,(\s*[}\]])/g, "$1").trim();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function startTunnelProcess(
  cloudflaredExecutable: string,
  localUrl: string,
  logPrefix: string
): { child: ChildProcess; stdoutLogPath: string; stderrLogPath: string } {
  const stdoutLogPath = path.join(os.tmpdir(), `${logPrefix}.log`);
  const stderrLogPath = path.join(os.tmpdir(), `${logPrefix}.err.log`);

  const child = spawn(cloudflaredExecutable, ["tunnel", "--url", localUrl], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdoutWriter = fs.createWriteStream(stdoutLogPath, { flags: "w" });
  const stderrWriter = fs.createWriteStream(stderrLogPath, { flags: "w" });

  child.stdout?.pipe(stdoutWriter);
  child.stderr?.pipe(stderrWriter);

  return { child, stdoutLogPath, stderrLogPath };
}

function extractTunnelUrl(logPaths: string[]): string | undefined {
  for (const logPath of logPaths) {
    if (!fs.existsSync(logPath)) {
      continue;
    }

    const content = fs.readFileSync(logPath, "utf8");
    const match = content.match(CLOUDFLARE_URL_REGEX);
    if (match?.[0]) {
      return match[0];
    }
  }

  return undefined;
}

async function publishFunctionSettings(functionsProjectPath: string, functionAppName: string): Promise<void> {
  const publishArgs = [
    "azure",
    "functionapp",
    "publish",
    functionAppName,
    "--publish-settings-only",
    "--overwrite-settings"
  ];

  const funcCommand = resolveFuncCommand(functionsProjectPath);

  const publisher = spawn(funcCommand, publishArgs, {
    cwd: functionsProjectPath,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32"
  });

  publisher.stdout?.on("data", (data) => {
    process.stdout.write(`[func publish] ${data}`);
  });

  publisher.stderr?.on("data", (data) => {
    process.stderr.write(`[func publish err] ${data}`);
  });

  let code: number;
  try {
    code = await waitForExit(publisher);
  } catch (error) {
    if (isEnoentError(error)) {
      throw new Error("func command not found");
    }
    if (isEinvalError(error)) {
      throw new Error("Invalid process launch arguments for func");
    }
    throw error;
  }

  if (code !== 0) {
    throw new Error(`Azure settings publish failed with exit code ${code}`);
  }
}

function resolveFuncCommand(functionsProjectPath: string): string {
  const explicitPath = sanitizeEnvPath(process.env.FUNC_CLI_PATH);
  if (explicitPath && fs.existsSync(explicitPath)) {
    return explicitPath;
  }

  const localBin = process.platform === "win32"
    ? path.join(functionsProjectPath, "node_modules", ".bin", "func.cmd")
    : path.join(functionsProjectPath, "node_modules", ".bin", "func");

  if (fs.existsSync(localBin)) {
    return localBin;
  }

  return process.platform === "win32" ? "func.cmd" : "func";
}

function isEnoentError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybe = error as { code?: string };
  return maybe.code === "ENOENT";
}

function isEinvalError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybe = error as { code?: string };
  return maybe.code === "EINVAL";
}

function sanitizeEnvPath(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const cleaned = value.trim().replace(/^"|"$/g, "");
  return cleaned.length > 0 ? cleaned : undefined;
}

export async function updateTunnelsAndSettings(
  runtimePaths: RuntimePaths,
  nextLocalUrl: string,
  pocketbaseLocalUrl: string
): Promise<{
  tunnelUrls: TunnelUrls;
  nextTunnelProcess: ChildProcess;
  pocketbaseTunnelProcess: ChildProcess;
}> {
  const functionAppName = runtimePaths.azureFunctionAppName?.trim();
  if (!functionAppName) {
    throw new Error("AZURE_FUNCTION_APP_NAME is required in workflow-app/.env.local or process env");
  }

  const nextTunnel = startTunnelProcess(runtimePaths.cloudflaredExecutable, nextLocalUrl, "log_a_priori_tunnel_next");
  const pocketbaseTunnel = startTunnelProcess(
    runtimePaths.cloudflaredExecutable,
    pocketbaseLocalUrl,
    "log_a_priori_tunnel_pocketbase"
  );

  await delay(15_000);

  const nextPublicUrl = extractTunnelUrl([nextTunnel.stdoutLogPath, nextTunnel.stderrLogPath]);
  const pocketbasePublicUrl = extractTunnelUrl([
    pocketbaseTunnel.stdoutLogPath,
    pocketbaseTunnel.stderrLogPath
  ]);

  if (!nextPublicUrl || !pocketbasePublicUrl) {
    nextTunnel.child.kill();
    pocketbaseTunnel.child.kill();
    throw new Error("Failed to get urls");
  }

  updateJsonValues(runtimePaths.functionsSettingsPath, {
    BACKEND_BASE_URL: nextPublicUrl,
    POCKETBASE_URL: pocketbasePublicUrl
  });

  updateEnvVar(runtimePaths.envLocalPath, "POCKETBASE_URL", pocketbasePublicUrl);

  await publishFunctionSettings(runtimePaths.functionsProjectPath, functionAppName);

  return {
    tunnelUrls: { nextPublicUrl, pocketbasePublicUrl },
    nextTunnelProcess: nextTunnel.child,
    pocketbaseTunnelProcess: pocketbaseTunnel.child
  };
}
