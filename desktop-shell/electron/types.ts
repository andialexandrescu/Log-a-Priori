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
