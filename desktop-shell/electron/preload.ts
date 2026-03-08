import type { ServiceStatus } from "./types";

const electron = require("electron") as {
  contextBridge: {
    exposeInMainWorld: (key: string, api: Record<string, unknown>) => void;
  };
  ipcRenderer: {
    invoke: (channel: string) => Promise<unknown>;
    on: (channel: string, listener: (event: unknown, payload: ServiceStatus) => void) => void;
    removeListener: (channel: string, listener: (event: unknown, payload: ServiceStatus) => void) => void;
  };
};

const { contextBridge, ipcRenderer } = electron;

contextBridge.exposeInMainWorld("desktopControl", {
  start: () => ipcRenderer.invoke("desktop:start"),
  stop: () => ipcRenderer.invoke("desktop:stop"),
  getStatus: () => ipcRenderer.invoke("desktop:status") as Promise<ServiceStatus[]>,
  onStatus: (callback: (status: ServiceStatus) => void) => {
    const listener = (_event: unknown, status: ServiceStatus) => callback(status);
    ipcRenderer.on("desktop:status", listener);
    return () => ipcRenderer.removeListener("desktop:status", listener);
  }
});
