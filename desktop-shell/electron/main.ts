import path from "node:path";
import { AppOrchestrator } from "./services/orchestrator";

const electron = require("electron") as {
  app: {
    whenReady: () => Promise<void>;
    on: (event: string, listener: (event?: { preventDefault: () => void }) => void) => void;
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
  ipcMain: { handle: (channel: string, listener: (...args: unknown[]) => unknown) => void };
  dialog: { showErrorBox: (title: string, content: string) => void };
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
      nodeIntegration: false
    }
  });

  return window;
}

function registerIpc(): void {
  ipcMain.handle("desktop:start", async () => {
    return orchestrator.startAll();
  });

  ipcMain.handle("desktop:stop", async () => {
    await orchestrator.stopAll();
    return { ok: true };
  });

  ipcMain.handle("desktop:status", () => {
    return orchestrator.getStatuses();
  });

  orchestrator.onStatus((status) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    try {
      mainWindow.webContents.send("desktop:status", status);
    } catch {
    }
  });
}

async function bootstrap(): Promise<void> {
  registerIpc();

  mainWindow = createWindow();

  try {
    await orchestrator.startAll();
    await mainWindow.loadURL("http://127.0.0.1:3000");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await dialog.showErrorBox("Startup failed", message);
    await mainWindow.loadURL("data:text/html,<h2>Startup failed</h2><p>Check Electron logs for details.</p>");
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
    void mainWindow.loadURL("http://127.0.0.1:3000");
  }
});
