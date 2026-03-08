import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

export interface RuntimePaths {
  isPackaged: boolean;
  repoRoot: string;
  workflowAppPath: string;
  functionsProjectPath: string;
  envLocalPath: string;
  functionsSettingsPath: string;
  azureFunctionAppName?: string;
  pocketbaseWorkingDir: string;
  pocketbaseExecutable: string;
  cloudflaredExecutable: string;
  nextCliPath: string;
}

function executableName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

function resolveRepoRoot(): string {
  if (appIsPackaged()) {
    return path.join(process.resourcesPath, "resources");
  }

  return path.resolve(__dirname, "..", "..", "..", "..");
}

function appIsPackaged(): boolean {
  return !!process.resourcesPath && !process.defaultApp;
}

function resolveFromEnvFile(envPath: string, key: string): string | undefined {
  if (!fs.existsSync(envPath)) {
    return undefined;
  }

  const parsed = dotenv.parse(fs.readFileSync(envPath));
  return parsed[key];
}

export function getRuntimePaths(): RuntimePaths { // all relative paths for my setup are defined here
  const isPackaged = appIsPackaged();
  const repoRoot = resolveRepoRoot();
  const workflowAppPath = path.join(repoRoot, "workflow-app");
  const functionsProjectPath = path.join(workflowAppPath, "github-webhook");
  const envLocalPath = path.join(workflowAppPath, ".env.local");
  const functionsSettingsPath = path.join(functionsProjectPath, "local.settings.json");
  const azureFunctionAppName =
    process.env.AZURE_FUNCTION_APP_NAME ?? resolveFromEnvFile(envLocalPath, "AZURE_FUNCTION_APP_NAME");

  const packagedResourcesPath = path.join(process.resourcesPath, "resources");

  const pocketbasePathFromEnv =
    process.env.POCKETBASE_PATH ?? resolveFromEnvFile(envLocalPath, "POCKETBASE_PATH");

  const pocketbaseWorkingDir = isPackaged
    ? path.join(packagedResourcesPath, "pocketbase")
    : pocketbasePathFromEnv ?? "";

  if (!pocketbaseWorkingDir) {
    throw new Error(
      "POCKETBASE_PATH is required in workflow-app/.env.local (or process env) for development mode"
    );
  }

  const pocketbaseExecutable = path.join(pocketbaseWorkingDir, executableName("pocketbase"));

  const cloudflaredExecutable = isPackaged
    ? path.join(packagedResourcesPath, "tunnel", executableName("cloudflared"))
    : process.platform === "win32"
      ? "cloudflared.exe"
      : "cloudflared";

  const nextCliPath = path.join(workflowAppPath, "node_modules", "next", "dist", "bin", "next");

  return {
    isPackaged,
    repoRoot,
    workflowAppPath,
    functionsProjectPath,
    envLocalPath,
    functionsSettingsPath,
    azureFunctionAppName,
    pocketbaseWorkingDir,
    pocketbaseExecutable,
    cloudflaredExecutable,
    nextCliPath
  };
}
