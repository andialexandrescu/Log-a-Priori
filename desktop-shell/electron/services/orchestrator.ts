import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { getRuntimePaths, type RuntimePaths } from "./paths";
import { nowIso, spawnProcess, waitForExit, waitForService } from "./utils";
import { updateTunnelsAndSettings } from "./tunnel-updater";
import type { ManagedService, ServiceStatus, ServiceState } from "../types";

interface ProcessRecord {
  service: ManagedService;
  child: ChildProcess;
  autoRestart: boolean;
  command: string;
  args: string[];
}

interface StartResult {
  nextUrl: string;
  pocketbaseUrl: string;
  nextPublicUrl: string;
  pocketbasePublicUrl: string;
}

function normalizeLogOutput(chunk: unknown): string {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk ?? "");

  return text
    .replace(/\r\n/g, "\n")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ""); // keep logs readable in terminal without unicode glyphs
}

export class AppOrchestrator {
  private readonly runtimePaths: RuntimePaths;
  private readonly azCommand: string;
  private readonly processMap = new Map<ManagedService, ProcessRecord>();
  private readonly statusMap = new Map<ManagedService, ServiceStatus>();
  private readonly statusListeners = new Set<(status: ServiceStatus) => void>();
  private started = false;
  private shuttingDown = false;

  constructor() {
    this.runtimePaths = getRuntimePaths();
    this.azCommand = this.resolveAzCommand();
    this.seedStatus();
  }

