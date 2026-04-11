export type ManagedService =
  | "pocketbase"
  | "next"
  | "tunnel-next"
  | "tunnel-pocketbase"
  | "tunnel-update"
  | "azure-function";

export type ServiceState = "idle" | "starting" | "running" | "stopped" | "error";

export interface ServiceStatus {
  service: ManagedService;
  state: ServiceState;
  detail?: string;
  pid?: number;
  updatedAt: string;
}

export interface TunnelUrls {
  nextPublicUrl: string;
  pocketbasePublicUrl: string;
}

export interface DesktopControlApi {
  start: () => Promise<void>;
  stop: () => Promise<{ ok: boolean }>;
  getStatus: () => Promise<ServiceStatus[]>;
  getProjectCommitStorageRootDirectory: (projectId: string) => Promise<string>;
  selectProjectRootDirectory: () => Promise<string | null>;
  getProjectRootDirectory: () => Promise<string | null>;
  runKnowledgeGraphAnalysis: (projectId: string) => Promise<{ ok: boolean; message?: string; error?: string }>;
  onStatus: (callback: (status: ServiceStatus) => void) => () => void;
  onKnowledgeGraphAnalysisProgress: (callback: (data: { message: string; error?: boolean }) => void) => () => void;
}
