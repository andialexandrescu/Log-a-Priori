import type { ServiceStatus } from "./types";

const electron = require("electron") as {
  contextBridge: {
    exposeInMainWorld: (key: string, api: Record<string, unknown>) => void;
  };
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    on: (channel: string, listener: (event: unknown, payload: ServiceStatus) => void) => void;
    removeListener: (channel: string, listener: (event: unknown, payload: ServiceStatus) => void) => void;
  };
};

const { contextBridge, ipcRenderer } = electron;

contextBridge.exposeInMainWorld("desktopControl", {
  // renderer can't directly use next apis, meaning that the renderer calls these functions via window.desktopControl.function() and the main process handles them via ipc
  start: () => ipcRenderer.invoke("desktop:start"),
  stop: () => ipcRenderer.invoke("desktop:stop"),
  getStatus: () => ipcRenderer.invoke("desktop:status") as Promise<ServiceStatus[]>,
  selectRootDirectory: () => ipcRenderer.invoke("desktop:select-root-directory") as Promise<string | null>,
  getRootDirectory: () => ipcRenderer.invoke("desktop:get-root-directory") as Promise<string | null>,
  runKnowledgeGraph: () =>
    ipcRenderer.invoke("desktop:run-knowledge-graph") as Promise<{ ok: boolean; rootDirectory: string }>,
  onStatus: (callback: (status: ServiceStatus) => void) => {
    const listener = (_event: unknown, status: ServiceStatus) => callback(status);
    ipcRenderer.on("desktop:status", listener);
    return () => ipcRenderer.removeListener("desktop:status", listener);
  }
});
