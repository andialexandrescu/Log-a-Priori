import type { ServiceStatus } from "./types";

type AnalysisProgressData = { message: string; error?: boolean };

const electron = require("electron") as {
  contextBridge: {
    exposeInMainWorld: (key: string, api: Record<string, unknown>) => void;
  };
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    on: (channel: string, listener: (event: unknown, payload: unknown) => void) => void;
    removeListener: (channel: string, listener: (event: unknown, payload: unknown) => void) => void;
  };
};

const { contextBridge, ipcRenderer } = electron;

contextBridge.exposeInMainWorld("desktopControl", {
  // renderer can't directly use next apis, meaning that the renderer calls these functions via window.desktopControl.function() and the main process handles them via ipc
  start: () => ipcRenderer.invoke("desktop:start"),
  stop: () => ipcRenderer.invoke("desktop:stop"),
  getStatus: () => ipcRenderer.invoke("desktop:status") as Promise<ServiceStatus[]>,

  getProjectCommitStorageRootDirectory: (projectId: string) => 
    ipcRenderer.invoke("desktop:get-project-commit-storage-root-directory", projectId) as Promise<string>,

  selectProjectRootDirectory: (projectId?: string) => ipcRenderer.invoke("desktop:select-project-root-directory", projectId) as Promise<string | null>,
  getProjectRootDirectory: (projectId?: string) => ipcRenderer.invoke("desktop:get-project-root-directory", projectId) as Promise<string | null>,

  runKnowledgeGraphAnalysis: (projectId: string) =>
    ipcRenderer.invoke("desktop:run-knowledge-graph-analysis", projectId) as Promise<{ ok: boolean; message?: string; error?: string }>,

  onStatus: (callback: (status: ServiceStatus) => void) => {
    const listener = (_event: unknown, status: ServiceStatus) => callback(status);
    ipcRenderer.on("desktop:status", listener as (event: unknown, payload: unknown) => void);
    return () => ipcRenderer.removeListener("desktop:status", listener as (event: unknown, payload: unknown) => void);
  },

  onKnowledgeGraphAnalysisProgress: (callback: (data: AnalysisProgressData) => void) => {
    const listener = (_event: unknown, data: AnalysisProgressData) => callback(data);
    ipcRenderer.on("desktop:kg-analysis-progress", listener as (event: unknown, payload: unknown) => void);
    return () => ipcRenderer.removeListener("desktop:kg-analysis-progress", listener as (event: unknown, payload: unknown) => void);
  }
});