  onStatus(listener: (status: ServiceStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  getStatuses(): ServiceStatus[] {
    return Array.from(this.statusMap.values());
  }

  async startAll(): Promise<StartResult> {
    if (this.started) {
      const nextPublicUrl = this.statusMap.get("tunnel-next")?.detail ?? "";
      const pocketbasePublicUrl = this.statusMap.get("tunnel-pocketbase")?.detail ?? "";
      return {
        nextUrl: "http://127.0.0.1:3000",
        pocketbaseUrl: "http://127.0.0.1:8090",
        nextPublicUrl,
        pocketbasePublicUrl
      };
    }

    this.setStatus("pocketbase", "starting", "Starting PocketBase (pocketbase.exe serve)");
    this.startPocketBase();

    this.setStatus("next", "starting", "Starting Next.js on port 3000 (npm run dev)");
    this.startNext();

    const nextUrl = "http://127.0.0.1:3000";
    const pocketbaseUrl = "http://127.0.0.1:8090";

    await waitForService(pocketbaseUrl, "PocketBase");
    this.setStatus("pocketbase", "running", pocketbaseUrl, this.getPid("pocketbase"));

    await waitForService(nextUrl, "Next.js");
    this.setStatus("next", "running", nextUrl, this.getPid("next"));

    this.setStatus("tunnel-update", "starting", "Starting update-tunnels.ps1");
    const tunnelResult = await updateTunnelsAndSettings(this.runtimePaths, nextUrl, pocketbaseUrl);

    this.attachManagedProcess({
      service: "tunnel-next",
      child: tunnelResult.nextTunnelProcess,
      autoRestart: true,
      command: this.runtimePaths.cloudflaredExecutable,
      args: ["tunnel", "--url", nextUrl]
    });

    this.attachManagedProcess({
      service: "tunnel-pocketbase",
      child: tunnelResult.pocketbaseTunnelProcess,
      autoRestart: true,
      command: this.runtimePaths.cloudflaredExecutable,
      args: ["tunnel", "--url", pocketbaseUrl]
    });

    this.setStatus("tunnel-next", "running", tunnelResult.tunnelUrls.nextPublicUrl, this.getPid("tunnel-next"));
    this.setStatus(
      "tunnel-pocketbase",
      "running",
      tunnelResult.tunnelUrls.pocketbasePublicUrl,
      this.getPid("tunnel-pocketbase")
    );
    this.setStatus("tunnel-update", "running", "The updated-tunnels.ps1 script finished running all tunnels");

    this.setStatus("azure-function", "starting", "Starting Azure Function App in cloud");
    await this.startAzureFunctionApp();
    this.setStatus("azure-function", "running", "Azure Function App is running");

    this.started = true;

    return {
      nextUrl,
      pocketbaseUrl,
      nextPublicUrl: tunnelResult.tunnelUrls.nextPublicUrl,
      pocketbasePublicUrl: tunnelResult.tunnelUrls.pocketbasePublicUrl
    };
  }

  async stopAll(): Promise<void> {
    this.shuttingDown = true;

    for (const processRecord of this.processMap.values()) {
      processRecord.child.kill();
    }
    this.processMap.clear();

    this.setStatus("pocketbase", "stopped", "Stopped");
    this.setStatus("next", "stopped", "Stopped");
    this.setStatus("tunnel-next", "stopped", "Stopped");
    this.setStatus("tunnel-pocketbase", "stopped", "Stopped");
    this.setStatus("tunnel-update", "stopped", "Stopped");

    try {
      this.setStatus("azure-function", "starting", "Stopping Azure Function App in cloud");
      await this.stopAzureFunctionApp();
      this.setStatus("azure-function", "stopped", "Azure Function App stopped");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus("azure-function", "error", message);
    }

    this.started = false;
    this.shuttingDown = false;
  }

  private seedStatus(): void {
    const services: ManagedService[] = [
      "pocketbase",
      "next",
      "tunnel-next",
      "tunnel-pocketbase",
      "tunnel-update",
      "azure-function"
    ];

    for (const service of services) {
      this.setStatus(service, "idle", "Waiting");
    }
  }

  private setStatus(service: ManagedService, state: ServiceState, detail?: string, pid?: number): void {
    const status: ServiceStatus = {
      service,
      state,
      detail,
      pid,
      updatedAt: nowIso()
    };

    const detailText = detail ? ` ${detail}` : "";
    const pidText = pid ? ` pid=${pid}` : "";
    process.stdout.write(`[status] ${service}| ${state}${pidText}:${detailText}\n`);

    this.statusMap.set(service, status);
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private getPid(service: ManagedService): number | undefined {
    return this.processMap.get(service)?.child.pid;
  }

  private startPocketBase(): void {
    const spawned = spawnProcess(this.runtimePaths.pocketbaseExecutable, ["serve"], {
      cwd: this.runtimePaths.pocketbaseWorkingDir,
      env: process.env
    });

    this.attachManagedProcess({
      service: "pocketbase",
      child: spawned.child,
      autoRestart: true,
      command: spawned.command,
      args: spawned.args
    });

    spawned.child.stdout?.on("data", (data) => {
      process.stdout.write(`[pocketbase] ${normalizeLogOutput(data)}`);
    });

    spawned.child.stderr?.on("data", (data) => {
      process.stderr.write(`[pocketbase err] ${normalizeLogOutput(data)}`);
    });
  }

  private startNext(): void {
    const nextPort = "3000";
    const nextMode = this.runtimePaths.isPackaged ? "start" : "dev";
    const args = [this.runtimePaths.nextCliPath, nextMode, "-p", nextPort];
    const spawned = spawnProcess("node", args, {
      cwd: this.runtimePaths.workflowAppPath,
      env: {
        ...process.env,
        PORT: nextPort
      }
    });

    this.attachManagedProcess({
      service: "next",
      child: spawned.child,
      autoRestart: true,
      command: spawned.command,
      args: spawned.args
    });

    spawned.child.stdout?.on("data", (data) => {
      process.stdout.write(`[next] ${normalizeLogOutput(data)}`);
    });

    spawned.child.stderr?.on("data", (data) => {
      process.stderr.write(`[next err] ${normalizeLogOutput(data)}`);
    });
  }

  private attachManagedProcess(processRecord: ProcessRecord): void {
    this.processMap.set(processRecord.service, processRecord);

    processRecord.child.once("exit", (code, signal) => {
      if (this.shuttingDown) {
        return;
      }

      this.setStatus(
        processRecord.service,
        "error",
        `${processRecord.service} exited (code=${code ?? "n/a"}, signal=${signal ?? "n/a"})`
      );

      if (processRecord.autoRestart) {
        this.restartProcess(processRecord).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.setStatus(processRecord.service, "error", `Restart failed: ${message}`);
        });
      }
    });
  }

  private async restartProcess(processRecord: ProcessRecord): Promise<void> {
    this.setStatus(processRecord.service, "starting", "Process crashed. Restarting...");

    const restarted = spawn(processRecord.command, processRecord.args, {
      cwd: this.resolveCwdForService(processRecord.service),
      windowsHide: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    restarted.stdout?.on("data", (data) => {
      process.stdout.write(`[${processRecord.service}] ${normalizeLogOutput(data)}`);
    });

    restarted.stderr?.on("data", (data) => {
      process.stderr.write(`[${processRecord.service} err] ${normalizeLogOutput(data)}`);
    });

    this.attachManagedProcess({
      ...processRecord,
      child: restarted
    });

    const detail = this.statusMap.get(processRecord.service)?.detail;
    this.setStatus(processRecord.service, "running", detail, restarted.pid);
  }

  private resolveCwdForService(service: ManagedService): string {
    if (service === "pocketbase") {
      return this.runtimePaths.pocketbaseWorkingDir;
    }

    if (service === "next") {
      return this.runtimePaths.workflowAppPath;
    }

    return this.runtimePaths.repoRoot;
  }

  private async startAzureFunctionApp(): Promise<void> {
    const functionAppName = this.getFunctionAppName();
    const resourceGroup = await this.getFunctionResourceGroup();

    const starter = this.spawnAz(["functionapp", "start", "--name", functionAppName, "--resource-group", resourceGroup]);

    starter.stdout?.on("data", (data) => {
      process.stdout.write(`[az start] ${normalizeLogOutput(data)}`);
    });

    starter.stderr?.on("data", (data) => {
      process.stderr.write(`[az start err] ${normalizeLogOutput(data)}`);
    });

    const startCode = await this.waitForAzExit(starter);
    if (startCode !== 0) {
      throw new Error(`Failed to start Azure Function App (exit ${startCode})`);
    }

    for (let index = 0; index < 10; index += 1) {
      const state = await this.getFunctionState(resourceGroup);
      if (state === "Running") {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }

    throw new Error("Azure Function App did not reach Running state in time");
  }

  private async stopAzureFunctionApp(): Promise<void> {
    const functionAppName = this.getFunctionAppName();
    const resourceGroup = await this.getFunctionResourceGroup();
    const stopper = this.spawnAz(["functionapp", "stop", "--name", functionAppName, "--resource-group", resourceGroup]);

    stopper.stdout?.on("data", (data) => {
      process.stdout.write(`[az stop] ${normalizeLogOutput(data)}`);
    });

    stopper.stderr?.on("data", (data) => {
      process.stderr.write(`[az stop err] ${normalizeLogOutput(data)}`);
    });

    const stopCode = await this.waitForAzExit(stopper);
    if (stopCode !== 0) {
      throw new Error(`Failed to stop Azure Function App (exit ${stopCode})`);
    }
  }

  private async getFunctionResourceGroup(): Promise<string> {
    const functionAppName = this.getFunctionAppName();
    const groupQuery = `[?name=='${functionAppName}'].resourceGroup | [0]`;
    const query = this.spawnAz(["functionapp", "list", "--query", groupQuery, "-o", "tsv"]);

    let stdout = "";
    query.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    let stderr = "";
    query.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    const code = await this.waitForAzExit(query);
    if (code !== 0) {
      throw new Error(`az functionapp list failed (${code}): ${stderr}`);
    }

    const resourceGroup = stdout.trim();
    if (!resourceGroup) {
      throw new Error(`Resource group not found for function app ${functionAppName}`);
    }

    return resourceGroup;
  }

  private async getFunctionState(resourceGroup: string): Promise<string> {
    const functionAppName = this.getFunctionAppName();
    const query = this.spawnAz(
      [
        "functionapp",
        "show",
        "--name",
        functionAppName,
        "--resource-group",
        resourceGroup,
        "--query",
        "state",
        "-o",
        "tsv"
      ]
    );

    let stdout = "";
    query.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    const code = await this.waitForAzExit(query);
    if (code !== 0) {
      return "Unknown";
    }

    return stdout.trim();
  }

  private spawnAz(args: string[]): ChildProcess {
    if (process.platform === "win32") {
      const psCommand = `& ${this.quoteForPowerShell(this.azCommand)} ${args
        .map((arg) => this.quoteForPowerShell(arg))
        .join(" ")}`;

      return spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psCommand], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
    }

    return spawn(this.azCommand, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  }

  private async waitForAzExit(child: ChildProcess): Promise<number> {
    try {
      return await waitForExit(child);
    } catch (error) {
      if (this.isCliSpawnError(error, "ENOENT")) {
        throw new Error("Could not find Azure CLI ('az'). Install Azure CLI or set AZ_CLI_PATH to az.exe/az.cmd.");
      }
      if (this.isCliSpawnError(error, "EINVAL")) {
        throw new Error("Invalid Azure CLI launch arguments. Check AZ_CLI_PATH and ensure it points to a valid az.exe/az.cmd.");
      }
      throw error;
    }
  }

  private resolveAzCommand(): string {
    const explicitPath = this.sanitizeEnvPath(process.env.AZ_CLI_PATH);
    if (explicitPath && fs.existsSync(explicitPath)) {
      return explicitPath;
    }

    if (process.platform === "win32") {
      const candidates = [
        "C:/Program Files/Microsoft SDKs/Azure/CLI2/wbin/az.cmd",
        "C:/Program Files (x86)/Microsoft SDKs/Azure/CLI2/wbin/az.cmd"
      ];

      for (const candidate of candidates) {
        const candidatePath = path.normalize(candidate);
        if (fs.existsSync(candidatePath)) {
          return candidatePath;
        }
      }

      return "az.cmd";
    }

    return "az";
  }

  private getFunctionAppName(): string {
    const functionAppName = this.runtimePaths.azureFunctionAppName?.trim();

    if (!functionAppName) {
      throw new Error(
        "AZURE_FUNCTION_APP_NAME is required. Set it in the environment or workflow-app/.env.local before starting the desktop shell."
      );
    }

    return functionAppName;
  }

  private sanitizeEnvPath(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    const cleaned = value.trim().replace(/^"|"$/g, "");
    return cleaned.length > 0 ? cleaned : undefined;
  }

  private isCliSpawnError(error: unknown, code: string): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }

    const maybe = error as { code?: string };
    return maybe.code === code;
  }

  private quoteForPowerShell(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }
}
