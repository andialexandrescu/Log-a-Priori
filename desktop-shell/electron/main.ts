import path from "node:path";
import fs from "node:fs";
import { AppOrchestrator } from "./services/orchestrator";

const electron = require("electron") as {
  app: {
    whenReady: () => Promise<void>;
    on: (event: string, listener: (event?: { preventDefault: () => void }) => void) => void;
    getPath: (name: string) => string;
    quit: () => void;
  };
  BrowserWindow: {
    new (options: Record<string, unknown>): {
      loadURL: (url: string) => Promise<void>;
      isDestroyed: () => boolean;
      webContents: { send: (channel: string, payload: unknown) => void };
    };
    getAllWindows: () => unknown[];
  };
  ipcMain: { 
    handle: (channel: string, listener: (event: Record<string, unknown>, ...args: any[]) => any) => void;
  };
  dialog: {
    showErrorBox: (title: string, content: string) => void;
    showOpenDialog: (options: {
      properties: string[];
      title?: string;
      defaultPath?: string;
    }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  };
};

const { app, BrowserWindow, ipcMain, dialog } = electron;

let mainWindow: {
  loadURL: (url: string) => Promise<void>;
  isDestroyed: () => boolean;
  webContents: { send: (channel: string, payload: unknown) => void };
} | null = null;
const orchestrator = new AppOrchestrator();
let isQuitting = false;
let isStopping = false;

interface DesktopSettings { // per project roots: { projectId: rootPath }
  commitStorageRoot?: string;
  projectRoots?: Record<string, string>;
}

function getSettingsFilePath(): string {
  return path.join(app.getPath("userData"), "desktop-settings.json"); // returns where the app stores the saved file path setting
}

function readSettings(): DesktopSettings {
  const settingsFilePath = getSettingsFilePath();
  if (!fs.existsSync(settingsFilePath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(settingsFilePath, "utf-8");
    const parsed = JSON.parse(content) as DesktopSettings;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function writeSettings(settings: DesktopSettings): void { // saves the file path setting object to disk as json
  const settingsFilePath = getSettingsFilePath();
  fs.mkdirSync(path.dirname(settingsFilePath), { recursive: true });
  fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2), "utf-8");
}

// commits will be stored in appdata with projectId as the parent folder
function getProjectCommitStorageAppDataPath(projectId: string): string {
  const appDataPath = process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming");
  const projectPath = path.join(appDataPath, "log-a-priori-desktop-shell", projectId, "commits");
  
  fs.mkdirSync(projectPath, { recursive: true });
  return projectPath;
}

export function getProjectCommitStorageRootDirectory(projectId: string): string {
  return getProjectCommitStorageAppDataPath(projectId);
}

// project root/ location of the current working project will also be stored in appdata with projectId as the parent folder
export async function selectProjectRootDirectory(projectId?: string): Promise<string | null> {
  const existing = getProjectRootDirectory(projectId);
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "Select project root directory",
    defaultPath: existing ?? undefined
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];
    const settings = readSettings();
    if (!settings.projectRoots) {
      settings.projectRoots = {};
    }
    
    if (projectId) { // if projectId is provided, store per project the root project directory
      settings.projectRoots[projectId] = selectedPath;
    }

    writeSettings(settings);
    return selectedPath;
  }
  return null;
}

export function getProjectRootDirectory(projectId?: string): string | null {
  const settings = readSettings();
  if (!settings.projectRoots) {
    return null;
  }
  if (projectId && settings.projectRoots[projectId]) {
    return settings.projectRoots[projectId];
  }
  return null;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      partition: "persist:main"
    }
  });

  return window;
}


function registerIpc(): void {
  ipcMain.handle("desktop:start", async () => orchestrator.startAll());
  ipcMain.handle("desktop:stop", async () => { await orchestrator.stopAll(); return { ok: true }; });
  ipcMain.handle("desktop:status", () => orchestrator.getStatuses());

  ipcMain.handle("desktop:get-project-commit-storage-root-directory", async (event: Record<string, unknown>, projectId: string) => {
    try {
      return getProjectCommitStorageRootDirectory(projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return null;
    }
  });

  ipcMain.handle("desktop:select-project-root-directory", async (_, projectId?: string) => selectProjectRootDirectory(projectId));
  ipcMain.handle("desktop:get-project-root-directory", (_, projectId?: string) => getProjectRootDirectory(projectId));

  ipcMain.handle("desktop:run-knowledge-graph-analysis", async (event: Record<string, unknown>, projectId: string) => {
    try {
      const projectRoot = getProjectRootDirectory(projectId);
      if (!projectRoot) {
        return { ok: false, error: "Project root not selected for this project. Please set project root first." };
      }

      // used imports here to avoid circular dependency issues
      const { getRuntimePaths } = await import("./services/paths.js");
      const { spawnProcess, waitForExit } = await import("./services/utils.js");
      const runtimePaths = getRuntimePaths();
      
      const child = spawnProcess("node", [
        "--max-old-space-size=4096",
        path.join(runtimePaths.repoRoot, "workflow-app", "scripts", "analyze-recursion.js"), // running the script from this repo root
        projectRoot,
        "--full-project", // yet to fully port the per commit analysis idea
        "--project-id",
        projectId
      ], { cwd: runtimePaths.repoRoot });

      child.child.stdout?.on("data", (data: Buffer) => {
        const line = data.toString().trim();
        if (line) {
          mainWindow?.webContents.send("desktop:kg-analysis-progress", { message: line });
        }
      });

      child.child.stderr?.on("data", (data: Buffer) => {
        const line = data.toString().trim();
        if (line) {
          mainWindow?.webContents.send("desktop:kg-analysis-progress", { message: line, error: true });
        }
      });

      const code = await waitForExit(child.child);
      if (code === 0) {
        return { ok: true, message: "Analysis completed successfully" };
      } else {
        return { ok: false, error: `Analysis failed with exit code ${code}` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  });

  orchestrator.onStatus((status) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try { mainWindow.webContents.send("desktop:status", status); } catch {}
  });
}

async function bootstrap(): Promise<void> {
  registerIpc();

  mainWindow = createWindow();

  try {
    await orchestrator.startAll();
    await mainWindow.loadURL("http://localhost:3000");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await dialog.showErrorBox("Startup failed", message);
    await mainWindow.loadURL("data:text/html,<h2>Startup failed</h2><p>Check Electron logs for details</p>");
  }
}

app.whenReady().then(() => {
  bootstrap().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await dialog.showErrorBox("Fatal startup error", message);
    app.quit();
  });
});

app.on("before-quit", (event) => {
  if (isQuitting) {
    return;
  }

  event?.preventDefault();

  if (isStopping) {
    return;
  }

  isStopping = true;
  void orchestrator
    .stopAll()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to stop orchestrator:", message);
    })
    .finally(() => {
      isQuitting = true;
      app.quit();
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
    void mainWindow.loadURL("http://localhost:3000");
  }
});
