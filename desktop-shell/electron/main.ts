import path from "node:path";
import fs from "node:fs";
import { AppOrchestrator } from "./services/orchestrator";
import {
  getDesktopSettingsFilePath,
  ensureProjectCommitsDirectory,
} from "../shared/desktop-shell-paths.js";

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
    showOpenDialog: (
      browserWindow: unknown,
      options: {
        properties: string[];
        title?: string;
        defaultPath?: string;
      }
    ) => Promise<{ canceled: boolean; filePaths: string[] }>;
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

interface UserDesktopSettings {
  projectRoots?: Record<string, string>;
  pendingProjectRoot?: string;
}

interface DesktopSettings {
  commitStorageRoot?: string;
  projectRoots?: Record<string, string>;
  users?: Record<string, UserDesktopSettings>;
}

function readSettings(): DesktopSettings {
  const settingsFilePath = getDesktopSettingsFilePath();
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

function writeSettings(settings: DesktopSettings): void {
  const settingsFilePath = getDesktopSettingsFilePath();
  fs.mkdirSync(path.dirname(settingsFilePath), { recursive: true });
  fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2), "utf-8");
}

function getUserSettings(settings: DesktopSettings, userId: string): UserDesktopSettings {
  if (!settings.users) {
    settings.users = {};
  }
  if (!settings.users[userId]) {
    settings.users[userId] = {};
  }

  if (settings.projectRoots && Object.keys(settings.projectRoots).length > 0) {
    settings.users[userId].projectRoots = {
      ...(settings.users[userId].projectRoots ?? {}),
      ...settings.projectRoots,
    };
    delete settings.projectRoots;
  }

  return settings.users[userId];
}

export function getProjectCommitStorageRootDirectory(userId: string, projectId: string): string {
  return ensureProjectCommitsDirectory(userId, projectId);
}

export async function selectProjectRootDirectory(userId: string, projectId?: string): Promise<string | null> {
  const existing = getProjectRootDirectory(userId, projectId);
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    properties: ["openDirectory", "createDirectory"],
    title: "Select project root directory",
    defaultPath: existing ?? undefined
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];
    const settings = readSettings();
    const userSettings = getUserSettings(settings, userId);

    if (!userSettings.projectRoots) {
      userSettings.projectRoots = {};
    }

    if (projectId) {
      userSettings.projectRoots[projectId] = selectedPath;
    } else {
      userSettings.pendingProjectRoot = selectedPath;
    }

    writeSettings(settings);
    return selectedPath;
  }
  return null;
}

export function getProjectRootDirectory(userId: string, projectId?: string): string | null {
  const settings = readSettings();
  const userSettings = settings.users?.[userId];

  if (!userSettings?.projectRoots) {
    if (projectId && settings.projectRoots?.[projectId]) {
      return settings.projectRoots[projectId];
    }
    return null;
  }

  if (projectId && userSettings.projectRoots[projectId]) {
    return userSettings.projectRoots[projectId];
  }
  if (!projectId && userSettings.pendingProjectRoot) {
    return userSettings.pendingProjectRoot;
  }
  return null;
}

/** Moves `pendingProjectRoot` (create flow) onto the new project id. */
export function promotePendingProjectRoot(userId: string, projectId: string): string | null {
  const settings = readSettings();
  const userSettings = getUserSettings(settings, userId);
  const pending = userSettings.pendingProjectRoot;
  if (!pending) {
    return null;
  }

  if (!userSettings.projectRoots) {
    userSettings.projectRoots = {};
  }
  userSettings.projectRoots[projectId] = pending;
  delete userSettings.pendingProjectRoot;
  writeSettings(settings);
  return pending;
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

  ipcMain.handle(
    "desktop:get-project-commit-storage-root-directory",
    async (_event: Record<string, unknown>, userId: string, projectId: string) => {
      try {
        if (!userId || !projectId) return null;
        return getProjectCommitStorageRootDirectory(userId, projectId);
      } catch {
        return null;
      }
    }
  );

  ipcMain.handle(
    "desktop:select-project-root-directory",
    async (_event: Record<string, unknown>, userId: string, projectId?: string) => {
      if (!userId) return null;
      return selectProjectRootDirectory(userId, projectId);
    }
  );

  ipcMain.handle(
    "desktop:get-project-root-directory",
    (_event: Record<string, unknown>, userId: string, projectId?: string) => {
      if (!userId) return null;
      return getProjectRootDirectory(userId, projectId);
    }
  );

  ipcMain.handle(
    "desktop:promote-pending-project-root",
    (_event: Record<string, unknown>, userId: string, projectId: string) => {
      if (!userId || !projectId) return null;
      return promotePendingProjectRoot(userId, projectId);
    }
  );

  ipcMain.handle(
    "desktop:pull-project-root-latest",
    async (_event: Record<string, unknown>, userId: string, projectId: string) => {
      try {
        if (!userId || !projectId) {
          return { ok: false, error: "Missing user or project id" };
        }

        const projectRoot = getProjectRootDirectory(userId, projectId);
        if (!projectRoot) {
          return {
            ok: false,
            error: "No project root folder configured. Set it under Knowledge graph first.",
          };
        }

        const { pullLatestInProjectRoot } = await import("./services/git-pull-project-root.js");
        return pullLatestInProjectRoot(projectRoot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      }
    }
  );

  ipcMain.handle(
    "desktop:run-knowledge-graph-analysis",
    async (_event: Record<string, unknown>, userId: string, projectId: string) => {
      try {
        if (!userId) {
          return { ok: false, error: "Missing user id for analysis" };
        }

        const projectRoot = getProjectRootDirectory(userId, projectId);
        if (!projectRoot) {
          return { ok: false, error: "Project root not selected for this project. Please set project root first." };
        }

        const { getRuntimePaths } = await import("./services/paths.js");
        const { spawnProcess, waitForExit } = await import("./services/utils.js");
        const runtimePaths = getRuntimePaths();
      
        const child = spawnProcess("node", [
          "--max-old-space-size=4096",
          path.join(runtimePaths.repoRoot, "workflow-app", "scripts", "analyze-recursion.js"),
          projectRoot,
          "--project-id",
          projectId,
          "--user-id",
          userId,
        ], { cwd: runtimePaths.repoRoot });

        child.child.stdout?.on("data", (data: Buffer) => {
          const line = data.toString().trim();
          if (line) {
            console.log(`[KG Analysis] ${line}`);
            mainWindow?.webContents.send("desktop:kg-analysis-progress", { message: line });
          }
        });

        child.child.stderr?.on("data", (data: Buffer) => {
          const line = data.toString().trim();
          if (line) {
            console.error(`[KG Analysis] ${line}`);
            mainWindow?.webContents.send("desktop:kg-analysis-progress", { message: line, error: true });
          }
        });

        const code = await waitForExit(child.child);
        if (code === 0) {
          return { ok: true, message: "Analysis completed successfully" };
        }
        return { ok: false, error: `Analysis failed with exit code ${code}` };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      }
    }
  );

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
    console.error("Full error:", error);
    await mainWindow.loadURL(`data:text/html,<h2>Startup failed</h2><pre>${message}</pre><pre>${JSON.stringify(error, null, 2)}</pre>`);
  }
}

app.whenReady().then(() => {
  bootstrap().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Fatal startup error:", error);
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
